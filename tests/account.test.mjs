import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createAuth } from '../public/lib/auth.js';
import { createStore } from '../public/lib/store.js';

class MemoryStorage {
  values = new Map();
  getItem(key) { return this.values.get(key) ?? null; }
  setItem(key, value) { this.values.set(key, String(value)); }
  removeItem(key) { this.values.delete(key); }
}

function response(status, body) {
  return {
    ok: status >= 200 && status < 300, status,
    async json() { return body; },
    async text() { return body == null ? '' : JSON.stringify(body); },
  };
}

function dictationRecord(overrides = {}) {
  return {
    learnerId: 'default', videoId: 'video-01', sceneId: 'c0001', contentVersion: '2026.09.25-1',
    reference: 'Can we play outside?', answer: 'Can we play outside?', attempts: 1,
    words: [{
      key: 'video-01:c0001:play:2', term: 'play', kind: 'replace', typed: 'plai', sourceIndex: 2,
      studied: false, studyAttempts: 0, lastAnswer: '',
    }],
    ...overrides,
  };
}

test('unconfigured auth is a truthful guest session', async () => {
  const auth = createAuth({ storage: new MemoryStorage() });
  assert.equal(auth.configured, false);
  assert.equal(await auth.getSession(), null);
  await assert.rejects(auth.signIn('a@example.com', 'password'), /설정되지/);
});

test('auth signs in, refreshes an expired token, and clears on sign out', async () => {
  const storage = new MemoryStorage();
  const calls = [];
  const fetch = async (url, init) => {
    calls.push([url, init]);
    if (url.includes('grant_type=password')) return response(200, {
      access_token: 'old', refresh_token: 'refresh', expires_at: 1,
      user: { id: 'user-a', email: 'parent@example.com' },
    });
    if (url.includes('grant_type=refresh_token')) return response(200, {
      access_token: 'new', refresh_token: 'refresh-2', expires_at: 4_000_000_000,
      user: { id: 'user-a', email: 'parent@example.com' },
    });
    if (url.endsWith('/logout')) return response(204, null);
    throw new Error(`unexpected ${url}`);
  };
  const auth = createAuth({ supabaseUrl: 'https://test.supabase.co', supabaseAnonKey: 'public', storage, fetch });
  await auth.signIn('parent@example.com', 'secret');
  assert.equal((await auth.getSession()).access_token, 'new');
  await auth.signOut();
  assert.equal(await auth.getSession(), null);
  assert.equal(calls.filter(([url]) => url.includes('refresh_token')).length, 1);
});

test('email callback strips token fragments without replacing the existing session', async () => {
  const storage = new MemoryStorage();
  storage.setItem('wordtrail:auth:v1:https://test.supabase.co', JSON.stringify({
    access_token: 'old-token', refresh_token: 'old-refresh', expires_at: 4_000_000_000,
    user: { id: 'previous-user', email: 'previous@example.com' },
  }));
  const location = {
    hash: '#access_token=attacker-token&refresh_token=attacker-refresh&type=signup',
    origin: 'https://wordtrail.example', pathname: '/account', search: '?welcome=1',
  };
  let replaced = '';
  const auth = createAuth({
    supabaseUrl: 'https://test.supabase.co', supabaseAnonKey: 'public', storage, location,
    history: { replaceState(_state, _title, url) { replaced = url; } }, fetch: async () => response(500, {}),
  });
  assert.deepEqual(await auth.getSession(), {
    user: { id: 'previous-user', email: 'previous@example.com' },
    access_token: 'old-token',
  });
  assert.equal(auth.confirmationStatus, 'returned');
  assert.equal(replaced, '/account?welcome=1');
});

test('a token fragment cannot create a session when the browser has none', async () => {
  const storage = new MemoryStorage();
  createAuth({
    supabaseUrl: 'https://test.supabase.co', supabaseAnonKey: 'public', storage,
    location: { hash: '#access_token=fake&refresh_token=fake', pathname: '/', search: '' },
    history: { replaceState() {} }, fetch: async () => response(500, {}),
  });
  assert.equal(storage.getItem('wordtrail:auth:v1:https://test.supabase.co'), null);
});

