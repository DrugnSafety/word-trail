import { createPlayer } from './lib/player.js';
import { createSentencePlayback } from './lib/sentence-audio.js';
import { normalizeAnswer, checkAnswer, nextReview, isDue, speak, createLetterSpeaker, insertedLetters, createSpeechLoop } from './lib/learning.js';
import { downloadWorkbook, downloadCards } from './lib/workbook.js';
import { createAuth } from './lib/auth.js';
import { createStore } from './lib/store.js';
import { compareSentence, makeDictationRecord } from './lib/dictation.js';
import { wordCandidates, commitSelection, selectedWords, registerPractice, wordKnowledge, phraseCandidates } from './lib/vocabulary.js';

import { PRACTICE_ORDER, nextPractice, phraseRange } from './lib/practice.js';
import { findWordFamily } from './lib/word-families.js';

export const STAGES = ['listen', 'dictation', 'workspace'];
const WORKSPACE_MODES = PRACTICE_ORDER;
const MODE_LABELS = { point: '짚어 읽기', spelling: '철자 쓰기', cloze: '빈칸', explain: '뜻·표현', meaning: '뜻 퀴즈', audio: '소리 퀴즈', reading: '혼자 읽기' };
const APP_STATE_KEY = 'wordtrail:ui:v1';
const NOTE_KEY = 'wordtrail:corrections:v1';
const BREAK_KEY = 'wordtrail:break-reminder:v1';
export const CURRENT_CONTENT_VERSION = '2026.09.29-2';

export function scopedStorageKey(base, scope = 'guest') {
  return `${base}:${String(scope || 'guest').replace(/[^a-zA-Z0-9_-]/g, '_')}`;
}

export function createKeyedQueue() {
  const pending = new Map();
  return (key, task) => {
    const previous = pending.get(key) || Promise.resolve();
    const current = previous.catch(() => {}).then(task);
    pending.set(key, current);
    return current.finally(() => { if (pending.get(key) === current) pending.delete(key); });
  };
}

export function createSingleFlight() {
  let pending = false;
  return async (task) => {
    if (pending) return false;
    pending = true;
    try { await task(); return true; }
    finally { pending = false; }
  };
}

export function durationBucket(duration) {
  return Number(duration) <= 600 ? 'short' : 'long';
}

export function filterCatalog(videos, query = '', filter = 'all') {
  const needle = normalizeAnswer(query);
  return videos.filter((video) => {
    const matchesText = !needle || normalizeAnswer(video.title || '').includes(needle);
    const matchesDuration = filter === 'all' || durationBucket(video.duration) === filter;
    return matchesText && matchesDuration;
  });
}

export function clozeParts(target) {
  const quote = String(target?.quote || '');
  const start = Number(target?.matchStart);
  const end = Number(target?.matchEnd);
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end <= start || end > quote.length) {
    return null;
  }
  return { before: quote.slice(0, start), answer: quote.slice(start, end), after: quote.slice(end) };
}

export function secondsLabel(value) {
  const seconds = Math.max(0, Math.floor(Number(value) || 0));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

export function sourceVideoId(url = '') {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:') return '';
    const host = parsed.hostname.toLowerCase();
    const id = host === 'youtu.be'
      ? parsed.pathname.split('/').filter(Boolean)[0]
      : (host === 'youtube.com' || host === 'www.youtube.com') ? parsed.searchParams.get('v') : '';
    return /^[\w-]{11}$/.test(id || '') ? id : '';
  } catch {
    return '';
  }
}

export function canResumeScene(saved, videoData) {
  return Boolean(saved?.sceneId && /^c\d{4}$/.test(saved.sceneId)
    && saved.contentVersion && saved.contentVersion === videoData?.contentVersion
    && videoData.scenes?.some((scene) => scene.id === saved.sceneId && scene.selectable));
}

export function canNavigateSource(record, currentVersion = CURRENT_CONTENT_VERSION) {
  return Boolean(record?.contentVersion === currentVersion && /^c\d{4}$/.test(record?.sceneId || ''));
}

export function selectableScenes(videoData) {
  return (videoData?.scenes || []).filter((scene) => scene.selectable);
}

export function canEnterStage(stage, { videoId, sceneId, contentVersion, dictations = [], hasTargets = true } = {}) {
  if (!STAGES.includes(stage)) return false;
  if (stage === 'listen' || stage === 'dictation') return true;
  return dictations.some((record) => record.videoId === videoId && record.sceneId === sceneId
    && record.contentVersion === contentVersion);
}

export function availableStages(context) {
  return STAGES.filter((stage) => canEnterStage(stage, context));
}

export function updateMistakeWord(word, answer, correct) {
  return {
    ...word,
    studied: Boolean(word.studied || correct),
    studyAttempts: (word.studyAttempts || 0) + 1,
    lastAnswer: String(answer)
  };
}

export function isVocabularyWord(record, word) {
  return Boolean(word && word.kind !== 'extra'
    && (record?.selectedKeys === undefined || word.registeredAt || word.studied || word.studyAttempts));
}

export function isCompletedWord(word) {
  return Number(word?.practice?.reading?.correct || 0) > 0;
}

export function filterVocabulary(entries, filter = 'all') {
  if (filter === 'completed') return entries.filter(({ word }) => isCompletedWord(word));
  if (filter === 'learning') return entries.filter(({ word }) => !isCompletedWord(word));
  return entries;
}

export function vocabularyAttemptCount(word) {
  const legacyTotal = Number.isFinite(Number(word?.studyAttempts))
    ? Math.max(0, Number(word.studyAttempts)) : 0;
  const modeTotal = Object.values(word?.practice || {}).reduce((sum, result) => {
    const attempts = Number(result?.attempts);
    return sum + (Number.isFinite(attempts) ? Math.max(0, attempts) : 0);
  }, 0);
  return Math.max(legacyTotal, modeTotal);
}

export function meaningQuizAvailable(term, meaning) {
  const answer = normalizeAnswer(term);
  if (!answer || !String(meaning || '').trim()) return false;
  const tokens = sentenceWordRanges(meaning).map(({ text }) => normalizeAnswer(text)).join(' ');
  return !(` ${tokens} `).includes(` ${answer} `);
}

export function savedDictationComparison(record, reference) {
  if (!record || String(record.reference) !== String(reference) || typeof record.answer !== 'string') return null;
  try { return compareSentence(reference, record.answer); }
  catch { return null; }
}

export function sentenceWordRanges(reference) {
  const original = String(reference ?? '');
  let searchable = '';
  const sourceMap = [];
  let sourceOffset = 0;
  for (const character of original) {
    const sourceEnd = sourceOffset + character.length;
    const normalized = character.normalize('NFKC').replace(/[’‘ʼ]/g, "'");
    searchable += normalized;
    for (let index = 0; index < normalized.length; index += 1) sourceMap.push({ start: sourceOffset, end: sourceEnd });
    sourceOffset = sourceEnd;
  }
  const pattern = /[\p{L}\p{M}\p{N}]+(?:'[\p{L}\p{M}\p{N}]+)*/gu;
  return [...searchable.matchAll(pattern)].map((match) => {
    const start = sourceMap[match.index]?.start ?? match.index;
    const end = sourceMap[match.index + match[0].length - 1]?.end ?? start;
    return { start, end, text: original.slice(start, end) };
  });
}

export function makeProgress({ video, scene, target, previous, answer, correct, hints = 0, readingResult, now = new Date() }) {
  const expressionId = target.expressionId;
  const contentVersion = target.contentVersion || video.contentVersion;
  if (!contentVersion) throw new Error('학습 자료의 콘텐츠 버전을 찾지 못했습니다.');
  const priorReview = previous?.review || { step: -1, dueAt: null, lastReviewedDate: null };
  const hasReadingCheck = readingResult === 'independent' || readingResult === 'helped';
  return {
    learnerId: previous?.learnerId || 'default',
    videoId: video.id,
    sceneId: scene.id,
    expressionId,
    contentVersion,
    spelling: {
      attempts: (previous?.spelling?.attempts || 0) + (answer == null ? 0 : 1),
      correct: Boolean(previous?.spelling?.correct || correct),
      hints: Math.max(previous?.spelling?.hints || 0, hints),
      lastAnswer: answer == null ? (previous?.spelling?.lastAnswer || '') : String(answer)
    },
    reading: {
      result: hasReadingCheck ? readingResult : (previous?.reading?.result || null),
      lastCheckedAt: hasReadingCheck ? now.toISOString() : (previous?.reading?.lastCheckedAt || null)
    },
    review: hasReadingCheck ? nextReview(priorReview, readingResult === 'independent', now) : priorReview,
    updatedAt: now.toISOString()
  };
}

function byId(id) { return document.getElementById(id); }
function storageGet(key) { try { return localStorage.getItem(key); } catch { return null; } }
function storageSet(key, value) { try { localStorage.setItem(key, value); return true; } catch { return false; } }
function make(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text != null) element.textContent = text;
  return element;
}

function loadUiState(scope) {
  try { return JSON.parse(localStorage.getItem(scopedStorageKey(APP_STATE_KEY, scope))) || {}; } catch { return {}; }
}

function saveUiState(partial, scope) {
  const next = { ...loadUiState(scope), ...partial };
  try { localStorage.setItem(scopedStorageKey(APP_STATE_KEY, scope), JSON.stringify(next)); } catch { /* progress store remains authoritative */ }
  return next;
}

export function clearUiState(scope, storage = globalThis.localStorage) {
  try { storage.removeItem(scopedStorageKey(APP_STATE_KEY, scope)); return true; }
  catch { return false; }
}

