const GUEST_KEY = 'wordtrail:guest:v1';
const DEFAULT_NICKNAME = '학습자1';
const LEARNER_ID = 'default';

function storageFor(auth) { return Object.hasOwn(auth, 'storage') ? auth.storage : (globalThis.localStorage || null); }
function blankGuest() { return { nickname: DEFAULT_NICKNAME, progress: [], dictations: [], starts: [] }; }
function read(storage, key, fallback) {
  try { return JSON.parse(storage?.getItem(key) || 'null') || fallback; } catch { return fallback; }
}
function write(storage, key, value) {
  if (!storage) throw new Error('이 브라우저에서는 게스트 진도를 저장할 수 없습니다.');
  try { storage.setItem(key, JSON.stringify(value)); }
  catch { throw new Error('게스트 진도를 브라우저에 저장하지 못했습니다.'); }
}
function writeCache(storage, key, value) {
  try { storage?.setItem(key, JSON.stringify(value)); } catch { /* server data remains authoritative */ }
}
function todayUtc() { return new Date().toISOString().slice(0, 10); }
function sceneKey(videoId, sceneId) { return `${videoId}\u0000${sceneId}`; }

export function createStore(auth) {
  const storage = storageFor(auth);
  const config = auth.config || globalThis.WORD_TRAIL_CONFIG || {};
  const supabaseUrl = String(config.supabaseUrl || '').replace(/\/+$/, '');
  const anonKey = String(config.supabaseAnonKey || '');
  const fetcher = config.fetch || globalThis.fetch?.bind(globalThis);

  async function context() {
    const session = await auth.getSession();
    return session ? { mode: 'cloud', session, userId: session.user.id } : { mode: 'guest', session: null, userId: null };
  }

  async function rest(ctx, path, options = {}) {
    if (!fetcher || !supabaseUrl || !anonKey) throw new Error('클라우드 저장소가 설정되지 않았습니다.');
    const response = await fetcher(`${supabaseUrl}/rest/v1/${path}`, {
      ...options,
      headers: {
        apikey: anonKey,
        Authorization: `Bearer ${ctx.session.access_token}`,
        'Content-Type': 'application/json',
        ...(options.headers || {}),
      },
    });
    let payload = null;
    const text = await response.text();
    if (text) { try { payload = JSON.parse(text); } catch { payload = text; } }
    if (!response.ok) throw new Error(payload?.message || payload?.hint || `클라우드 저장에 실패했습니다 (${response.status}).`);
    const after = await auth.getSession();
    if (!after || after.user.id !== ctx.userId) throw new Error('저장 중 계정이 변경되어 요청을 취소했습니다.');
    return payload;
  }

  async function load() {
    const ctx = await context();
    if (ctx.mode === 'guest') {
      const data = read(storage, GUEST_KEY, blankGuest());
      return {
        nickname: data.nickname || DEFAULT_NICKNAME,
        progress: data.progress || [],
        dictations: data.dictations || [],
        mode: 'guest',
      };
    }
    const [profiles, rows, dictationRows] = await Promise.all([
      rest(ctx, `profiles?select=nickname&user_id=eq.${encodeURIComponent(ctx.userId)}&learner_id=eq.${LEARNER_ID}`),
      rest(ctx, `learning_progress?select=record&learner_id=eq.${LEARNER_ID}&order=updated_at.asc`),
      rest(ctx, `learning_dictations?select=record&learner_id=eq.${LEARNER_ID}&order=updated_at.asc`),
    ]);
    const result = {
      nickname: profiles?.[0]?.nickname || DEFAULT_NICKNAME,
      progress: (rows || []).map((row) => row.record),
      dictations: (dictationRows || []).map((row) => row.record),
      mode: 'cloud',
    };
    writeCache(storage, `wordtrail:cloud:${ctx.userId}:v1`, result);
    return result;
  }

  async function saveProgress(record, expectedUpdatedAt = null, expectedScope = null) {
    const normalized = { ...record, learnerId: record.learnerId || LEARNER_ID, updatedAt: new Date().toISOString() };
    validateProgress(normalized);
    const ctx = await context();
    assertExpectedScope(ctx, expectedScope);
    if (ctx.mode === 'guest') {
      const data = read(storage, GUEST_KEY, blankGuest());
      const index = data.progress.findIndex((item) => progressKey(item) === progressKey(normalized));
      const current = index >= 0 ? data.progress[index] : null;
      if ((current && (!expectedUpdatedAt || current.updatedAt !== expectedUpdatedAt)) || (!current && expectedUpdatedAt)) {
        throw new Error('다른 화면에서 진도가 변경되었습니다. 새로 불러온 뒤 다시 시도해 주세요.');
      }
      if (current && normalized.updatedAt === current.updatedAt) {
        normalized.updatedAt = new Date(Date.parse(current.updatedAt) + 1).toISOString();
      }
      if (current) data.progress[index] = normalized; else data.progress.push(normalized);
      write(storage, GUEST_KEY, data);
      return normalized;
    }
    return rest(ctx, 'rpc/save_progress', {
      method: 'POST', body: JSON.stringify({
        p_record: normalized,
        p_expected_updated_at: expectedUpdatedAt,
      }),
    });
  }

  async function saveDictation(record, expectedUpdatedAt = null, expectedScope = null) {
    const normalized = { ...record, learnerId: record.learnerId || LEARNER_ID, updatedAt: new Date().toISOString() };
    validateDictation(normalized);
    const ctx = await context();
    assertExpectedScope(ctx, expectedScope);
    if (ctx.mode === 'guest') {
      const data = read(storage, GUEST_KEY, blankGuest());
      data.dictations ||= [];
      const index = data.dictations.findIndex((item) => dictationKey(item) === dictationKey(normalized));
      const current = index >= 0 ? data.dictations[index] : null;
      if ((current && (!expectedUpdatedAt || current.updatedAt !== expectedUpdatedAt)) || (!current && expectedUpdatedAt)) {
        throw new Error('다른 화면에서 받아쓰기가 변경되었습니다. 새로 불러온 뒤 다시 시도해 주세요.');
      }
      if (current && normalized.updatedAt === current.updatedAt) {
        normalized.updatedAt = new Date(Date.parse(current.updatedAt) + 1).toISOString();
      }
      if (current) data.dictations[index] = normalized; else data.dictations.push(normalized);
      write(storage, GUEST_KEY, data);
      return normalized;
    }
    return rest(ctx, 'rpc/save_dictation', {
      method: 'POST', body: JSON.stringify({
        p_record: normalized,
        p_expected_updated_at: expectedUpdatedAt,
      }),
    });
  }

  async function startLearning(videoId, sceneId, expectedScope = null) {
    validateSceneIds(videoId, sceneId);
    const ctx = await context();
    assertExpectedScope(ctx, expectedScope);
    if (ctx.mode === 'guest') {
      const data = read(storage, GUEST_KEY, blankGuest());
      const key = sceneKey(videoId, sceneId);
      if (data.starts.some((item) => item.key === key)) return { allowed: true, remaining: Math.max(0, 10 - data.starts.filter((x) => x.day === todayUtc()).length) };
      const used = data.starts.filter((item) => item.day === todayUtc()).length;
      if (used >= 10) return { allowed: false, remaining: 0, reason: 'daily_limit' };
      data.starts.push({ key, videoId, sceneId, day: todayUtc(), startedAt: new Date().toISOString() });
      write(storage, GUEST_KEY, data);
      return { allowed: true, remaining: 9 - used };
    }
    return rest(ctx, 'rpc/start_learning', {
      method: 'POST', body: JSON.stringify({ p_video_id: videoId, p_scene_id: sceneId, p_learner_id: LEARNER_ID }),
    });
  }

  async function exportData(expectedScope = null) {
    const ctx = await context();
    assertExpectedScope(ctx, expectedScope);
    if (ctx.mode === 'guest') return { mode: 'guest', ...read(storage, GUEST_KEY, blankGuest()) };
    const [profiles, progress, dictations, starts] = await Promise.all([
      rest(ctx, `profiles?select=learner_id,nickname,updated_at&learner_id=eq.${LEARNER_ID}`),
      rest(ctx, `learning_progress?select=record,updated_at&learner_id=eq.${LEARNER_ID}`),
      rest(ctx, `learning_dictations?select=record,updated_at&learner_id=eq.${LEARNER_ID}`),
      rest(ctx, `learning_starts?select=learner_id,video_id,scene_id,started_on,created_at&learner_id=eq.${LEARNER_ID}`),
    ]);
    return { mode: 'cloud', exportedAt: new Date().toISOString(), profiles, progress, dictations, starts };
  }

  async function resetProgress(expectedScope = null) {
    const ctx = await context();
    assertExpectedScope(ctx, expectedScope);
    if (ctx.mode === 'guest') {
      const data = read(storage, GUEST_KEY, blankGuest());
      write(storage, GUEST_KEY, { ...data, progress: [], dictations: [] });
      return;
    }
    await rest(ctx, `learning_progress?learner_id=eq.${LEARNER_ID}`, { method: 'DELETE' });
    await rest(ctx, `learning_dictations?learner_id=eq.${LEARNER_ID}`, { method: 'DELETE' });
    try { storage?.removeItem(`wordtrail:cloud:${ctx.userId}:v1`); } catch { /* optional cache */ }
  }

  async function setNickname(name, expectedScope = null) {
    const nickname = String(name || '').trim().slice(0, 40);
    if (!nickname) throw new Error('학습자 별칭을 입력해 주세요.');
    const ctx = await context();
    assertExpectedScope(ctx, expectedScope);
    if (ctx.mode === 'guest') {
      const data = read(storage, GUEST_KEY, blankGuest());
      write(storage, GUEST_KEY, { ...data, nickname });
      return nickname;
    }
    await rest(ctx, 'profiles?on_conflict=user_id,learner_id', {
      method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify({ learner_id: LEARNER_ID, nickname }),
    });
    return nickname;
  }

  return { load, saveProgress, saveDictation, startLearning, exportData, resetProgress, setNickname };
}