test('an email callback error is sanitized and exposed only as a generic status', async () => {
  const storage = new MemoryStorage();
  let replaced = '';
  const auth = createAuth({
    supabaseUrl: 'https://test.supabase.co', supabaseAnonKey: 'public', storage,
    location: {
      hash: '#error=access_denied&error_description=%3Cimg%20src=x%20onerror=alert(1)%3E',
      pathname: '/account', search: '?code=untrusted&keep=1',
    },
    history: { replaceState(_state, _title, url) { replaced = url; } }, fetch: async () => response(500, {}),
  });
  assert.equal(auth.confirmationStatus, 'error');
  assert.equal(replaced, '/account?keep=1');
  assert.equal(await auth.getSession(), null);
});

test('guest mutations fail clearly when browser storage is unavailable', async () => {
  const store = createStore(createAuth({ storage: null }));
  await assert.rejects(store.setNickname('서현'), /저장할 수 없습니다/);
  await assert.rejects(store.startLearning('video-01', 's001'), /저장할 수 없습니다/);
});

test('client rejects invalid catalog ids and oversized progress before storage', async () => {
  const store = createStore(createAuth({ storage: new MemoryStorage() }));
  await assert.rejects(store.startLearning('other-video', 'scene-1'), /올바른 영상/);
  await assert.rejects(store.saveProgress({
    learnerId: 'default', videoId: 'video-01', sceneId: 's001', expressionId: 'okay',
    contentVersion: '2026.09.25-1', spelling: { lastAnswer: 'x'.repeat(9000) }, reading: {}, review: {},
  }), /500자|8KB/);
});

test('guest dictation is backward compatible, persistent, and rejects stale writes', async () => {
  const storage = new MemoryStorage();
  storage.setItem('wordtrail:guest:v1', JSON.stringify({ nickname: '기존', progress: [], starts: [] }));
  const store = createStore(createAuth({ storage }));
  assert.deepEqual((await store.load()).dictations, []);
  const saved = await store.saveDictation(dictationRecord());
  assert.equal((await store.load()).dictations[0].sceneId, 'c0001');
  const revised = await store.saveDictation({ ...saved, attempts: 2 }, saved.updatedAt);
  await assert.rejects(store.saveDictation({ ...saved, answer: 'stale' }, saved.updatedAt), /다른 화면/);
  assert.equal((await store.load()).dictations[0].updatedAt, revised.updatedAt);
  await assert.rejects(store.saveDictation(dictationRecord({ reference: 'x'.repeat(2001) })), /2,000자/);
  await assert.rejects(store.saveDictation(dictationRecord({ words: Array(201).fill(dictationRecord().words[0]) })), /200개/);
  assert.equal((await store.exportData()).dictations.length, 1);
  await store.resetProgress();
  assert.deepEqual((await store.load()).dictations, []);
});