function startApp() {
  const config = window.WORD_TRAIL_CONFIG || { supabaseUrl: '', supabaseAnonKey: '' };
  const auth = createAuth(config);
  let store = createStore(auth);
  let player = null;
  const state = {
    catalog: [], expressions: new Map(), lexicon: [], families: [], progress: [], dictations: [], nickname: '학습자1', mode: 'guest', session: null,
    video: null, videoData: null, scene: null, stage: 'listen', activeWord: 0,
    playerLoaded: false, breakTimer: null, showAllReviews: false,
    dictationResult: null, selectionDraft: new Set(), workspaceMode: 'explain', workspaceWordIndex: 0,
    workspaceResult: null, selectedMistake: null, showVocabularyList: false,
    wordFilter: 'all', autoAdvance: true, workspaceComplete: false, completedItems: new Set(), audioPaused: false
  };
  let storeSequence = 0;
  let openSequence = 0;
  let sceneSequence = 0;
  let activeScope = null;
  const queueProgress = createKeyedQueue();
  const accountScope = (session = state.session) => session?.user?.id || 'guest';

  const views = ['library', 'learning', 'words', 'review', 'session'];
  const status = (message, type = 'info', timeout = 4500) => {
    const node = byId('global-status');
    node.textContent = message;
    node.dataset.type = type;
    node.hidden = false;
    window.clearTimeout(status.timer);
    if (timeout) status.timer = window.setTimeout(() => { node.hidden = true; }, timeout);
  };

  const playerStatus = ({ type, message, rate, availableRates }) => {
    if (type === 'rate') {
      const select = byId('rate-select');
      if (Number.isFinite(rate)) select.value = String(rate);
      if (availableRates?.length) [...select.options].forEach(option => { option.disabled = !availableRates.includes(Number(option.value)); });
      if (!message) return;
    }
    const node = byId('player-status');
    node.textContent = message || '';
    if (type === 'autoplay-blocked') {
      byId('player-poster').hidden = true;
      byId('player-mount').scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
    if (type === 'error') status(message || '영상을 재생하지 못했어요. 원본 링크를 이용해 주세요.', 'error');
  };
  const letterSpeaker = createLetterSpeaker(playerStatus);
  let repeatControl = null;
  let sentencePlayback = null;
  const speechLoop = createSpeechLoop((event) => {
    playerStatus(event);
    updateRepeatControl();
  });
  let autoTimer = null;
  let workspaceEpoch = 0;
  function stopWorkspaceActivity() {
    workspaceEpoch += 1;
    window.clearTimeout(autoTimer); autoTimer = null;
    speechLoop.stop(); letterSpeaker.cancel(); repeatControl = null;
    sentencePlayback?.pause();
  }


  const recordKey = (record) => [record.videoId, record.sceneId, record.expressionId, record.contentVersion].join('\u0000');
  const isSaveConflict = (error) => error?.code === 'PROGRESS_CONFLICT' || error?.status === 409 || /conflict|stale|충돌|변경/i.test(error?.message || '');

  async function saveProgressVersioned(record, previous, expectedScope) {
    try {
      return await store.saveProgress(record, previous?.updatedAt || null, expectedScope);
    } catch (error) {
      if (!isSaveConflict(error)) throw error;
      await reloadStore();
      throw new Error('다른 화면의 최신 기록을 불러왔어요. 한 번 더 눌러 주세요.');
    }
  }

  function route(name, push = true) {
    stopWorkspaceActivity();
    const routeName = views.includes(name) ? name : 'library';
    if (routeName !== 'learning') { player?.pause(); letterSpeaker.cancel(); window.speechSynthesis?.cancel?.(); }
    views.forEach((view) => { byId(`${view}-view`).hidden = view !== routeName; });
    document.querySelectorAll('[data-route]').forEach((button) => {
      if (button.classList.contains('nav-button')) button.setAttribute('aria-current', button.dataset.route === routeName ? 'page' : 'false');
    });
    if (routeName === 'review') renderReviews();
    if (routeName === 'words') renderWordLibrary();
    if (push) history.pushState({ route: routeName }, '', `#${routeName}`);
    document.querySelector(`#${routeName}-view h1, #${routeName}-view [tabindex="-1"]`)?.focus?.({ preventScroll: true });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function refreshProfileUi() {
    byId('nickname-label').textContent = state.nickname || '학습자1';
    byId('mode-title').textContent = state.mode === 'cloud' ? '계정에 저장 중' : '게스트 학습';
    byId('mode-copy').textContent = state.mode === 'cloud'
      ? `${state.session?.user?.email || '부모 계정'} · 여러 기기에서 동기화`
      : auth.configured ? '이 기기에만 저장돼요. 로그인하면 계정 진도를 불러옵니다.' : '계정 서버가 아직 연결되지 않아 이 기기에만 저장돼요.';
    byId('mode-card').classList.toggle('cloud', state.mode === 'cloud');
    updateReviewCount();
    updateWordCount();
  }

  async function reloadStore() {
    const sequence = ++storeSequence;
    const session = await auth.getSession();
    const nextStore = createStore(auth);
    const saved = await nextStore.load();
    if (sequence !== storeSequence) return false;
    const nextScope = accountScope(session);
    if (activeScope !== null && activeScope !== nextScope) resetActiveLearning();
    activeScope = nextScope;
    store = nextStore;
    state.progress = Array.isArray(saved.progress) ? saved.progress : [];
    state.dictations = Array.isArray(saved.dictations) ? saved.dictations : [];
    state.nickname = saved.nickname || '학습자1';
    state.mode = saved.mode || 'guest';
    state.session = session;
    refreshProfileUi();
    renderContinue();
    return true;
  }

  function clearForAccountTransition(session, nextScope) {
    resetActiveLearning();
    activeScope = nextScope;
    state.session = session;
    state.progress = [];
    state.dictations = [];
    state.nickname = '학습자1';
    state.mode = session ? 'cloud' : 'guest';
    byId('nickname-label').textContent = state.nickname;
    byId('mode-card').classList.toggle('cloud', Boolean(session));
    byId('mode-title').textContent = '계정 전환 중';
    byId('mode-copy').textContent = '이전 계정의 화면을 지우고 새 학습 기록을 불러오고 있어요.';
    byId('review-count').textContent = '0';
    byId('word-count').textContent = '0';
    byId('review-list').replaceChildren();
    byId('review-empty').hidden = false;
    byId('continue-card').replaceChildren();
    byId('continue-card').hidden = true;
    byId('word-list').replaceChildren();
    byId('word-study-panel').replaceChildren();
    byId('word-study-panel').hidden = true;
    byId('word-empty').hidden = false;
    byId('correction-note').value = '';
    if (byId('account-dialog').open) renderAccount();
  }

  function resetActiveLearning() {
    stopWorkspaceActivity();
    state.wordFilter = 'all'; state.workspaceComplete = false; state.completedItems.clear();
    byId('learning-view').classList.remove('workspace-active');
    byId('workspace-sidebar').replaceChildren();
    ++openSequence;
    ++sceneSequence;
    player?.destroy();
    player = null;
    state.video = null;
    state.videoData = null;
    state.scene = null;
    state.stage = 'listen';
    state.dictationResult = null;
    state.selectionDraft = new Set();
    state.workspaceMode = 'explain';
    state.workspaceWordIndex = 0;
    state.workspaceResult = null;
    state.selectedMistake = null;
    state.showVocabularyList = false;
    byId('player-mount').replaceChildren();
    byId('player-poster').hidden = false;
    byId('learning-video-number').textContent = '';
    byId('learning-title').textContent = '';
    byId('scene-list').replaceChildren();
    byId('practice-panel').replaceChildren();
    byId('target-position').textContent = '';
    byId('source-info-content').replaceChildren();
    byId('source-info-button').disabled = true;
    byId('download-workbook').disabled = true;
    byId('download-cards').disabled = true;
    byId('youtube-fallback').removeAttribute('href');
    if (byId('info-dialog').open) byId('info-dialog').close();
    if (byId('note-dialog').open) byId('note-dialog').close();
    if (!byId('learning-view').hidden) route('library');
  }

  function updateReviewCount() {
    const oldCount = state.progress.filter((record) => record.reading?.result && isDue(record, new Date())).length;
    const wordCount = allMistakes().filter(({ word }) => word.review?.dueAt && isDue(word.review, new Date())).length;
    const count = oldCount + wordCount;
    byId('review-count').textContent = String(count);
  }

  const dictationKey = (record) => [record.videoId, record.sceneId, record.contentVersion].join('\u0000');
  const dictationFor = (videoId = state.video?.id, sceneId = state.scene?.id, contentVersion = state.videoData?.contentVersion) =>
    state.dictations.find((record) => record.videoId === videoId && record.sceneId === sceneId && record.contentVersion === contentVersion);
  const allMistakes = () => state.dictations.flatMap((record) => (record.words || [])
    .filter((word) => isVocabularyWord(record, word))
    .map((word) => ({ record, word })));
  function updateWordCount() { byId('word-count').textContent = String(allMistakes().length); }
  const currentStageContext = () => ({
    videoId: state.videoData?.id,
    sceneId: state.scene?.id,
    contentVersion: state.videoData?.contentVersion,
    dictations: state.dictations,
    hasTargets: Boolean(state.scene?.targets?.length)
  });

  function renderContinue() {
    const saved = loadUiState(accountScope());
    const video = state.catalog.find((item) => item.id === saved.videoId);
    const card = byId('continue-card');
    if (!video) { card.hidden = true; return; }
    card.replaceChildren();
    card.append(make('strong', '', '이어서 학습하기'));
    card.append(make('p', '', saved.contentVersion === CURRENT_CONTENT_VERSION
      ? `${video.title} · 마지막으로 보던 대화`
      : `${video.title} · 대화 구간 기준이 바뀌어 첫 대화부터 시작해요. 기존 단어 기록은 단어장에 보관돼요.`));
    const button = make('button', '', '계속하기 →');
    button.addEventListener('click', () => openVideo(video.id, saved.sceneId, true, saved.contentVersion));
    card.append(button);
    card.hidden = false;
  }

  function renderCatalog() {
    const query = byId('video-search').value;
    const duration = document.querySelector('input[name="duration"]:checked')?.value || 'all';
    const videos = filterCatalog(state.catalog, query, duration);
    const grid = byId('video-grid');
    grid.replaceChildren();
    byId('catalog-count').textContent = `${videos.length}개`;
    byId('catalog-empty').hidden = videos.length > 0;
    videos.forEach((video) => {
      const button = make('button', 'video-card');
      button.type = 'button';
      const number = make('span', 'number', `VIDEO ${String(video.number ?? '').padStart(2, '0')}`);
      const title = make('h3', '', video.title);
      const meta = make('div', 'meta');
      meta.append(make('span', '', secondsLabel(video.duration)));
      meta.append(make('span', '', `${video.sceneCount || 0}개 학습 구간`));
      meta.append(make('span', '', `${video.expressionCount || 0}개 표현`));
      if (video.qualityFlags?.length) meta.append(make('span', 'flag', '확인 표시 있음'));
      button.append(number, title, meta);
      button.setAttribute('aria-label', `${video.title}, ${secondsLabel(video.duration)}, 학습 구간 ${video.sceneCount || 0}개`);
      button.addEventListener('click', () => openVideo(video.id));
      grid.append(button);
    });
  }

  async function openVideo(videoId, preferredSceneId, pushRoute = true, preferredVersion = null) {
    const sequence = ++openSequence;
    const scope = accountScope();
    const video = state.catalog.find((item) => item.id === videoId);
    if (!video) return status('영상을 찾지 못했어요.', 'error');
    try {
      status('학습 구간을 불러오는 중이에요.', 'info', 0);
      const response = await fetch(`./data/videos/${encodeURIComponent(videoId)}.json`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      if (sequence !== openSequence || scope !== accountScope() || scope !== activeScope) return;
      const scenes = selectableScenes(data);
      if (!scenes.length) throw new Error('받아쓸 문장이 없습니다.');
      const saved = { sceneId: preferredSceneId, contentVersion: preferredVersion };
      const scene = canResumeScene(saved, data) ? scenes.find((item) => item.id === preferredSceneId) : scenes[0];
      const allowance = await store.startLearning(videoId, scene.id, scope);
      if (sequence !== openSequence || scope !== accountScope() || scope !== activeScope) return;
      if (!allowance?.allowed) {
        status(allowanceMessage(allowance?.reason, '지금은 새 학습 구간을 시작할 수 없어요.'), 'error', 0);
        return;
      }
      state.video = video;
      state.videoData = data;
      await selectScene(scene, false);
      if (sequence !== openSequence) return;
      populateLearningHeader();
      renderSceneList();
      route('learning', pushRoute);
      byId('global-status').hidden = true;
      if (Number.isFinite(allowance.remaining)) status(`새 학습을 시작했어요. 오늘 ${allowance.remaining}개 구간을 더 시작할 수 있어요.`);
    } catch (error) {
      if (sequence !== openSequence) return;
      status(`학습 자료를 열지 못했어요: ${error.message}`, 'error', 0);
    }
  }

  function populateLearningHeader() {
    byId('learning-video-number').textContent = `VIDEO ${String(state.video.number ?? '').padStart(2, '0')}`;
    byId('learning-title').textContent = state.video.title;
    const chaptersLabel = state.videoData.chapterMetadataStatus === 'partial-user-confirmed'
      ? `${state.videoData.expectedChapterCount}개 Chapter 중 첫 목차 일부 반영`
      : `${state.videoData.chapters?.length || 1} Chapter`;
    byId('scene-count').textContent = `${chaptersLabel} · ${selectableScenes(state.videoData).length}개 대화`;
    updateFallbackLink();
  }

  function updateFallbackLink() {
    const source = state.videoData?.sourceUrl || state.video?.sourceUrl || '#';
    const link = byId('youtube-fallback');
    const videoId = sourceVideoId(source);
    if (videoId) {
      link.href = `https://www.youtube.com/watch?v=${videoId}&t=${Math.floor(state.scene?.start || 0)}s`;
      link.hidden = false;
    } else {
      link.removeAttribute('href');
      link.hidden = true;
    }
  }

  function allowanceMessage(reason, fallback) {
    if (reason === 'daily_limit') return '오늘 시작할 수 있는 새 구간 10개를 모두 사용했어요. 배운 표현 복습은 계속할 수 있어요.';
    return reason || fallback;
  }

  async function selectScene(scene, requestAllowance = true) {
    stopWorkspaceActivity();
    player?.pause();
    const sequence = ++sceneSequence;
    const scope = accountScope();
    const expectedVideoId = state.video?.id;
    try {
      if (requestAllowance) {
        const allowance = await store.startLearning(state.video.id, scene.id, scope);
        if (sequence !== sceneSequence || expectedVideoId !== state.video?.id || scope !== accountScope() || scope !== activeScope) return;
        if (!allowance?.allowed) return status(allowanceMessage(allowance?.reason, '이 구간은 지금 새로 시작할 수 없어요.'), 'error', 0);
      }
      if (sequence !== sceneSequence || expectedVideoId !== state.video?.id || scope !== accountScope() || scope !== activeScope) return;
      player?.destroy();
      player = null;
      byId('player-mount').replaceChildren();
      state.scene = scene;
      state.workspaceComplete = false; state.completedItems.clear();
      state.selectionDraft = new Set(dictationFor(state.video.id, scene.id, state.videoData.contentVersion)?.selectedKeys || []);
      state.stage = 'listen';
      state.activeWord = 0;
      state.playerLoaded = false;
      byId('player-poster').hidden = false;
      state.dictationResult = null;
      state.workspaceMode = 'explain';
      state.workspaceWordIndex = 0;
      state.workspaceResult = null;
      saveUiState({ videoId: state.video.id, sceneId: scene.id, contentVersion: state.videoData.contentVersion }, accountScope());
      renderSceneList();
      renderPractice();
      updateFallbackLink();
      startBreakTimer();
      preparePlayer();
    } catch (error) {
      if (sequence !== sceneSequence) return;
      status(error.message, 'error');
    }
  }

  function renderSceneList() {
    const list = byId('scene-list');
    list.replaceChildren();
    const scenes = selectableScenes(state.videoData);
    const chapters = state.videoData?.chapters?.length ? state.videoData.chapters : [{ id: 'whole', title: '전체 영상', source: 'whole-video', sceneIds: scenes.map(scene => scene.id) }];
    chapters.forEach((chapter, chapterIndex) => {
      const chapterScenes = scenes.filter(scene => chapter.sceneIds.includes(scene.id));
      const section = make('details', 'chapter-section');
      section.open = chapterScenes.some(scene => scene.id === state.scene?.id);
      const summary = make('summary', 'chapter-heading');
      const heading = chapter.source === 'partial-heading-fallback' ? chapter.title : `${chapterIndex + 1}. ${chapter.title}`;
      summary.append(make('strong', '', heading), make('span', '', `${chapterScenes.length}개 대화`));
      section.append(summary);
      const chapterNote = chapter.titleSource === 'video-title'
        ? '영상 제목을 기준으로 목차 이름을 보정했어요.'
        : chapter.source === 'user-provided' ? '보내주신 첫 네 구간이에요. Chapter의 끝 시각은 확인 중이에요.'
        : chapter.source === 'partial-heading-fallback' ? '이후 Chapter의 제목과 시각은 확인 중이에요. 짧은 대화 연습은 계속할 수 있어요.'
        : chapter.source === 'script-heading' ? '대본 캡처의 에피소드 목차'
        : chapter.title === '도입부' ? '첫 에피소드 제목 앞의 대화예요.'
        : '원본 Chapter 정보가 없어 전체 영상을 대화 단위로 나눴어요.';
      section.append(make('p', 'helper chapter-source', chapterNote));
      chapterScenes.forEach((scene, index) => {
      const button = make('button', 'scene-button');
      button.type = 'button';
      button.setAttribute('aria-current', String(scene.id === state.scene?.id));
      button.append(make('span', 'scene-time', `${secondsLabel(scene.start)}–${secondsLabel(scene.end)}`));
      const description = make('span', '', `대화 ${index + 1}`);
      button.append(description, make('small', '', `${Math.round(scene.end - scene.start)}초`));
      button.addEventListener('click', () => selectScene(scene));
      section.append(button);
      });
      list.append(section);
    });
  }

  function renderPractice() {
    const stageContext = currentStageContext();
    if (!canEnterStage(state.stage, stageContext)) state.stage = 'dictation';
    const inWorkspace = state.stage === 'workspace';
    byId('learning-view').classList.toggle('workspace-active', inWorkspace);
    byId('workspace-sidebar').hidden = !inWorkspace;
    if (inWorkspace) player?.pause();
    else { setQuizPrivacy(false, false); byId('workspace-sidebar').replaceChildren(); }
    const panel = byId('practice-panel');
    panel.replaceChildren();
    document.querySelectorAll('#stage-nav button').forEach((button) => {
      button.disabled = !canEnterStage(button.dataset.stage, stageContext);
      button.setAttribute('aria-current', button.dataset.stage === state.stage ? 'step' : 'false');
    });
    const hasSubmittedCurrentScene = canEnterStage('workspace', stageContext);
    const exportWords = hasSubmittedCurrentScene ? selectedWords(dictationFor() || {}) : [];
    const hasExportSelection = exportWords.length > 0 && exportWords.every((word) => word.registeredAt);
    byId('download-workbook').disabled = !hasExportSelection;
    byId('download-cards').disabled = !hasExportSelection;
    byId('target-position').textContent = `대화 ${state.scene?.paragraphIndex || state.scene?.id?.replace(/^c0*/, '') || ''} · ${Math.round((state.scene?.end || 0) - (state.scene?.start || 0))}초`;
    byId('previous-target').hidden = state.stage !== 'workspace';
    byId('previous-target').disabled = false;
    byId('next-action').textContent = state.stage === 'listen' ? '받아쓰기 하기'
      : state.stage === 'dictation' && state.selectionDraft.size ? `고른 단어 ${state.selectionDraft.size}개 연습`
      : state.stage === 'dictation' && hasSubmittedCurrentScene ? '단어 없이 다음 문장'
      : state.stage === 'dictation' ? '받아쓰기 저장 후 계속'
      : '연습을 나가고 다음 문장';
    if (state.stage === 'listen') { renderListen(panel); return; }
    if (state.stage === 'dictation') { renderDictation(panel); return; }
    renderWorkspace(panel, dictationFor(), selectedWords(dictationFor() || {}), false);
  }

  function renderListen(panel) {
    panel.append(make('h2', '', '화면을 보지 않고 먼저 들어요'));
    panel.append(make('p', 'instruction', '한 대화의 흐름을 여러 번 들어 보세요. 받아쓰기를 제출하기 전에는 영어 문장을 보여 주지 않습니다.'));
    const visual = make('div', 'listen-visual');
    const rings = make('div', 'listen-rings');
    rings.append(make('span', '', '♪'));
    const note = make('p', 'listen-note', '아이와 함께 어떤 상황인지 이야기해 보세요. 정답을 찾는 시간은 다음 단계에 있어요.');
    visual.append(rings, note);
    panel.append(visual);
  }

  function renderDictation(panel) {
    panel.append(make('h2', '', '들은 대화를 써 봐요'));
    panel.append(make('p', 'instruction', '띄어쓰기와 문장부호를 완벽하게 맞히려 애쓰기보다 들린 단어를 순서대로 적어 보세요.'));
    const form = make('form', 'dictation-form');
    const label = make('label', '', '들은 영어 문장');
    const input = document.createElement('textarea');
    input.id = 'dictation-answer'; input.rows = 4; input.maxLength = 2000;
    input.autocomplete = 'off'; input.autocapitalize = 'off'; input.spellcheck = false;
    if (state.dictationResult) input.value = dictationFor()?.answer || '';
    label.htmlFor = input.id;
    const actions = make('div', 'dictation-actions');
    const replay = make('button', 'secondary-button', '문장 다시 듣기'); replay.type = 'button'; replay.addEventListener('click', () => playRange('scene'));
    const submit = make('button', 'primary-button', '받아쓰기 확인'); submit.type = 'submit';
    const feedback = make('p', 'answer-feedback'); feedback.setAttribute('role', 'status');
    actions.append(replay, submit); form.append(label, input, actions, feedback);
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const answer = input.value.trim();
      if (!answer) { feedback.textContent = '먼저 들은 문장을 적어 주세요.'; feedback.className = 'answer-feedback incorrect'; input.focus(); return; }
      const reference = state.scene.sentenceText;
      const context = {
        videoId: state.videoData.id,
        sceneId: state.scene.id,
        contentVersion: state.videoData.contentVersion,
        stage: state.stage
      };
      let comparison;
      try { comparison = compareSentence(reference, answer); }
      catch (error) { feedback.textContent = error.message; feedback.className = 'answer-feedback incorrect'; return; }
      [...form.elements].forEach((element) => { element.disabled = true; });
      feedback.textContent = '받아쓰기 기록을 저장하는 중…'; feedback.className = 'answer-feedback';
      try {
        await persistDictation(answer, comparison);
        if (byId('learning-view').hidden || state.stage !== context.stage || state.stage !== 'dictation'
          || state.videoData?.id !== context.videoId || state.scene?.id !== context.sceneId
          || state.videoData?.contentVersion !== context.contentVersion) return;
        state.dictationResult = comparison;
        state.selectionDraft = new Set(wordCandidates(reference, comparison).filter((word) => word.selected).map((word) => word.key));
        renderPractice();
        const selection = byId('word-selection');
        requestAnimationFrame(() => {
          if (!selection?.isConnected || byId('learning-view').hidden || state.stage !== 'dictation') return;
          selection.querySelector('h3').focus({ preventScroll: true });
          selection.scrollIntoView({ block: 'start', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
        });
      } catch (error) {
        feedback.textContent = `저장하지 못했어요: ${error.message}`;
        feedback.className = 'answer-feedback incorrect';
        [...form.elements].forEach((element) => { element.disabled = false; });
      }
    });
    panel.append(form);
    if (state.dictationResult) {
      renderSentenceDiff(panel, state.dictationResult);
      renderWordSelection(panel, state.dictationResult);
    }
  }

  function currentPhraseCandidates() {
    const reference = state.scene?.sentenceText || '';
    const saved = (dictationFor()?.words || []).filter(word => /\s/.test(word.term));
    const all = [...phraseCandidates(reference, [...state.expressions.values()]), ...saved];
    return [...new Map(all.map(word => [word.key, word])).values()];
  }

  function togglePhrase(phrase) {
    const scrollTop = byId('practice-panel').scrollTop;
    if (state.selectionDraft.has(phrase.key)) state.selectionDraft.delete(phrase.key);
    else {
      const covered = new Set(phrase.sourceIndexes);
      wordCandidates(state.scene.sentenceText).forEach(word => {
        if (word.sourceIndexes.every(index => covered.has(index))) state.selectionDraft.delete(word.key);
      });
      state.selectionDraft.add(phrase.key);
    }
    renderPractice();
    byId('practice-panel').scrollTop = scrollTop;
  }

  function renderPhraseSelection(panel) {
    const phrases = currentPhraseCandidates();
    if (phrases.length) {
      const group = make('div', 'phrase-options');
      group.append(make('h3', '', '표현을 한 묶음으로 연습해요'));
      phrases.forEach(phrase => {
        const button = make('button', 'phrase-option', phrase.term);
        button.type = 'button'; button.setAttribute('aria-pressed', String(state.selectionDraft.has(phrase.key)));
        button.addEventListener('click', () => togglePhrase(phrase)); group.append(button);
      }); panel.append(group);
    }
  }

  function renderWordSelection(panel, comparison) {
    const candidates = wordCandidates(state.scene.sentenceText, comparison);
    const byIndex = new Map();
    candidates.forEach((candidate) => (candidate.sourceIndexes || []).forEach((index) => byIndex.set(index, candidate)));
    const script = make('div', 'selection-script');
    const ranges = sentenceWordRanges(state.scene.sentenceText);
    script.append(document.createTextNode(state.scene.sentenceText.slice(0, ranges[0]?.start || 0)));
    ranges.forEach((range, index) => {
      const candidate = byIndex.get(index);
      const button = make('button', 'select-word', range.text); button.type = 'button';
      button.setAttribute('aria-pressed', String(Boolean(candidate && state.selectionDraft.has(candidate.key))));
      button.disabled = !candidate;
      if (candidate) button.addEventListener('click', () => {
        const scrollTop = byId('practice-panel').scrollTop;
        if (state.selectionDraft.has(candidate.key)) state.selectionDraft.delete(candidate.key); else state.selectionDraft.add(candidate.key);
        renderPractice();
        byId('practice-panel').scrollTop = scrollTop;
      });
      script.append(button);
      const nextStart = ranges[index + 1]?.start ?? state.scene.sentenceText.length;
      script.append(document.createTextNode(state.scene.sentenceText.slice(range.end, nextStart)));
    });
    const summary = make('div', 'selection-summary');
    summary.append(make('strong', '', state.selectionDraft.size ? `${state.selectionDraft.size}개 선택` : '선택한 단어 없음'));
    [...candidates, ...currentPhraseCandidates()].filter((word) => state.selectionDraft.has(word.key)).forEach((word) => summary.append(make('span', 'selection-chip', word.term)));
    const section = make('section', 'word-selection'); section.id = 'word-selection';
    const heading = make('h3', '', '연습할 단어를 눌러 고르세요'); heading.tabIndex = -1;
    section.append(heading, script, summary);
    renderPhraseSelection(section); panel.append(section);
  }

  function renderSentenceDiff(panel, comparison) {
    const box = make('section', 'sentence-diff');
    box.append(make('h3', '', comparison.correct ? '문장의 단어를 모두 맞혔어요' : '단어 차이를 함께 살펴봐요'));
    const line = make('div', 'diff-line');
    const labels = { replace: '바꿔 쓴 단어', missing: '빠진 단어', extra: '불필요하게 넣은 단어' };
    comparison.operations.forEach((operation) => {
      const shown = operation.kind === 'extra' ? operation.actual
        : operation.kind === 'replace' ? `${operation.actual || '∅'} → ${operation.expected}` : operation.expected;
      const token = make('span', `diff-token diff-${operation.kind}`, shown);
      if (operation.kind !== 'equal') token.append(make('small', '', labels[operation.kind]));
      line.append(token);
    });
    const selectedCount = wordCandidates(state.scene.sentenceText, comparison).filter((word) => word.selected).length;
    const extraCount = comparison.operations.filter((operation) => operation.kind === 'extra').length;
    const resultCopy = comparison.correct ? '문장의 단어를 모두 맞혔어요. 연습할 단어를 직접 골라도 좋아요.'
      : `이번에 다른 단어 ${selectedCount}개를 선택했어요. 더 고르거나 해제할 수 있어요.${extraCount ? ` 불필요하게 넣은 단어 ${extraCount}개는 선택하지 않았어요.` : ''}`;
    box.append(line, make('p', `answer-feedback ${comparison.correct ? 'correct' : 'incorrect'}`, resultCopy));
    panel.append(box);
  }

  async function persistDictation(answer, comparison) {
    const scope = accountScope();
    const videoId = state.videoData.id;
    const sceneId = state.scene.id;
    const contentVersion = state.videoData.contentVersion;
    const reference = state.scene.sentenceText;
    const key = `dictation\u0000${videoId}\u0000${sceneId}\u0000${contentVersion}`;
    return queueProgress(key, async () => {
      if (scope !== accountScope() || scope !== activeScope || videoId !== state.videoData?.id
        || sceneId !== state.scene?.id || contentVersion !== state.videoData?.contentVersion) throw new Error('학습 문장이나 계정이 변경되어 저장을 취소했습니다.');
      const previous = dictationFor(videoId, sceneId, contentVersion);
      const record = makeDictationRecord({ videoId, sceneId, contentVersion, reference, answer, previous });
      let saved;
      try { saved = await store.saveDictation(record, previous?.updatedAt || null, scope); }
      catch (error) {
        if (!isSaveConflict(error)) throw error;
        await reloadStore();
        throw new Error('다른 화면의 최신 받아쓰기 기록을 불러왔어요. 한 번 더 눌러 주세요.');
      }
      if (scope !== accountScope() || scope !== activeScope || videoId !== state.videoData?.id
        || sceneId !== state.scene?.id || contentVersion !== state.videoData?.contentVersion) throw new Error('저장 중 학습 문장이나 계정이 변경되어 현재 화면에는 반영하지 않았습니다.');
      const index = state.dictations.findIndex((item) => dictationKey(item) === dictationKey(saved));
      if (index >= 0) state.dictations[index] = saved; else state.dictations.push(saved);
      updateWordCount();
      return saved;
    });
  }

  function knowledgeFor(word) {
    return wordKnowledge(word, [...state.expressions.values()], state.lexicon);
  }

  function setQuizPrivacy(active, library = false) {
    const learning = byId('learning-view');
    learning.classList.toggle('quiz-masked', active && !library);
    byId('words-view').classList.toggle('library-quiz-active', active && library);
    if (active && !library) {
      learning.removeAttribute('aria-labelledby'); learning.setAttribute('aria-label', '단어 퀴즈 학습');
      byId('learning-title').textContent = '단어 퀴즈'; player?.pause();
    } else if (!library) {
      learning.removeAttribute('aria-label'); learning.setAttribute('aria-labelledby', 'learning-title');
      if (state.video) byId('learning-title').textContent = state.video.title;
    }
    byId('source-info-button').disabled = active && !library;
    if (active && !library) { byId('download-workbook').disabled = true; byId('download-cards').disabled = true; }
  }

  function workspaceEntries(library) {
    return library ? allMistakes() : selectedWords(dictationFor() || {}).map(word => ({ record: dictationFor(), word }));
  }

  function goToWorkspaceItem(index, library) {
    const entries = workspaceEntries(library);
    if (!entries[index]) return;
    stopWorkspaceActivity();
    state.workspaceWordIndex = index; state.workspaceResult = null; state.workspaceComplete = false;
    state.workspaceMode = WORKSPACE_MODES[0]; state.audioPaused = false;
    if (library) state.selectedMistake = { recordKey: dictationKey(entries[index].record), wordKey: entries[index].word.key };
    renderActiveWorkspace(library);
  }

  function advancePractice(library) {
    const entries = workspaceEntries(library);
    const next = nextPractice(state.workspaceMode, state.workspaceWordIndex, entries.map(entry => entry.word),
      word => meaningQuizAvailable(word.term, knowledgeFor(word).meaningKo));
    stopWorkspaceActivity(); state.workspaceResult = null;
    if (next.complete) { state.workspaceComplete = true; renderActiveWorkspace(library); return; }
    if (next.index !== state.workspaceWordIndex) return goToWorkspaceItem(next.index, library);
    state.workspaceMode = next.mode; state.audioPaused = false;
    renderActiveWorkspace(library);
  }

  function scheduleAdvance(record, word, library) {
    if (!state.autoAdvance || document.hidden) return;
    const context = captureWorkspaceContext(record, word, state.workspaceMode, library);
    window.clearTimeout(autoTimer);
    autoTimer = window.setTimeout(() => {
      autoTimer = null;
      if (state.autoAdvance && !document.hidden && workspaceContextMatches(context)) advancePractice(library);
    }, 1100);
  }

  function renderWorkspaceGuide(host, record, words, word, hidden, library) {
    host.replaceChildren();
    const back = make('button', 'secondary-button return-video', '← 영상으로 돌아가기');
    back.addEventListener('click', () => {
      if (library) { stopWorkspaceActivity(); if (canNavigateSource(record)) openVideo(record.videoId, record.sceneId, true, record.contentVersion); else route('library'); }
      else setStage('listen');
    });
    host.append(back, make('p', 'eyebrow', '차근차근, 한 단어씩'), make('h2', '', '오늘의 연습 길'));
    host.append(make('p', 'helper', '한 단어의 연습을 마치면 다음 단어로 이어져요. 원하는 단어나 연습을 직접 골라도 괜찮아요.'));
    const queue = make('ol', 'word-queue');
    workspaceEntries(library).forEach((entry, index) => {
      const li = make('li'); const done = isCompletedWord(entry.word);
      const button = make('button', '', `${index + 1}. ${hidden ? '연습 항목' : entry.word.term}${done ? ' ✓' : ''}`);
      button.setAttribute('aria-current', String(index === state.workspaceWordIndex));
      button.addEventListener('click', () => goToWorkspaceItem(index, library)); li.append(button); queue.append(li);
    }); host.append(queue);
    const label = make('label', 'auto-advance'); const checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.checked = state.autoAdvance;
    checkbox.addEventListener('change', () => {
      state.autoAdvance = checkbox.checked; window.clearTimeout(autoTimer); autoTimer = null;
      if (state.autoAdvance && workspaceResultMatches(record, word, state.workspaceMode) && state.workspaceResult.correct) scheduleAdvance(record, word, library);
    }); label.append(checkbox, document.createTextNode('정답이면 자동으로 이어가기')); host.append(label);
    if (!hidden) {
      const family = findWordFamily(word.term, state.families);
      const note = make('div', 'context-note');
      note.append(make('strong', '', /\s/.test(word.term) ? '표현도 한 묶음으로' : '소리와 뜻을 연결해요'));
      note.append(make('p', '', family?.noteKo || '먼저 뜻을 이해하고 소리를 들은 뒤, 글자를 쓰고 스스로 떠올려 봐요.'));
      host.append(note);
    } else host.append(make('p', 'quiz-focus', '지금은 힌트를 잠시 가렸어요. 들은 소리와 기억에 집중해요.'));
  }

  function renderWorkspace(panel, record, words, library = false, libraryEntries = null) {
    player?.pause(); speechLoop.stop(); repeatControl = null;
    sentencePlayback?.destroy(); sentencePlayback = null;
    byId('learning-view').classList.toggle('cloze-active', !library && state.workspaceMode === 'cloze' && !state.workspaceComplete);
    if (!record || !words.length) {
      setQuizPrivacy(false, library);
      panel.append(make('div', 'empty-state', '고른 단어가 없어요. 단어를 다시 골라 보세요.')); return;
    }
    state.workspaceWordIndex = Math.max(0, Math.min(state.workspaceWordIndex, words.length - 1));
    const entry = libraryEntries?.[state.workspaceWordIndex];
    if (entry) record = entry.record;
    const word = entry?.word || words[state.workspaceWordIndex];
    const knowledge = knowledgeFor(word);
    const quizHidden = !state.workspaceComplete && ['cloze', 'meaning', 'audio'].includes(state.workspaceMode)
      && !workspaceResultMatches(record, word, state.workspaceMode);
    setQuizPrivacy(quizHidden, library);
    const guide = library ? make('aside', 'workspace-sidebar library-guide') : byId('workspace-sidebar');
    renderWorkspaceGuide(guide, record, words, word, quizHidden, library);
    if (library) panel.append(guide);
    if (state.workspaceComplete) {
      const done = make('section', 'practice-complete');
      done.append(make('span', 'completion-mark', '✓'), make('h2', '', '고른 단어의 연습 길을 돌아봤어요'), make('p', '', '혼자 읽은 단어는 다음 복습에도 다시 만나요.'));
      const again = make('button', 'secondary-button', '첫 단어 다시 연습'); again.addEventListener('click', () => goToWorkspaceItem(0, library)); done.append(again);
      const completed = make('button', 'secondary-button', '완료 단어 보기');
      completed.addEventListener('click', () => { state.selectedMistake = null; state.wordFilter = 'completed'; route('words'); }); done.append(completed);
      if (!library) { const next = make('button', 'primary-button', '다음 문장 듣기'); next.addEventListener('click', advanceScene); done.append(next); }
      panel.append(done); return;
    }
    const shell = make('div', 'workspace-shell');
    shell.dataset.mode = state.workspaceMode;
    const header = make('div', 'workspace-header');
    const previous = make('button', 'secondary-button', '← 이전'); const next = make('button', 'secondary-button', '다음 단어 →');
    previous.disabled = state.workspaceWordIndex === 0; next.disabled = state.workspaceWordIndex === words.length - 1;
    previous.addEventListener('click', () => changeWorkspaceWord(-1, library)); next.addEventListener('click', () => changeWorkspaceWord(1, library));
    const title = make('div'); title.append(make('h2', 'workspace-word-title', quizHidden ? '기억해서 써 봐요' : word.term), make('span', 'workspace-position', `단어 ${state.workspaceWordIndex + 1} / ${words.length} · 연습 ${WORKSPACE_MODES.indexOf(state.workspaceMode) + 1} / ${WORKSPACE_MODES.length}`));
    header.append(previous, title, next);
    const modes = make('div', 'workspace-modes'); modes.setAttribute('aria-label', '연습 방법');
    WORKSPACE_MODES.forEach((mode, index) => {
      const button = make('button', '', `${index + 1} ${MODE_LABELS[mode]}`); button.type = 'button';
      button.dataset.mode = mode; button.setAttribute('aria-pressed', String(mode === state.workspaceMode));
      button.disabled = mode === 'meaning' && !meaningQuizAvailable(word.term, knowledge.meaningKo);
      if (button.disabled) button.title = '뜻·표현에서 한국어 뜻을 적으면 사용할 수 있어요.';
      button.addEventListener('click', () => { stopWorkspaceActivity(); state.workspaceMode = mode; state.audioPaused = false; state.workspaceResult = null; renderActiveWorkspace(library); }); modes.append(button);
    });
    const task = make('section', 'workspace-task'); task.tabIndex = -1;
    renderWorkspaceTask(task, record, word, knowledge, library, guide);
    const answerForm = task.querySelector(':scope > .answer-form');
    if (answerForm) {
      const content = make('div', 'task-content');
      [...task.childNodes].filter(node => node !== answerForm).forEach(node => content.append(node));
      task.replaceChildren(content, answerForm); task.classList.add('has-answer');
    }
    const navigation = make('div', 'practice-step-actions');
    const proceed = make('button', 'secondary-button', ['explain', 'point'].includes(state.workspaceMode) ? (state.workspaceMode === 'explain' ? '뜻을 살펴봤어요 →' : '짚어 읽었어요 →') : workspaceResultMatches(record, word, state.workspaceMode) && state.workspaceResult.correct ? '지금 이어가기 →' : '이 연습 건너뛰기 →');
    proceed.addEventListener('click', () => advancePractice(library)); navigation.append(proceed);
    if (workspaceResultMatches(record, word, state.workspaceMode) && state.workspaceResult.correct && state.autoAdvance) navigation.prepend(make('span', 'auto-feedback', '잘했어요! 다음 연습으로 이어져요.'));
    shell.append(header, modes, task, navigation); panel.append(shell);
    modes.querySelector('[aria-pressed="true"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    task.querySelector('.answer-form input:not(:disabled)')?.focus({ preventScroll: true });
  }

  function renderActiveWorkspace(library = false) {
    if (library) return renderWordLibrary();
    renderPractice();
  }

  function changeWorkspaceWord(offset, library) {
    goToWorkspaceItem(state.workspaceWordIndex + offset, library);
  }

  function updateRepeatControl() {
    if (!repeatControl) return;
    repeatControl.textContent = speechLoop.isActive() ? '소리 반복 멈추기' : '소리 반복 시작';
    repeatControl.setAttribute('aria-pressed', String(speechLoop.isActive()));
  }

  function appendRepeatControl(task, word, autostart = true) {
    const row = make('div', 'repeat-audio'); const button = make('button', 'secondary-button', '소리 반복 시작');
    repeatControl = button;
    button.addEventListener('click', () => { if (speechLoop.isActive()) speechLoop.stop(); else { letterSpeaker.cancel(); speechLoop.start(word.term); } updateRepeatControl(); });
    row.append(button, make('span', 'helper', '기기의 영어 음성 · 듣고 쓰는 동안 반복해요')); task.append(row);
    if (autostart && !state.audioPaused && !document.hidden) { letterSpeaker.cancel(); speechLoop.start(word.term); } updateRepeatControl();
  }

  function appendSentenceAudio(task, guide, record, word, library, autostart) {
    const source = make('section', 'sentence-audio');
    source.append(make('h3', '', '영상 속 문장 듣기'));
    const mount = make('div', 'sentence-player');
    const feedback = make('p', 'helper sentence-audio-status', '문장 영상을 준비하고 있어요.');
    feedback.setAttribute('role', 'status');
    source.append(mount, feedback);
    guide.querySelector('.return-video').after(source);
    const row = make('div', 'repeat-audio');
    const replay = make('button', 'secondary-button', '문장 처음부터 듣기');
    const toggle = make('button', 'secondary-button', '문장 반복 시작');
    replay.type = toggle.type = 'button';
    row.append(replay, toggle, make('span', 'helper', 'YouTube 원본 음성 · 빈칸이 포함된 문장 전체를 들어요.'));
    task.append(row);
    const context = captureWorkspaceContext(record, word, 'cloze', library);
    const update = () => {
      const active = controller.isActive();
      toggle.textContent = active ? '문장 반복 멈추기' : '문장 반복 시작';
      toggle.setAttribute('aria-pressed', String(active));
    };
    const controller = createSentencePlayback({
      element: mount,
      rate: Number(byId('rate-select').value),
      loadVideo: async videoId => {
        if (state.videoData?.id === videoId) return state.videoData;
        if (!state.catalog.some(video => video.id === videoId)) throw new Error('원본 영상을 찾지 못했어요.');
        const response = await fetch(`./data/videos/${encodeURIComponent(videoId)}.json`);
        if (!response.ok) throw new Error('문장 영상을 불러오지 못했어요. 다시 눌러 주세요.');
        return response.json();
      },
      onStatus: event => {
        if (sentencePlayback !== controller) return;
        if (event.message) feedback.textContent = event.message;
        update();
      }
    });
    sentencePlayback = controller;
    let prepared = false;
    let prepareSequence = 0;
    const prepare = async autoplay => {
      const sequence = ++prepareSequence;
      prepared = false;
      const ready = await controller.prepare(record, { autoplay });
      if (sentencePlayback !== controller || sequence !== prepareSequence) return;
      prepared = ready;
      update();
    };
    const play = () => {
      if (!workspaceContextMatches(context) || document.hidden) return;
      speechLoop.stop(); letterSpeaker.cancel(); player?.pause();
      if (prepared) controller.play(); else void prepare(true);
      update();
    };
    replay.addEventListener('click', play);
    toggle.addEventListener('click', () => {
      if (!workspaceContextMatches(context) || document.hidden) return;
      if (controller.isActive()) controller.pause(); else play();
      update();
    });
    void prepare(autostart && !state.audioPaused && !document.hidden);
    update();
  }

  function appendPronunciation(card, ipa) {
    if (!ipa) { card.append(make('p', 'helper', '발음기호 준비 중 · 소리를 들으며 함께 읽어 주세요.')); return; }
    const line = make('p', 'ipa pronunciation');
    ipa.split(/([ˈˌ])/).forEach(part => line.append(['ˈ', 'ˌ'].includes(part) ? make('mark', 'stress-mark', part) : document.createTextNode(part)));
    card.append(line, make('p', 'helper', /[ˈˌ]/.test(ipa) ? 'ˈ 뒤 음절을 가장 힘주어 읽어요. ˌ는 약한 강세예요.' : '이 발음기호에는 강세 표시가 없어요. 한 음절 단어는 보통 표시를 생략해요.'));
  }

  function appendHighlightedIndexes(container, reference, indexes = []) {
    const selected = new Set(indexes);
    let last = 0;
    sentenceWordRanges(reference).forEach((range, index) => {
      container.append(document.createTextNode(reference.slice(last, range.start)));
      container.append(selected.has(index) ? make('mark', '', range.text) : document.createTextNode(range.text));
      last = range.end;
    });
    container.append(document.createTextNode(reference.slice(last)));
  }

  function renderWorkspaceTask(task, record, word, knowledge, library, guide) {
    const mode = state.workspaceMode;
    if (mode === 'point') {
      task.append(make('h3', '', '문장 속 단어를 짚어 읽어요'));
      const source = make('div', 'workspace-source'); source.tabIndex = 0; const selected = new Set(word.sourceIndexes || [word.sourceIndex]); let last = 0;
      const ranges = sentenceWordRanges(record.reference); state.activeWord = Math.min(state.activeWord, Math.max(0, ranges.length - 1));
      ranges.forEach((range, index) => {
        source.append(document.createTextNode(record.reference.slice(last, range.start)));
        const token = make('button', `word-button${selected.has(index) ? ' active' : ''}`, range.text); token.type = 'button'; token.addEventListener('click', () => { state.activeWord = index; speakWord(range.text); source.querySelectorAll('.word-button').forEach((node, position) => node.classList.toggle('active', position === index)); }); source.append(token); last = range.end;
      }); source.append(document.createTextNode(record.reference.slice(last)));
      source.addEventListener('keydown', (event) => { const buttons = [...source.querySelectorAll('.word-button')]; if (event.key === 'ArrowRight') state.activeWord = Math.min(buttons.length - 1, state.activeWord + 1); else if (event.key === 'ArrowLeft') state.activeWord = Math.max(0, state.activeWord - 1); else if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); return speakWord(buttons[state.activeWord]?.textContent || ''); } else return; event.preventDefault(); buttons[state.activeWord]?.focus(); });
      const listen = make('button', 'secondary-button', '단어·표현 듣기'); listen.addEventListener('click', () => speakWord(word.term));
      task.append(source, listen); return;
    }
    if (mode === 'explain') {
      task.append(make('h3', '', '뜻과 표현'));
      if (knowledge.meaningKo) {
        task.append(make('p', 'ipa', knowledge.ipa || ''), make('p', 'meaning', knowledge.meaningKo), make('p', 'explanation', knowledge.explanationKo || '문장 속 쓰임을 함께 살펴보세요.'));
        (knowledge.dialogues || []).slice(0, 2).forEach((dialogue, index) => {
          const card = make('div', 'dialogue-card'); card.append(make('h3', '', `${index + 1}. ${dialogue.titleKo || '대화'}`));
          (dialogue.lines || []).forEach((line) => card.append(make('p', '', `${line.speaker}: ${line.en} · ${line.ko}`))); task.append(card);
        });
      } else task.append(make('p', 'instruction', '아직 준비된 한국어 뜻이 없어요. 부모가 아래에 짧은 뜻을 적어 주세요.'));
      const family = findWordFamily(word.term, state.families);
      const packageBox = make('section', 'word-family');
      packageBox.append(make('h3', '', family ? family.titleKo : '함께 배우는 말'));
      if (family) {
        packageBox.append(make('p', 'helper', family.noteKo));
        family.items.forEach(item => {
          const card = make('article', 'family-item');
          card.append(make('span', 'part-of-speech', item.labelKo), make('strong', '', item.term), make('span', '', item.meaningKo), make('p', 'family-example', item.exampleEn), make('small', '', item.exampleKo));
          const listen = make('button', 'text-button', '예문 듣기'); listen.addEventListener('click', () => speakWord(item.exampleEn)); card.append(listen); packageBox.append(card);
        });
      } else packageBox.append(make('p', 'helper', '이 말의 관련어 묶음은 준비 중이에요. 우선 영상 속 문장과 뜻을 함께 익혀요.'));
      task.append(packageBox);
      const form = make('form', 'meaning-entry'); const label = make('label', '', '부모가 적는 한국어 뜻');
      const input = document.createElement('input'); input.type = 'text'; input.maxLength = 300; input.value = word.meaningKo || ''; label.append(input);
      const save = make('button', 'secondary-button', '뜻 저장'); save.type = 'submit'; const feedback = make('p', 'answer-feedback');
      form.append(label, save, feedback); form.addEventListener('submit', async (event) => {
        event.preventDefault(); const meaning = input.value.trim(); if (!meaning) return feedback.textContent = '한국어 뜻을 적어 주세요.';
        if (!meaningQuizAvailable(word.term, meaning)) return feedback.textContent = '뜻·표현에서 영어 정답을 빼고 한국어 뜻을 적어 주세요.';
        save.disabled = true; const context = captureWorkspaceContext(record, word, 'explain', library);
        try { await persistVocabularyMutation(record, word.key, (latestWord) => ({ ...latestWord, meaningKo: meaning }), library); if (!workspaceContextMatches(context)) return; state.workspaceResult = null; renderActiveWorkspace(library); }
        catch (error) { feedback.textContent = `저장하지 못했어요: ${error.message}`; save.disabled = false; }
      }); task.append(form); return;
    }
    if (mode === 'cloze') {
      task.append(make('h3', '', '문장 빈칸에 단어를 써요'));
      const sentence = make('p', 'cloze-sentence');
      const ranges = sentenceWordRanges(record.reference);
      const indexes = word.sourceIndexes || [word.sourceIndex];
      const count = sentenceWordRanges(word.term).length;
      let last = 0;
      for (let index = 0; index < indexes.length; index += count) {
        const first = ranges[indexes[index]]; const end = ranges[indexes[index + count - 1]];
        if (!first || !end) continue;
        sentence.append(document.createTextNode(record.reference.slice(last, first.start)), make('span', 'cloze-blank', '____'));
        last = end.end;
      }
      sentence.append(document.createTextNode(record.reference.slice(last))); task.append(sentence);
      appendSentenceAudio(task, guide, record, word, library, !workspaceResultMatches(record, word, mode));
      task.append(makePracticeForm(record, word, mode, '빈칸에 들어갈 단어·표현', library)); return;
    }
    if (mode === 'meaning' || mode === 'audio') {
      const revealed = workspaceResultMatches(record, word, mode);
      task.append(make('h3', '', mode === 'meaning' ? '뜻을 보고 영어 단어를 써요' : '소리를 듣고 영어 단어를 써요'));
      const prompt = make('div', 'quiz-prompt');
      if (mode === 'meaning' && !meaningQuizAvailable(word.term, knowledge.meaningKo)) {
        prompt.textContent = '뜻·표현에서 영어 정답을 빼고 한국어 뜻을 적어 주세요.';
        task.append(prompt);
        return;
      }
      if (mode === 'meaning') prompt.textContent = knowledge.meaningKo;
      else appendRepeatControl(prompt, word, !revealed);
      task.append(prompt, makePracticeForm(record, word, mode, '영어 단어', library));
      if (revealed) task.append(make('p', 'meaning', `정답: ${word.term}`));
      return;
    }
    if (mode === 'reading') {
      const card = make('div', 'reading-card'); card.append(make('div', 'term', word.term));
      appendPronunciation(card, knowledge.ipa);
      const hear = make('button', 'text-button', '발음 들어보기'); hear.addEventListener('click', () => speakWord(word.term)); card.append(hear);
      task.append(make('h3', '', '소리 내어 읽고 부모가 확인해요'), card);
      const actions = make('div', 'reading-actions'); const independent = make('button', 'independent-button', '혼자 읽었어요'); const helped = make('button', 'helped-button', '도움이 필요해요');
      if (workspaceResultMatches(record, word, mode) && state.workspaceResult.correct) { independent.disabled = true; helped.disabled = true; }
      const runReading = createSingleFlight();
      const submitReading = (result) => runReading(async () => {
        independent.disabled = true; helped.disabled = true;
        const saved = await saveReadingPractice(record, word, result, library);
        if (!saved) { independent.disabled = false; helped.disabled = false; }
      });
      independent.addEventListener('click', () => submitReading(true)); helped.addEventListener('click', () => submitReading(false));
      actions.append(independent, helped); task.append(actions);
      if (workspaceResultMatches(record, word, mode)) task.append(make('p', 'answer-feedback correct', state.workspaceResult.correct && word.review?.dueAt ? `저장했어요. 다음 확인: ${new Date(word.review.dueAt).toLocaleDateString('ko-KR')}` : '도움을 받은 기록을 저장했어요.'));
      return;
    }
    task.append(make('h3', '', '단어 철자를 천천히 써요'));
    const indicator = make('div', 'letter-indicator', '·'); indicator.setAttribute('aria-hidden', 'true');
    const typed = make('div', 'typed-word', ''); typed.setAttribute('aria-hidden', 'true');
    const display = make('div', 'spelling-display'); display.append(indicator, typed);
    task.append(display, makePracticeForm(record, word, 'spelling', '영어 단어', library, indicator));
  }

  function makePracticeForm(record, word, mode, labelText, library, indicator = null) {
    const form = make('form', 'answer-form'); const label = make('label', '', labelText); const input = document.createElement('input'); input.type = 'text'; input.maxLength = 100; input.autocomplete = 'off'; input.autocapitalize = 'off'; input.spellcheck = false; input.enterKeyHint = 'done'; label.append(input);
    const submit = make('button', 'primary-button', '확인'); submit.type = 'submit'; const feedback = make('p', 'answer-feedback'); let previous = '';
    if (indicator) input.addEventListener('input', (event) => {
      const letters = insertedLetters(previous, input.value, event.inputType, event.isComposing); previous = input.value;
      const typed = indicator.parentElement?.querySelector('.typed-word');
      if (typed) {
        typed.replaceChildren();
        [...input.value].forEach((character, index, characters) => typed.append(make('span', index === characters.length - 1 ? 'typed-current' : '', character)));
      }
      if (letters) {
        letterSpeaker.enqueue(letters); indicator.textContent = letters.at(-1);
        if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
          [indicator, typed].filter(Boolean).forEach(node => { node.getAnimations().forEach(animation => animation.cancel()); node.animate([{ transform: 'scale(.82) translateY(7px)', opacity: .55 }, { transform: 'scale(1.12) translateY(-4px)', opacity: 1 }, { transform: 'scale(1) translateY(0)', opacity: 1 }], { duration: 330, easing: 'ease-out' }); });
        }
      }
    });
    form.append(label, submit, feedback);
    if (workspaceResultMatches(record, word, mode)) {
      const result = state.workspaceResult; input.value = result.answer; input.disabled = true; submit.type = 'button'; submit.textContent = '다시 해보기'; feedback.textContent = result.correct ? '맞게 썼어요.' : `다시 살펴봐요. 정답은 ${word.term}입니다.`; feedback.className = `answer-feedback ${result.correct ? 'correct' : 'incorrect'}`;
      submit.addEventListener('click', () => { stopWorkspaceActivity(); state.workspaceResult = null; renderActiveWorkspace(library); }); return form;
    }
    form.addEventListener('submit', async (event) => {
      event.preventDefault(); if (submit.disabled) return; const answer = input.value.trim(); if (!answer) { feedback.textContent = '먼저 답을 적어 주세요.'; feedback.className = 'answer-feedback incorrect'; return; }
      const correct = checkAnswer(answer, word.term); submit.disabled = true; input.disabled = true; speechLoop.stop(); letterSpeaker.cancel(); sentencePlayback?.pause();
      const context = captureWorkspaceContext(record, word, mode, library);
      try { await persistVocabularyMutation(record, word.key, (latestWord) => registerPractice(latestWord, mode, answer, correct), library); if (!workspaceContextMatches(context)) return; state.workspaceResult = { ...context, answer, correct }; renderActiveWorkspace(library); if (correct) scheduleAdvance(record, word, library); }
      catch (error) { feedback.textContent = `저장하지 못했어요: ${error.message}`; feedback.className = 'answer-feedback incorrect'; submit.disabled = false; input.disabled = false; }
    }); return form;
  }

  function captureWorkspaceContext(record, word, mode, library) {
    return { recordKey: dictationKey(record), wordKey: word.key, mode, library, scope: accountScope(), epoch: workspaceEpoch };
  }

  function workspaceContextMatches(context) {
    if (!context || context.epoch !== workspaceEpoch || context.scope !== accountScope() || context.scope !== activeScope || state.workspaceMode !== context.mode) return false;
    if (context.library) return !byId('words-view').hidden && state.selectedMistake?.recordKey === context.recordKey && state.selectedMistake?.wordKey === context.wordKey;
    return !byId('learning-view').hidden && state.stage === 'workspace' && dictationKey(dictationFor() || {}) === context.recordKey && selectedWords(dictationFor() || {})[state.workspaceWordIndex]?.key === context.wordKey;
  }

  function workspaceResultMatches(record, word, mode) {
    const result = state.workspaceResult;
    return Boolean(result && result.recordKey === dictationKey(record) && result.wordKey === word.key && result.mode === mode);
  }

  async function saveReadingPractice(record, word, independent, library) {
    const context = captureWorkspaceContext(record, word, 'reading', library);
    try { await persistVocabularyMutation(record, word.key, (latestWord) => registerPractice(latestWord, 'reading', independent ? 'independent' : 'helped', independent), library); if (!workspaceContextMatches(context)) return true; state.workspaceResult = { ...context, answer: independent ? 'independent' : 'helped', correct: independent }; if (independent) state.completedItems.add(`${dictationKey(record)}:${word.key}`); renderActiveWorkspace(library); if (independent) scheduleAdvance(record, word, library); status('읽기 기록을 저장했어요.'); return true; }
    catch (error) { status(`읽기 기록을 저장하지 못했어요: ${error.message}`, 'error', 0); return false; }
  }

  async function persistVocabularyMutation(record, wordKey, mutate, library) {
    const scope = accountScope(); const key = `dictation\u0000${dictationKey(record)}`;
    return queueProgress(key, async () => {
      if (scope !== accountScope() || scope !== activeScope) throw new Error('계정이 변경되어 저장을 취소했습니다.');
      const latest = state.dictations.find((item) => dictationKey(item) === dictationKey(record));
      if (!latest) throw new Error('단어 기록을 찾지 못했습니다.');
      const updated = { ...latest, words: latest.words.map((item) => item.key === wordKey ? mutate(item) : item), updatedAt: new Date().toISOString() };
      let saved;
      try { saved = await store.saveDictation(updated, latest.updatedAt || null, scope); }
      catch (error) { if (!isSaveConflict(error)) throw error; await reloadStore(); throw new Error('최신 단어 기록을 불러왔어요. 한 번 더 눌러 주세요.'); }
      if (scope !== accountScope() || scope !== activeScope) throw new Error('계정이 변경되어 현재 화면에는 반영하지 않았습니다.');
      const index = state.dictations.findIndex((item) => dictationKey(item) === dictationKey(saved)); if (index >= 0) state.dictations[index] = saved; else state.dictations.push(saved);
      updateWordCount(); updateReviewCount(); return saved;
    });
  }

  function speakWord(text) {
    speechLoop.stop(); letterSpeaker.cancel(); sentencePlayback?.pause();
    const word = text.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
    if (!word || !speak(word, playerStatus)) status('이 기기에서 영어 단어 읽어주기를 사용할 수 없어요.', 'error');
  }

  async function setStage(stage) {
    if (!STAGES.includes(stage)) return;
    const context = currentStageContext();
    if (!canEnterStage(stage, context)) {
      return status('먼저 들은 문장 전체를 받아쓰고 저장해 주세요.');
    }
    if (stage === 'workspace' && state.stage !== 'workspace') return enterWorkspace();
    stopWorkspaceActivity(); state.workspaceResult = null;
    if (stage === 'dictation') {
      const saved = dictationFor();
      state.dictationResult = savedDictationComparison(saved, state.scene?.sentenceText);
      state.selectionDraft = new Set(saved?.selectedKeys || []);
    }
    state.stage = stage;
    renderPractice();
    byId('practice-panel').focus?.();
  }

  async function enterWorkspace() {
    const record = dictationFor();
    if (!record) return status('먼저 들은 문장 전체를 받아쓰고 저장해 주세요.');
    stopWorkspaceActivity(); player?.pause();
    const entryEpoch = workspaceEpoch;
    const scope = accountScope(); const key = `dictation\u0000${dictationKey(record)}`; const selectedKeys = [...state.selectionDraft];
    const phraseChoices = currentPhraseCandidates();
    try {
      const saved = await queueProgress(key, async () => {
        if (scope !== accountScope() || scope !== activeScope) throw new Error('계정이 변경되어 저장을 취소했습니다.');
        const latest = dictationFor(record.videoId, record.sceneId, record.contentVersion);
        const updated = commitSelection(latest, selectedKeys, new Date(), phraseChoices);
        let result;
        try { result = await store.saveDictation(updated, latest.updatedAt || null, scope); }
        catch (error) { if (!isSaveConflict(error)) throw error; await reloadStore(); throw new Error('최신 단어 선택을 불러왔어요. 다시 눌러 주세요.'); }
        if (scope !== accountScope() || scope !== activeScope || record.videoId !== state.videoData?.id || record.sceneId !== state.scene?.id || record.contentVersion !== state.videoData?.contentVersion) throw new Error('학습 문장이나 계정이 변경되어 현재 화면에는 반영하지 않았습니다.');
        const index = state.dictations.findIndex((item) => dictationKey(item) === dictationKey(result)); if (index >= 0) state.dictations[index] = result; else state.dictations.push(result); return result;
      });
      if (entryEpoch !== workspaceEpoch) return;
      updateWordCount();
      state.workspaceComplete = false; state.completedItems.clear();
      if (!selectedWords(saved).length) return advanceScene();
      state.stage = 'workspace'; state.workspaceMode = 'explain'; state.workspaceWordIndex = 0; state.workspaceResult = null; renderPractice();
    } catch (error) { status(`고른 단어를 저장하지 못했어요: ${error.message}`, 'error', 0); }
  }

  function advance() {
    if (state.stage === 'listen') return setStage('dictation');
    if (state.stage === 'dictation') return enterWorkspace();
    advanceScene();
  }

  function advanceScene() {
    const scenes = selectableScenes(state.videoData);
    const index = scenes.findIndex((scene) => scene.id === state.scene.id);
    if (index >= 0 && index < scenes.length - 1) selectScene(scenes[index + 1]);
    else { status('이 영상의 마지막 문장까지 마쳤어요.'); route('library'); }
  }

  async function ensurePlayer() {
    byId('player-poster').hidden = true;
    if (!player) player = createPlayer(byId('player-mount'), playerStatus);
    const instance = player;
    const playbackEpoch = workspaceEpoch;
    const sceneId = state.scene.id;
    const start = state.scene.start;
    const end = state.scene.end;
    const videoId = sourceVideoId(state.videoData.sourceUrl || state.video.sourceUrl);
    if (!videoId) throw new Error('YouTube 영상 ID를 찾지 못했어요.');
    if (!state.playerLoaded) await instance.load(videoId, start, end);
    if (instance !== player || sceneId !== state.scene?.id || playbackEpoch !== workspaceEpoch || state.stage === 'workspace' || byId('learning-view').hidden || document.hidden) { instance.pause(); return false; }
    state.playerLoaded = true;
    byId('player-poster').hidden = true;
    instance.setLoop(byId('loop-toggle').checked);
    instance.setRate(Number(byId('rate-select').value));
    instance.play({ restart: true });
    return true;
  }

  function preparePlayer() {
    const videoId = sourceVideoId(state.videoData?.sourceUrl || state.video?.sourceUrl);
    if (!videoId || !state.scene) return;
    const instance = player = createPlayer(byId('player-mount'), playerStatus);
    const sceneId = state.scene.id;
    [...byId('rate-select').options].forEach(option => { option.disabled = false; });
    instance.setRate(Number(byId('rate-select').value));
    instance.load(videoId, state.scene.start, state.scene.end).then(() => {
      if (player === instance && state.scene?.id === sceneId) state.playerLoaded = true;
    }).catch(error => {
      if (player === instance) playerStatus({ type: 'error', message: error.message });
    });
  }

  async function playRange(range) {
    stopWorkspaceActivity();
    try { await ensurePlayer(range); }
    catch (error) {
      playerStatus({ type: 'error', message: `재생할 수 없어요: ${error.message}` });
    }
  }
  function openWordStudy(record, wordKey) {
    state.workspaceComplete = false; state.completedItems.clear();
    state.selectedMistake = { recordKey: dictationKey(record), wordKey };
    state.workspaceMode = 'explain'; state.workspaceWordIndex = 0; state.workspaceResult = null; state.showVocabularyList = false;
    route('words');
  }

  function selectedMistakeEntry() {
    if (!state.selectedMistake) return null;
    const record = state.dictations.find((item) => dictationKey(item) === state.selectedMistake.recordKey);
    const word = record?.words?.find((item) => item.key === state.selectedMistake.wordKey);
    return record && word ? { record, word } : null;
  }

  function renderWordLibrary() {
    const list = byId('word-list'); list.replaceChildren();
    const entries = allMistakes();
    const visible = filterVocabulary(entries, state.wordFilter);
    byId('word-empty').hidden = visible.length > 0;
    byId('word-empty').textContent = state.wordFilter === 'completed' ? '아직 완료한 단어가 없어요. 혼자 읽기를 마치면 여기에 모여요.' : state.wordFilter === 'learning' ? '공부 중인 단어가 없어요.' : '아직 모인 단어가 없어요. 한 대화를 받아써 보세요.';
    document.querySelectorAll('[data-word-filter]').forEach(button => {
      const filter = button.dataset.wordFilter;
      button.setAttribute('aria-pressed', String(filter === state.wordFilter));
      button.textContent = `${{ all: '전체', learning: '공부 중', completed: '공부 완료' }[filter]} ${filterVocabulary(entries, filter).length}`;
    });
    visible.forEach(({ record, word }) => {
      const button = make('button', 'mistake-button'); button.type = 'button';
      const video = state.catalog.find((item) => item.id === record.videoId);
      const total = vocabularyAttemptCount(word);
      const copy = make('span'); copy.append(make('strong', '', word.term));
      const meta = make('span', 'vocabulary-meta');
      meta.append(make('span', '', word.registeredAt ? `등록 ${new Date(word.registeredAt).toLocaleDateString('ko-KR')}` : '이전 학습 기록 · 등록일 미상'));
      meta.append(make('span', '', `${video?.title || record.videoId} · 연습 ${total}회`));
      const modeSummary = Object.entries(word.practice || {}).map(([mode, result]) => `${MODE_LABELS[mode] || mode} ${result.correct || 0}/${result.attempts || 0}`).join(' · ');
      if (modeSummary) meta.append(make('span', '', modeSummary)); copy.append(meta);
      if (isCompletedWord(word)) meta.append(make('span', 'completed-label', `혼자 읽기 완료 · ${word.practice.reading.correct}회`));
      button.append(copy, make('span', isCompletedWord(word) ? 'studied' : '', '연습 열기 →'));
      button.addEventListener('click', () => openWordStudy(record, word.key)); list.append(button);
    });
    const panel = byId('word-study-panel'); panel.replaceChildren(); const entry = selectedMistakeEntry(); panel.hidden = !entry;
    list.hidden = Boolean(entry && !state.showVocabularyList);
    if (entry) {
      const activeIndex = entries.findIndex((item) => dictationKey(item.record) === state.selectedMistake.recordKey && item.word.key === state.selectedMistake.wordKey);
      state.workspaceWordIndex = Math.max(0, activeIndex);
      const toggle = make('button', 'text-button', state.showVocabularyList ? '단어 목록 접기' : `단어 목록 보기 (${entries.length})`);
      toggle.addEventListener('click', () => { state.showVocabularyList = !state.showVocabularyList; renderWordLibrary(); }); panel.append(toggle);
      renderWorkspace(panel, entry.record, entries.map((item) => item.word), true, entries);
    } else setQuizPrivacy(false, true);
  }

  function renderReviews() {
    const list = byId('review-list');
    list.replaceChildren();
    const learned = state.progress.filter((record) => record.reading?.result);
    const visible = state.showAllReviews ? learned : learned.filter((record) => isDue(record, new Date()));
    const learnedWords = allMistakes().filter(({ word }) => word.review?.dueAt);
    const visibleWords = state.showAllReviews ? learnedWords : learnedWords.filter(({ word }) => isDue(word.review, new Date()));
    const toggle = byId('review-filter-toggle');
    toggle.textContent = state.showAllReviews ? '오늘 복습만 보기' : `학습한 카드 모두 보기 (${learned.length + learnedWords.length})`;
    toggle.setAttribute('aria-pressed', String(state.showAllReviews));
    byId('review-empty').hidden = visible.length + visibleWords.length > 0;
    visible.forEach((record) => {
      const expression = state.expressions.get(record.expressionId);
      const video = state.catalog.find((item) => item.id === record.videoId);
      if (!expression) return;
      const item = make('article', 'review-item');
      const copy = make('div');
      copy.append(make('span', 'term', expression.term));
      copy.append(make('p', 'meta', `${video?.title || '원본 영상'} · 최근 ${record.reading.result === 'independent' ? '혼자 읽음' : '도움 받아 읽음'}`));
      const actions = make('div', 'actions');
      const speakButton = make('button', '', '소리 도움');
      speakButton.addEventListener('click', () => speak(expression.term, playerStatus));
      const videoButton = make('button', '', canNavigateSource(record) ? '영상 문장' : '이전 자료 위치 없음');
      videoButton.disabled = !canNavigateSource(record);
      if (canNavigateSource(record)) videoButton.addEventListener('click', () => openVideo(record.videoId, record.sceneId, true, record.contentVersion));
      const independent = make('button', '', '혼자 읽음');
      const helped = make('button', '', '도움 필요');
      independent.addEventListener('click', () => updateReviewRecord(record, true));
      helped.addEventListener('click', () => updateReviewRecord(record, false));
      actions.append(speakButton, videoButton, independent, helped);
      item.append(copy, actions);
      list.append(item);
    });
    visibleWords.forEach(({ record, word }) => {
      const item = make('article', 'review-item'); const copy = make('div'); const video = state.catalog.find((entry) => entry.id === record.videoId);
      copy.append(make('span', 'term', word.term), make('p', 'meta', `${video?.title || record.videoId} · 단어 읽기 복습`));
      const actions = make('div', 'actions'); const open = make('button', '', '읽기 복습 열기');
      open.addEventListener('click', () => { state.selectedMistake = { recordKey: dictationKey(record), wordKey: word.key }; state.workspaceMode = 'reading'; state.workspaceWordIndex = 0; state.workspaceResult = null; route('words'); });
      actions.append(open); item.append(copy, actions); list.append(item);
    });
  }

  async function updateReviewRecord(record, independent) {
    const scope = accountScope();
    const key = recordKey(record);
    try {
      await queueProgress(key, async () => {
        if (scope !== accountScope() || scope !== activeScope) throw new Error('저장 전에 계정이 변경되어 요청을 취소했습니다.');
        const latest = state.progress.find((item) => recordKey(item) === key) || record;
        const now = new Date();
        const updated = {
          ...latest,
          reading: { result: independent ? 'independent' : 'helped', lastCheckedAt: now.toISOString() },
          review: nextReview(latest.review, independent, now),
          updatedAt: now.toISOString()
        };
        const saved = await saveProgressVersioned(updated, latest, scope);
        if (scope !== accountScope() || scope !== activeScope) throw new Error('저장 중 계정이 변경되어 현재 화면에는 반영하지 않았습니다.');
        const index = state.progress.findIndex((item) => recordKey(item) === key);
        if (index >= 0) state.progress[index] = saved; else state.progress.push(saved);
      });
      renderReviews(); updateReviewCount();
      status('복습 읽기 기록을 저장했어요.');
    } catch (error) { status(`복습을 저장하지 못했어요: ${error.message}`, 'error', 0); }
  }

  function renderSourceInfo() {
    const holder = byId('source-info-content'); holder.replaceChildren();
    const flags = [...(state.videoData?.qualityFlags || []), ...(state.scene?.qualityFlags || [])];
    const list = make('dl', 'source-details');
    const rows = [
      ['생성 방식', state.videoData?.generationMethod || 'editorial-bank+deterministic-match'],
      ['대본 상태', state.videoData?.sourceStatus || 'captured-not-audio-verified'],
      ['검토 상태', state.videoData?.reviewStatus || 'unreviewed'],
      ['콘텐츠 버전', state.videoData?.contentVersion || '1'],
      ['품질 표시', flags.length ? flags.join(', ') : '없음']
    ];
    rows.forEach(([term, value]) => { list.append(make('dt', '', term), make('dd', '', value)); });
    holder.append(make('p', '', '준비된 대본과 편집 표현은행을 규칙으로 연결한 학습 자료입니다. 영상 음성과 사람이 대조 완료한 자막으로 표시하지 않습니다.'), list);
  }

  function renderAccount() {
    const root = byId('account-content'); root.replaceChildren();
    root.append(make('h2', '', '부모 계정과 학습 기록'));
    const mode = make('p', 'account-state', state.mode === 'cloud'
      ? `${state.session?.user?.email || '부모 계정'}으로 로그인되어 있습니다.`
      : auth.configured ? '현재 게스트입니다. 진도는 이 브라우저에만 저장됩니다.' : '계정 서버가 연결되지 않았습니다. 현재 진도는 이 브라우저에만 저장됩니다. 공개 가입 기능은 백엔드 설정 후 사용할 수 있습니다.');
    root.append(mode);
    const nicknameLabel = make('label', '', '학습자 별칭');
    const nickname = document.createElement('input'); nickname.type = 'text'; nickname.value = state.nickname; nickname.maxLength = 30;
    nicknameLabel.append(nickname);
    const saveNickname = make('button', 'primary-button', '별칭 저장');
    saveNickname.addEventListener('click', async () => {
      const scope = accountScope(); const nextNickname = nickname.value.trim() || '학습자1';
      try { await store.setNickname(nextNickname, scope); if (scope !== accountScope() || scope !== activeScope) return; state.nickname = nextNickname; refreshProfileUi(); status('별칭을 저장했어요.'); }
      catch (error) { status(error.message, 'error'); }
    });
    root.append(nicknameLabel, saveNickname);

    if (state.mode === 'cloud') {
      const accountButtons = make('div', 'button-row');
      const signOut = make('button', '', '로그아웃');
      signOut.addEventListener('click', async () => {
        try {
          await auth.signOut(); await reloadStore(); renderAccount();
          status('로그아웃했어요. 게스트 기록은 계정 기록과 자동으로 합치지 않습니다.');
        } catch (error) { status(`로그아웃을 완료하지 못했어요: ${error.message}`, 'error', 0); }
      });
      accountButtons.append(signOut);
      root.append(accountButtons);
    } else {
      const fields = make('div', 'field-stack');
      const emailLabel = make('label', '', '부모 이메일'); const email = document.createElement('input'); email.type = 'email'; email.autocomplete = 'email'; emailLabel.append(email);
      const passwordLabel = make('label', '', '비밀번호'); const password = document.createElement('input'); password.type = 'password'; password.autocomplete = 'current-password'; password.minLength = 8; passwordLabel.append(password);
      fields.append(emailLabel, passwordLabel); root.append(fields);
      const buttons = make('div', 'button-row');
      const signIn = make('button', 'primary-button', '로그인');
      const signUp = make('button', '', '부모 계정 만들기');
      signIn.disabled = !auth.configured; signUp.disabled = !auth.configured;
      signIn.addEventListener('click', () => accountAction(() => auth.signIn(email.value, password.value), '로그인했습니다.'));
      signUp.addEventListener('click', () => accountAction(() => auth.signUp(email.value, password.value), '확인 메일의 링크를 연 뒤 여기서 이메일과 비밀번호로 로그인해 주세요.'));
      buttons.append(signIn, signUp); root.append(buttons);
    }

    const dataButtons = make('div', 'button-row');
    const exportButton = make('button', '', '내 기록 JSON 저장');
    exportButton.addEventListener('click', async () => {
      const scope = accountScope();
      try { const data = await store.exportData(scope); if (scope !== accountScope() || scope !== activeScope) return; downloadJson(data, `word-trail-${new Date().toISOString().slice(0, 10)}.json`); }
      catch (error) { status(`기록을 내보내지 못했어요: ${error.message}`, 'error', 0); }
    });
    const reset = make('button', 'danger', '학습 진도 초기화');
    reset.addEventListener('click', async () => {
      if (!confirm('이 학습자의 진도와 복습 기록을 초기화할까요? 되돌릴 수 없습니다.')) return;
      const scope = accountScope();
      try {
        await store.resetProgress(scope);
        if (scope !== accountScope() || scope !== activeScope) return;
        state.progress = [];
        state.dictations = [];
        clearUiState(scope);
        resetActiveLearning();
        renderContinue();
        renderWordLibrary();
        renderReviews();
        updateReviewCount();
        updateWordCount();
        status('학습 진도를 초기화했어요.');
      }
      catch (error) { status(`초기화하지 못했어요: ${error.message}`, 'error', 0); }
    });
    dataButtons.append(exportButton, reset); root.append(dataButtons);
    if (state.mode === 'cloud') {
      const danger = make('div', 'danger-zone');
      const deletion = make('button', 'danger', '계정과 내 데이터 삭제');
      deletion.addEventListener('click', async () => {
        if (!confirm('부모 계정과 연결된 학습 데이터를 영구 삭제할까요?')) return;
        try { await auth.deleteAccount(); await reloadStore(); byId('account-dialog').close(); status('계정 삭제 요청을 완료했어요.'); }
        catch (error) { status(`계정을 삭제하지 못했어요: ${error.message}`, 'error', 0); }
      });
      danger.append(deletion); root.append(danger);
    }
  }

  async function accountAction(action, successMessage) {
    try { await action(); await reloadStore(); renderAccount(); status(successMessage); }
    catch (error) { status(`계정 작업을 완료하지 못했어요: ${error.message}`, 'error', 0); }
  }

  function downloadJson(data, filename) {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = filename; link.click(); URL.revokeObjectURL(url);
  }

  function selectedExportBundle() {
    const record = dictationFor(); const words = selectedWords(record || {}); const ranges = sentenceWordRanges(record?.reference || '');
    const expressions = words.map((word) => {
      const knowledge = knowledgeFor(word);
      return { id: word.key, term: word.term, ipa: knowledge.ipa || '', meaningKo: knowledge.meaningKo || '부모 뜻 입력 필요', explanationKo: knowledge.explanationKo || '영상 문장 속 소리와 철자를 연습해요.', dialogues: knowledge.dialogues || [] };
    });
    const targets = words.map((word) => {
      const range = phraseRange(ranges, word) || { start: 0, end: word.term.length };
      return { expressionId: word.key, quote: record.reference, matchStart: range.start, matchEnd: range.end, start: state.scene.start, end: state.scene.end };
    });
    return { expressions, scene: { ...state.scene, targets } };
  }

  function startBreakTimer() {
    window.clearTimeout(state.breakTimer);
    if (storageGet(BREAK_KEY) !== 'true') return;
    state.breakTimer = window.setTimeout(() => status('잠깐 쉬어 갈까요? 화면에서 눈을 떼고 몸을 움직여 보세요.', 'info', 0), 25 * 60 * 1000);
  }

  function saveCorrection() {
    const note = byId('correction-note').value.trim();
    if (!note) return status('메모 내용을 적어 주세요.', 'error');
    const key = scopedStorageKey(NOTE_KEY, accountScope());
    let notes = []; try { notes = JSON.parse(storageGet(key)) || []; } catch {}
    notes.push({ videoId: state.video.id, sceneId: state.scene.id, expressionId: selectedWords(dictationFor() || {})[state.workspaceWordIndex]?.key || null, note, createdAt: new Date().toISOString() });
    try {
      if (!storageSet(key, JSON.stringify(notes))) throw new Error('storage unavailable');
      byId('note-dialog').close(); byId('correction-note').value = '';
      status('원본을 바꾸지 않고 이 계정 범위의 로컬 메모로 저장했어요.');
    } catch { status('이 브라우저에 문제 메모를 저장할 수 없어요.', 'error', 0); }
  }

  function bindEvents() {
    document.querySelectorAll('[data-route]').forEach((button) => button.addEventListener('click', () => route(button.dataset.route)));
    byId('video-search').addEventListener('input', renderCatalog);
    document.querySelectorAll('input[name="duration"]').forEach((input) => input.addEventListener('change', renderCatalog));
    document.querySelectorAll('#stage-nav button').forEach((button) => button.addEventListener('click', () => setStage(button.dataset.stage)));
    byId('next-action').addEventListener('click', advance);
    byId('previous-target').addEventListener('click', () => setStage('dictation'));
    byId('load-play-button').addEventListener('click', () => playRange('scene'));
    byId('play-scene-button').addEventListener('click', () => playRange('scene'));
    byId('pause-button').addEventListener('click', () => { stopWorkspaceActivity(); player?.pause(); });
    byId('play-target-button').addEventListener('click', () => playRange('scene'));
    byId('loop-toggle').addEventListener('change', (event) => player?.setLoop(event.target.checked));
    byId('rate-select').addEventListener('change', (event) => player?.setRate(Number(event.target.value)));
    byId('source-info-button').addEventListener('click', () => { stopWorkspaceActivity(); renderSourceInfo(); byId('info-dialog').showModal(); });
    byId('account-button').addEventListener('click', () => { stopWorkspaceActivity(); renderAccount(); byId('account-dialog').showModal(); });
    byId('download-workbook').addEventListener('click', () => {
      const bundle = selectedExportBundle(); if (!bundle.expressions.length) return status('먼저 연습할 단어를 골라 저장해 주세요.');
      downloadWorkbook({ title: state.video.title, video: state.videoData, scene: bundle.scene, expressions: bundle.expressions });
    });
    byId('download-cards').addEventListener('click', () => {
      const bundle = selectedExportBundle(); if (!bundle.expressions.length) return status('먼저 연습할 단어를 골라 저장해 주세요.');
      downloadCards({ title: state.video.title, video: state.videoData, scene: bundle.scene, expressions: bundle.expressions });
    });
    byId('skip-scene').addEventListener('click', () => { const scenes = selectableScenes(state.videoData); const index = scenes.findIndex((scene) => scene.id === state.scene.id); if (index < scenes.length - 1) selectScene(scenes[index + 1]); else route('library'); });
    byId('correction-button').addEventListener('click', () => { stopWorkspaceActivity(); byId('note-dialog').showModal(); });
    byId('save-correction').addEventListener('click', saveCorrection);
    byId('review-filter-toggle').addEventListener('click', () => { state.showAllReviews = !state.showAllReviews; renderReviews(); });
    document.querySelectorAll('[data-word-filter]').forEach(button => button.addEventListener('click', () => {
      stopWorkspaceActivity(); state.wordFilter = button.dataset.wordFilter; state.selectedMistake = null; state.showVocabularyList = true; renderWordLibrary();
    }));
    const breakBox = byId('break-reminder'); breakBox.checked = storageGet(BREAK_KEY) === 'true';
    breakBox.addEventListener('change', () => {
      if (!storageSet(BREAK_KEY, String(breakBox.checked))) status('쉬는 시간 설정을 이 브라우저에 저장할 수 없어요.', 'error');
      startBreakTimer();
    });
    window.addEventListener('popstate', () => restoreRequestedRoute(location.hash.slice(1) || 'library'));
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) { state.audioPaused = true; stopWorkspaceActivity(); player?.pause(); }
      else if (!byId('learning-view').hidden && state.stage === 'workspace') renderActiveWorkspace(false);
      else if (!byId('words-view').hidden && state.selectedMistake) renderActiveWorkspace(true);
    });
    window.addEventListener('pagehide', () => { stopWorkspaceActivity(); player?.pause(); });
    window.addEventListener('beforeunload', () => { stopWorkspaceActivity(); sentencePlayback?.destroy(); player?.destroy(); });
  }

  async function restoreRequestedRoute(requestedRoute) {
    if (requestedRoute !== 'learning') return route(requestedRoute, false);
    if (state.video && state.scene) return route('learning', false);
    const saved = loadUiState(accountScope());
    if (saved.videoId) await openVideo(saved.videoId, saved.sceneId, false, saved.contentVersion);
    else route('library', false);
  }

  function showConfirmationNotice() {
    if (auth.confirmationStatus === 'returned') {
      status('확인 링크에서 돌아왔어요. 이메일 확인을 마쳤다면 부모 계정에서 로그인해 주세요.', 'info', 0);
    } else if (auth.confirmationStatus === 'error') {
      status('확인 링크가 만료되었거나 사용할 수 없어요. 새 확인 메일을 요청하거나 다시 가입해 주세요.', 'error', 0);
    }
  }

  async function boot() {
    try {
      if (window.matchMedia('(max-width: 1000px)').matches) byId('scene-list-panel').removeAttribute('open');
      bindEvents();
      const [catalogResponse, expressionResponse, lexiconResponse, familyResponse] = await Promise.all([
        fetch('./data/catalog.json'), fetch('./data/expressions.json'), fetch('./data/vocabulary.json'), fetch('./data/word-families.json')
      ]);
      if (!catalogResponse.ok || !expressionResponse.ok || !lexiconResponse.ok || !familyResponse.ok) throw new Error('학습 데이터 파일을 읽지 못했습니다.');
      const [catalog, expressions, lexicon, families] = await Promise.all([catalogResponse.json(), expressionResponse.json(), lexiconResponse.json(), familyResponse.json()]);
      state.families = families;
      state.catalog = Array.isArray(catalog.videos) ? catalog.videos : [];
      state.expressions = new Map((Array.isArray(expressions) ? expressions : expressions.expressions || []).map((item) => [item.id, item]));
      state.lexicon = Array.isArray(lexicon) ? lexicon : lexicon.words || [];
      await reloadStore();
      renderCatalog();
      const unsubscribe = auth.subscribe(async (session) => {
        const nextScope = accountScope(session);
        const accountChanged = activeScope !== null && activeScope !== nextScope;
        if (accountChanged) clearForAccountTransition(session, nextScope);
        else state.session = session;
        try {
          await reloadStore(); renderCatalog(); if (byId('account-dialog').open) renderAccount();
        } catch (error) {
          if (accountChanged && activeScope === nextScope) {
            byId('mode-title').textContent = '계정 자료 불러오기 실패';
            byId('mode-copy').textContent = '이전 계정 자료는 표시하지 않았습니다. 연결을 확인하고 다시 로그인해 주세요.';
          }
          status(`계정 진도를 불러오지 못했어요: ${error.message}`, 'error', 0);
        }
      });
      window.addEventListener('pagehide', unsubscribe, { once: true });
      await restoreRequestedRoute(location.hash.slice(1) || 'library');
      showConfirmationNotice();
    } catch (error) {
      status(`앱을 시작하지 못했어요: ${error.message}`, 'error', 0);
      byId('video-grid').replaceChildren(make('p', 'empty-state', '학습 자료를 불러오지 못했습니다. 로컬 서버를 다시 시작해 주세요.'));
    }
  }

  boot();
}

if (typeof window !== 'undefined' && typeof document !== 'undefined') startApp();