function progressKey(record) {
  return [record.learnerId || LEARNER_ID, record.videoId, record.sceneId, record.expressionId, record.contentVersion].join('\u0000');
}
function dictationKey(record) {
  return [record.learnerId || LEARNER_ID, record.videoId, record.sceneId, record.contentVersion].join('\u0000');
}
function assertExpectedScope(context, expectedScope) {
  if (expectedScope == null) return;
  const actualScope = context.mode === 'cloud' ? context.userId : 'guest';
  if (actualScope !== expectedScope) {
    throw new Error('저장을 시작한 뒤 계정이 변경되어 요청을 취소했습니다.');
  }
}
function validateProgress(record) {
  for (const field of ['videoId', 'sceneId', 'expressionId', 'contentVersion']) {
    if (!record?.[field]) throw new Error(`진도 기록에 ${field} 값이 필요합니다.`);
  }
  for (const field of ['spelling', 'reading', 'review']) {
    if (!record?.[field] || typeof record[field] !== 'object' || Array.isArray(record[field])) {
      throw new Error(`진도 기록에 ${field} 객체가 필요합니다.`);
    }
  }
  validateSceneIds(record.videoId, record.sceneId);
  if (!/^[a-z0-9][a-z0-9-]{0,79}$/.test(record.expressionId)) {
    throw new Error('올바른 표현 ID가 필요합니다.');
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(record.contentVersion)) {
    throw new Error('올바른 콘텐츠 버전이 필요합니다.');
  }
  if (String(record.spelling.lastAnswer || '').length > 500) {
    throw new Error('마지막 철자 답안은 500자 이하여야 합니다.');
  }
  if (new TextEncoder().encode(JSON.stringify(record)).byteLength > 8192) {
    throw new Error('진도 기록은 8KB 이하여야 합니다.');
  }
}