test('selected vocabulary metadata persists and invalid optional fields are rejected before storage', async () => {
  const storage = new MemoryStorage();
  const store = createStore(createAuth({ storage }));
  const word = {
    ...dictationRecord().words[0],
    key: 'word:play', kind: 'manual', sourceIndexes: [2, 5],
    registeredAt: '2026-09-25T12:00:00.000Z', meaningKo: '놀다',
    lastPracticedAt: '2026-09-25T12:10:00.000Z',
    practice: {
      spelling: { attempts: 2, correct: 1, lastPracticedAt: '2026-09-25T12:10:00.000Z' },
      reading: { attempts: 1, correct: 1, lastPracticedAt: '2026-09-25T12:11:00.000Z' },
    },
    review: { step: 2, dueAt: '2026-09-29T00:00:00.000Z', lastReviewedDate: '2026-09-25' },
  };
  const saved = await store.saveDictation(dictationRecord({ selectedKeys: ['word:play'], words: [word] }));
  assert.deepEqual(saved.selectedKeys, ['word:play']);
  assert.equal(saved.words[0].practice.spelling.correct, 1);
  assert.equal(saved.words[0].review.step, 2);

  const invalidRecords = [
    [dictationRecord({ selectedKeys: ['word:play', 'word:play'] }), /중복/],
    [dictationRecord({ selectedKeys: ['not-canonical'] }), /선택 단어 키/],
    [dictationRecord({ selectedKeys: ['word:ghost'], words: [word] }), /저장된 단어/],
    [dictationRecord({ selectedKeys: [], words: [{ ...word, key: 'arbitrary-key' }] }), /canonical key/],
    [dictationRecord({ selectedKeys: [], words: [word, { ...word, term: 'Play' }] }), /고유한 단어/],
    [dictationRecord({ words: [{ ...word, meaningKo: '가'.repeat(301) }] }), /300자/],
    [dictationRecord({ words: [{ ...word, sourceTerm: 'g'.repeat(101) }] }), /100자/],
    [dictationRecord({ words: [{ ...word, sourceIndexes: Array.from({ length: 201 }, (_, index) => index) }] }), /위치 목록/],
    [dictationRecord({ words: [{ ...word, registeredAt: 'yesterday' }] }), /등록 시간/],
    [dictationRecord({ words: [{ ...word, registeredAt: '2026-02-31T12:00:00Z' }] }), /등록 시간/],
    [dictationRecord({ words: [{ ...word, studyAttempts: 2147483648 }] }), /단어 형식/],
    [dictationRecord({ words: [{ ...word, practice: { spelling: { attempts: 1, correct: 2, lastPracticedAt: '2026-09-25T12:00:00Z' } } }] }), /연습 횟수/],
    [dictationRecord({ words: [{ ...word, practice: { unknown: { attempts: 1, correct: 1, lastPracticedAt: '2026-09-25T12:00:00Z' } } }] }), /연습 기록/],
    [dictationRecord({ words: [{ ...word, review: { step: 4, dueAt: '2026-09-29T00:00:00Z', lastReviewedDate: '2026-09-25' } }] }), /복습 일정/],
  ];
  for (const [record, message] of invalidRecords) await assert.rejects(store.saveDictation(record), message);
  assert.equal((await store.load()).dictations.length, 1);
});

test('guest progress, nickname, reset, and distinct daily starts persist locally', async () => {
  const storage = new MemoryStorage();
  const auth = createAuth({ storage });
  const store = createStore(auth);
  await store.setNickname('서현');
  const record = {
    learnerId: 'default', videoId: 'video-01', sceneId: 's001', expressionId: 'okay', contentVersion: '2026.09.25-1',
    spelling: { attempts: 1, correct: true, hints: 0, lastAnswer: 'okay' },
    reading: { result: 'independent', lastCheckedAt: '2026-09-25T00:00:00Z' },
    review: { step: 1, dueAt: '2026-09-26T00:00:00Z', lastReviewedDate: '2026-09-25' },
  };
  const saved = await store.saveProgress(record);
  assert.deepEqual(await store.load(), { nickname: '서현', progress: [saved], dictations: [], mode: 'guest' });
  const stale = { ...saved, reading: { result: 'helped' } };
  const revised = await store.saveProgress({ ...saved, spelling: { ...saved.spelling, attempts: 2 } }, saved.updatedAt);
  await assert.rejects(store.saveProgress(stale, saved.updatedAt), /다른 화면/);
  assert.equal((await store.load()).progress[0].updatedAt, revised.updatedAt);
  for (let index = 0; index < 10; index += 1) {
    assert.equal((await store.startLearning('video-01', `s${String(index + 1).padStart(3, '0')}`)).allowed, true);
  }
  assert.deepEqual(await store.startLearning('video-02', 's001'), { allowed: false, remaining: 0, reason: 'daily_limit' });
  assert.equal((await store.startLearning('video-01', 's001')).allowed, true, 'an existing scene resumes without charge');
  await store.resetProgress();
  assert.deepEqual(await store.load(), { nickname: '서현', progress: [], dictations: [], mode: 'guest' });
  assert.equal((await store.startLearning('video-02', 's002')).allowed, false, 'reset does not bypass the daily start limit');
});

test('cloud writes use the current user token and reject a mid-request account switch', async () => {
  const storage = new MemoryStorage();
  let session = { user: { id: 'user-a', email: 'a@example.com' }, access_token: 'token-a' };
  const auth = {
    config: { supabaseUrl: 'https://test.supabase.co', supabaseAnonKey: 'public' }, storage,
    async getSession() { return session; },
  };
  const seen = [];
  auth.config.fetch = async (url, init) => {
    seen.push([url, init]);
    if (url.includes('/rpc/save_progress')) session = { user: { id: 'user-b', email: 'b@example.com' }, access_token: 'token-b' };
    return response(200, JSON.parse(init.body).p_record);
  };
  const record = {
    videoId: 'video-01', sceneId: 's001', expressionId: 'okay', contentVersion: '2026.09.25-1',
    spelling: {}, reading: {}, review: {},
  };
  await assert.rejects(createStore(auth).saveProgress(record), /계정이 변경/);
  assert.equal(seen[0][1].headers.Authorization, 'Bearer token-a');
  assert.equal(storage.getItem('wordtrail:guest:v1'), null, 'cloud failures never fall back into guest data');
});

test('expected scope blocks progress before any write when A becomes B during context resolution', async () => {
  const storage = new MemoryStorage();
  let fetchCount = 0;
  let session = { user: { id: 'user-a', email: '' }, access_token: 'a' };
  const auth = {
    config: {
      supabaseUrl: 'https://test.supabase.co', supabaseAnonKey: 'public',
      fetch: async () => { fetchCount += 1; return response(200, {}); },
    },
    storage,
    async getSession() {
      await Promise.resolve();
      session = { user: { id: 'user-b', email: '' }, access_token: 'b' };
      return session;
    },
  };
  await assert.rejects(createStore(auth).saveProgress({
    learnerId: 'default', videoId: 'video-01', sceneId: 's001', expressionId: 'okay',
    contentVersion: '2026.09.25-1', spelling: {}, reading: {}, review: {},
  }, null, 'user-a'), /계정이 변경/);
  assert.equal(fetchCount, 0);
  assert.equal(storage.getItem('wordtrail:guest:v1'), null);
});

test('expected guest scope blocks dictation if login completes before context resolves', async () => {
  const storage = new MemoryStorage();
  let fetchCount = 0;
  const auth = {
    config: {
      supabaseUrl: 'https://test.supabase.co', supabaseAnonKey: 'public',
      fetch: async () => { fetchCount += 1; return response(200, {}); },
    },
    storage,
    async getSession() {
      await Promise.resolve();
      return { user: { id: 'user-a', email: '' }, access_token: 'a' };
    },
  };
  await assert.rejects(createStore(auth).saveDictation(dictationRecord(), null, 'guest'), /계정이 변경/);
  assert.equal(fetchCount, 0);
  assert.equal(storage.getItem('wordtrail:guest:v1'), null);
});

test('expected account scope blocks all user actions before A can act on account B', async () => {
  const storage = new MemoryStorage();
  let fetchCount = 0;
  const auth = {
    config: {
      supabaseUrl: 'https://test.supabase.co', supabaseAnonKey: 'public',
      fetch: async () => { fetchCount += 1; return response(200, []); },
    },
    storage,
    async getSession() {
      await Promise.resolve();
      return { user: { id: 'user-b', email: '' }, access_token: 'b' };
    },
  };
  const store = createStore(auth);
  const actions = [
    () => store.load('user-a'),
    () => store.startLearning('video-01', 'c0001', 'user-a'),
    () => store.exportData('user-a'),
    () => store.resetProgress('user-a'),
    () => store.setNickname('서현', 'user-a'),
  ];
  for (const action of actions) await assert.rejects(action(), /계정이 변경/);
  assert.equal(fetchCount, 0);
  assert.equal(storage.getItem('wordtrail:guest:v1'), null);
});

test('scoped load rejects A to B transition before accepting or caching B data', async () => {
  const storage = new MemoryStorage();
  let fetchCount = 0;
  const auth = {
    config: {
      supabaseUrl: 'https://test.supabase.co', supabaseAnonKey: 'public',
      fetch: async () => { fetchCount += 1; return response(200, [{ nickname: 'B' }]); },
    },
    storage,
    async getSession() {
      await Promise.resolve();
      return { user: { id: 'user-b', email: 'b@example.com' }, access_token: 'token-b' };
    },
  };
  await assert.rejects(createStore(auth).load('user-a'), /계정이 변경/);
  assert.equal(fetchCount, 0);
  assert.equal(storage.getItem('wordtrail:cloud:user-a:v1'), null);
  assert.equal(storage.getItem('wordtrail:cloud:user-b:v1'), null);
});