function validateSceneIds(videoId, sceneId) {
  if (!/^video-[0-9]{2}$/.test(String(videoId || '')) || !/^(?:s[0-9]{3}|c[0-9]{4})$/.test(String(sceneId || ''))) {
    throw new Error('올바른 영상과 학습 구간 ID가 필요합니다.');
  }
}

function validateDictation(record) {
  validateSceneIds(record?.videoId, record?.sceneId);
  if (record?.learnerId !== LEARNER_ID) throw new Error('기본 학습자의 받아쓰기만 저장할 수 있습니다.');
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(String(record?.contentVersion || ''))) {
    throw new Error('올바른 콘텐츠 버전이 필요합니다.');
  }
  if (typeof record.reference !== 'string' || record.reference.length > 2000
      || typeof record.answer !== 'string' || record.answer.length > 2000) {
    throw new Error('받아쓰기 문장과 답안은 각각 2,000자 이하여야 합니다.');
  }
  if (!isCounter(record.attempts)) {
    throw new Error('받아쓰기 시도 횟수는 0 이상의 정수여야 합니다.');
  }
  const modernVocabulary = record.selectedKeys !== undefined;
  if (modernVocabulary) {
    if (!Array.isArray(record.selectedKeys) || record.selectedKeys.length > 200
        || new Set(record.selectedKeys).size !== record.selectedKeys.length
        || record.selectedKeys.some((key) => typeof key !== 'string' || key.length > 200 || !/^word:.+/.test(key))) {
      throw new Error('선택 단어 키는 중복 없이 200개 이하여야 합니다.');
    }
  }
  if (!Array.isArray(record.words) || record.words.length > 200) {
    throw new Error('받아쓰기 실수 단어는 200개 이하여야 합니다.');
  }
  const canonicalWordKeys = new Set();
  for (const word of record.words) {
    if (!word || typeof word !== 'object' || Array.isArray(word)
        || typeof word.key !== 'string' || word.key.length > 200
        || typeof word.term !== 'string' || word.term.length > 100
        || !['replace', 'missing', 'extra', 'manual'].includes(word.kind)
        || typeof word.typed !== 'string' || word.typed.length > 100
        || !Number.isSafeInteger(word.sourceIndex) || word.sourceIndex < -1 || word.sourceIndex > 10000
        || typeof word.studied !== 'boolean'
        || !isCounter(word.studyAttempts)
        || typeof word.lastAnswer !== 'string' || word.lastAnswer.length > 2000) {
      throw new Error('받아쓰기 실수 단어 형식이 올바르지 않습니다.');
    }
    if (modernVocabulary) {
      const normalizedTerm = normalizeVocabularyTerm(word.term);
      const canonicalKey = `word:${normalizedTerm}`;
      if (!normalizedTerm || word.key !== canonicalKey || canonicalWordKeys.has(canonicalKey)) {
        throw new Error('선택 단어의 canonical key와 고유한 단어가 필요합니다.');
      }
      canonicalWordKeys.add(canonicalKey);
    }
    if (word.sourceIndexes !== undefined
        && (!Array.isArray(word.sourceIndexes) || word.sourceIndexes.length > 200
          || new Set(word.sourceIndexes).size !== word.sourceIndexes.length
          || word.sourceIndexes.some((index) => !Number.isSafeInteger(index) || index < -1 || index > 10000))) {
      throw new Error('단어 위치 목록 형식이 올바르지 않습니다.');
    }
    if (word.registeredAt !== undefined && !isIsoTimestamp(word.registeredAt)) {
      throw new Error('단어 등록 시간이 올바르지 않습니다.');
    }
    if (word.meaningKo !== undefined && (typeof word.meaningKo !== 'string' || word.meaningKo.length > 300)) {
      throw new Error('한국어 뜻은 300자 이하여야 합니다.');
    }
    if (word.lastPracticedAt !== undefined && !isIsoTimestamp(word.lastPracticedAt)) {
      throw new Error('마지막 연습 시간이 올바르지 않습니다.');
    }
    if (word.practice !== undefined) validatePractice(word.practice);
    if (word.review !== undefined) validateWordReview(word.review);
  }
  if (modernVocabulary && record.selectedKeys.some((key) => !canonicalWordKeys.has(key))) {
    throw new Error('선택 단어 키는 저장된 단어를 가리켜야 합니다.');
  }
  if (new TextEncoder().encode(JSON.stringify(record)).byteLength > 65536) {
    throw new Error('받아쓰기 기록은 64KB 이하여야 합니다.');
  }
}