test('scoped load rejects guest to account transition before reading either scope', async () => {
  const storage = new MemoryStorage();
  storage.setItem('wordtrail:guest:v1', JSON.stringify({ nickname: '게스트', progress: [], dictations: [], starts: [] }));
  let fetchCount = 0;
  const auth = {
    config: {
      supabaseUrl: 'https://test.supabase.co', supabaseAnonKey: 'public',
      fetch: async () => { fetchCount += 1; return response(200, []); },
    },
    storage,
    async getSession() {
      await Promise.resolve();
      return { user: { id: 'user-a', email: '' }, access_token: 'token-a' };
    },
  };
  await assert.rejects(createStore(auth).load('guest'), /계정이 변경/);
  assert.equal(fetchCount, 0);
  assert.equal(JSON.parse(storage.getItem('wordtrail:guest:v1')).nickname, '게스트');
});

test('expected guest scope blocks reset before login can delete cloud data', async () => {
  const storage = new MemoryStorage();
  const guestData = JSON.stringify({ nickname: '기존', progress: [{ id: 'keep' }], dictations: [], starts: [] });
  storage.setItem('wordtrail:guest:v1', guestData);
  let fetchCount = 0;
  const auth = {
    config: {
      supabaseUrl: 'https://test.supabase.co', supabaseAnonKey: 'public',
      fetch: async () => { fetchCount += 1; return response(200, []); },
    },
    storage,
    async getSession() {
      await Promise.resolve();
      return { user: { id: 'user-a', email: '' }, access_token: 'a' };
    },
  };
  await assert.rejects(createStore(auth).resetProgress('guest'), /계정이 변경/);
  assert.equal(fetchCount, 0);
  assert.equal(storage.getItem('wordtrail:guest:v1'), guestData);
});

test('cloud load keeps account caches isolated by user id', async () => {
  const storage = new MemoryStorage();
  let session = { user: { id: 'user-a', email: '' }, access_token: 'a' };
  const auth = {
    config: {
      supabaseUrl: 'https://test.supabase.co', supabaseAnonKey: 'public',
      fetch: async (url) => url.includes('/profiles') ? response(200, [{ nickname: session.user.id }]) : response(200, []),
    },
    storage, async getSession() { return session; },
  };
  const store = createStore(auth);
  assert.equal((await store.load()).nickname, 'user-a');
  session = { user: { id: 'user-b', email: '' }, access_token: 'b' };
  assert.equal((await store.load()).nickname, 'user-b');
  assert.ok(storage.getItem('wordtrail:cloud:user-a:v1'));
  assert.ok(storage.getItem('wordtrail:cloud:user-b:v1'));
});

test('two cloud clients cannot overwrite a newer whole-record save', async () => {
  const storage = new MemoryStorage();
  let current = {
    learnerId: 'default', videoId: 'video-01', sceneId: 's001', expressionId: 'okay',
    contentVersion: '2026.09.25-1', spelling: {}, reading: {}, review: {}, updatedAt: '2026-09-25T10:00:00.000Z',
  };
  let sequence = 0;
  const fetch = async (url, init = {}) => {
    if (url.includes('/profiles')) return response(200, [{ nickname: '서현' }]);
    if (url.includes('/learning_progress?')) return response(200, [{ record: current }]);
    if (url.includes('/learning_dictations?')) return response(200, []);
    if (url.includes('/rpc/save_progress')) {
      const body = JSON.parse(init.body);
      if (body.p_expected_updated_at !== current.updatedAt) return response(409, { message: 'progress_conflict: reload' });
      sequence += 1;
      current = { ...body.p_record, updatedAt: `2026-09-25T10:00:0${sequence}.000Z` };
      return response(200, current);
    }
    throw new Error(`unexpected ${url}`);
  };
  const auth = {
    config: { supabaseUrl: 'https://test.supabase.co', supabaseAnonKey: 'public', fetch }, storage,
    async getSession() { return { user: { id: 'user-a', email: '' }, access_token: 'a' }; },
  };
  const first = createStore(auth);
  const second = createStore(auth);
  const firstView = (await first.load()).progress[0];
  const staleView = (await second.load()).progress[0];
  const saved = await first.saveProgress({ ...firstView, spelling: { attempts: 2 } }, firstView.updatedAt);
  assert.notEqual(saved.updatedAt, firstView.updatedAt);
  await assert.rejects(
    second.saveProgress({ ...staleView, reading: { result: 'helped' } }, staleView.updatedAt),
    /progress_conflict/,
  );
});

test('cloud dictation uses its CAS RPC and rejects a stale client', async () => {
  let current = null;
  let sequence = 0;
  const fetch = async (url, init = {}) => {
    if (!url.includes('/rpc/save_dictation')) throw new Error(`unexpected ${url}`);
    const body = JSON.parse(init.body);
    if ((current?.updatedAt || null) !== body.p_expected_updated_at) {
      return response(409, { message: 'dictation_conflict: reload' });
    }
    sequence += 1;
    current = { ...body.p_record, updatedAt: `2026-09-25T11:00:0${sequence}.000Z` };
    return response(200, current);
  };
  const auth = {
    config: { supabaseUrl: 'https://test.supabase.co', supabaseAnonKey: 'public', fetch },
    storage: new MemoryStorage(),
    async getSession() { return { user: { id: 'user-a', email: '' }, access_token: 'a' }; },
  };
  const first = createStore(auth);
  const second = createStore(auth);
  const saved = await first.saveDictation(dictationRecord());
  const revised = await first.saveDictation({ ...saved, attempts: 2 }, saved.updatedAt);
  assert.equal(revised.attempts, 2);
  await assert.rejects(second.saveDictation({ ...saved, answer: 'stale' }, saved.updatedAt), /dictation_conflict/);
});

test('cloud load does not fail when its optional browser cache is unavailable', async () => {
  const auth = {
    config: {
      supabaseUrl: 'https://test.supabase.co', supabaseAnonKey: 'public',
      fetch: async (url) => url.includes('/profiles') ? response(200, [{ nickname: '서현' }]) : response(200, []),
    },
    storage: { getItem() { return null; }, setItem() { throw new Error('blocked'); }, removeItem() {} },
    async getSession() { return { user: { id: 'user-a', email: '' }, access_token: 'a' }; },
  };
  assert.deepEqual(await createStore(auth).load(), { nickname: '서현', progress: [], dictations: [], mode: 'cloud' });
});

test('cloud export and reset include dictations while preserving the quota ledger', async () => {
  const calls = [];
  const savedDictation = { record: { ...dictationRecord(), updatedAt: '2026-09-25T12:00:00Z' } };
  const fetch = async (url, init = {}) => {
    calls.push([url, init.method || 'GET']);
    if (url.includes('/learning_dictations?') && (init.method || 'GET') === 'GET') return response(200, [savedDictation]);
    return response(200, []);
  };
  const auth = {
    config: { supabaseUrl: 'https://test.supabase.co', supabaseAnonKey: 'public', fetch },
    storage: new MemoryStorage(),
    async getSession() { return { user: { id: 'user-a', email: '' }, access_token: 'a' }; },
  };
  const store = createStore(auth);
  const exported = await store.exportData();
  assert.deepEqual(exported.dictations, [savedDictation]);
  await store.resetProgress();
  assert.ok(calls.some(([url, method]) => url.includes('/learning_progress?') && method === 'DELETE'));
  assert.ok(calls.some(([url, method]) => url.includes('/learning_dictations?') && method === 'DELETE'));
  assert.equal(calls.some(([url, method]) => url.includes('/learning_starts?') && method === 'DELETE'), false);
});

test('account deletion calls only the authenticated Edge Function then clears local auth', async () => {
  const storage = new MemoryStorage();
  const calls = [];
  const auth = createAuth({
    supabaseUrl: 'https://test.supabase.co', supabaseAnonKey: 'public', storage,
    fetch: async (url, init) => {
      calls.push([url, init]);
      if (url.includes('grant_type=password')) return response(200, {
        access_token: 'token-a', refresh_token: 'refresh-a', expires_at: 4_000_000_000,
        user: { id: 'user-a', email: 'a@example.com' },
      });
      if (url.endsWith('/functions/v1/delete-account')) return response(200, { deleted: true });
      throw new Error(`unexpected ${url}`);
    },
  });
  await auth.signIn('a@example.com', 'secret');
  storage.setItem('wordtrail:cloud:user-a:v1', '{"progress":[]}');
  await auth.deleteAccount();
  assert.equal(calls[1][1].headers.Authorization, 'Bearer token-a');
  assert.equal(await auth.getSession(), null);
  assert.equal(storage.getItem('wordtrail:cloud:user-a:v1'), null);
});