function normalizeVocabularyTerm(value) {
  return String(value ?? '').normalize('NFKC').replace(/[‘’ʼ]/g, "'").toLocaleLowerCase('en-US').trim();
}

function isCounter(value) {
  return Number.isSafeInteger(value) && value >= 0 && value <= 2147483647;
}

function isIsoTimestamp(value) {
  return typeof value === 'string' && value.length <= 40 && hasValidCalendarDate(value)
    && /^[0-9]{4}-[0-9]{2}-[0-9]{2}T(?:[01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9](?:\.[0-9]{1,6})?(?:Z|[+-](?:[01][0-9]|2[0-3]):[0-5][0-9])$/.test(value)
    && Number.isFinite(Date.parse(value));
}

function hasValidCalendarDate(value) {
  const match = /^([0-9]{4})-([0-9]{2})-([0-9]{2})/.exec(value);
  if (!match) return false;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return date.getUTCFullYear() === Number(match[1])
    && date.getUTCMonth() === Number(match[2]) - 1
    && date.getUTCDate() === Number(match[3]);
}

function validatePractice(practice) {
  const modes = new Set(['spelling', 'cloze', 'meaning', 'audio', 'reading']);
  if (!practice || typeof practice !== 'object' || Array.isArray(practice)
      || Object.keys(practice).some((mode) => !modes.has(mode))) {
    throw new Error('단어 연습 기록 형식이 올바르지 않습니다.');
  }
  for (const result of Object.values(practice)) {
    if (!result || typeof result !== 'object' || Array.isArray(result)
        || !isCounter(result.attempts) || !isCounter(result.correct) || result.correct > result.attempts
        || !isIsoTimestamp(result.lastPracticedAt)) {
      throw new Error('단어 연습 횟수와 시간이 올바르지 않습니다.');
    }
  }
}

function validateWordReview(review) {
  if (!review || typeof review !== 'object' || Array.isArray(review)
      || !Number.isSafeInteger(review.step) || review.step < 0 || review.step > 3
      || !isIsoTimestamp(review.dueAt)
      || typeof review.lastReviewedDate !== 'string'
      || !/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(review.lastReviewedDate)
      || !hasValidCalendarDate(review.lastReviewedDate)) {
    throw new Error('단어 복습 일정 형식이 올바르지 않습니다.');
  }
}