test('SQL keeps quota account-wide and gates bounded progress behind approved starts', async () => {
  const schema = await readFile(new URL('../supabase/schema.sql', import.meta.url), 'utf8');
  const migration = await readFile(new URL('../supabase/migrations/202609250001_add_dictations.sql', import.meta.url), 'utf8');
  const vocabularyMigration = await readFile(new URL('../supabase/migrations/202609250002_selected_vocabulary.sql', import.meta.url), 'utf8');
  assert.match(schema, /if p_learner_id <> 'default'/);
  assert.match(schema, /where user_id = v_user and started_on = v_today/);
  assert.doesNotMatch(schema, /where user_id = v_user and learner_id = p_learner_id and started_on = v_today/);
  assert.match(schema, /revoke delete on public\.profiles from anon, authenticated/);
  assert.doesNotMatch(schema, /grant select, insert, update, delete on public\.profiles/);
  assert.doesNotMatch(schema, /create policy profiles_own_all/);
  assert.match(schema, /check \(learner_id = 'default'\)/);
  assert.match(schema, /learning_progress_approved_start_fk/);
  assert.match(schema, /references public\.learning_starts\(user_id, learner_id, video_id, scene_id\)/);
  assert.match(schema, /octet_length\(record::text\) <= 8192/);
  assert.match(schema, /if v_count >= 5/);
  assert.match(schema, /progress identity cannot be changed/);
  assert.match(schema, /custom-\[A-Za-z0-9_\-\]\{11\}/);
  assert.match(schema, /on conflict \(user_id, learner_id\) do nothing/);
  assert.match(schema, /create or replace function public\.save_progress/);
  assert.match(schema, /p_expected_updated_at is null or v_current is distinct from p_expected_updated_at/);
  assert.match(schema, /revoke insert, update on public\.learning_progress from anon, authenticated/);
  assert.match(schema, /grant execute on function public\.save_progress\(jsonb,timestamptz\) to authenticated/);
  assert.match(schema, /create table if not exists public\.learning_dictations/);
  assert.match(schema, /learning_dictations_approved_start_fk/);
  assert.match(schema, /octet_length\(record::text\) <= 65536/);
  assert.match(schema, /create or replace function public\.save_dictation/);
  assert.match(schema, /revoke insert, update on public\.learning_dictations from anon, authenticated/);
  assert.match(schema, /\^\(s\[0-9\]\{3\}\|c\[0-9\]\{4\}\)\$/);
  assert.match(schema, /a scene can store at most five dictation versions/);
  assert.match(migration, /from pg_constraint/);
  assert.match(migration, /cardinality\(c\.conkey\) = 1/);
  assert.match(migration, /a\.attnum = c\.conkey\[1\] and a\.attname = 'scene_id'/);
  assert.doesNotMatch(migration, /pg_get_constraintdef\(oid\) ilike '%scene_id%'/);
  assert.match(migration, /learning_progress_scene_id_format_check/);
  assert.match(migration, /learning_starts_scene_id_format_check/);
  assert.doesNotMatch(migration, /drop constraint[^;]*record/i);
  assert.match(migration, /create table public\.learning_dictations/);
  for (const sql of [schema, vocabularyMigration]) {
    assert.match(sql, /selectedKeys/);
    assert.match(sql, /sourceIndexes/);
    assert.match(sql, /'replace', 'missing', 'extra', 'manual'/);
    assert.match(sql, /'spelling', 'cloze', 'meaning', 'audio', 'reading'/);
    assert.match(sql, /2147483647/);
    assert.match(sql, /invalid vocabulary review schedule/);
    assert.match(sql, /normalize\(v_word->>'term', NFKC\)/);
    assert.match(sql, /selected vocabulary key must reference a stored word/);
  }
  assert.match(vocabularyMigration, /create or replace function public\.guard_dictation_write\(\)/);
  assert.match(schema, /sourceTerm/);
  assert.match(vocabularyMigration, /sourceTerm/);
  assert.match(vocabularyMigration, /revoke execute on function public\.guard_dictation_write\(\) from public, anon, authenticated/);
  assert.doesNotMatch(vocabularyMigration, /drop constraint|alter table|grant insert|grant update/i);
});
