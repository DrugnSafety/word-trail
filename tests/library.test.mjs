import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createAuth } from '../public/lib/auth.js';
import { createStore } from '../public/lib/store.js';
import {
  channelIdFromUuid, emptyLibrary, libraryFacets, normalizeLibrary, removeLibraryChannel,
  sortLibraryVideos, upsertLibraryChannel, upsertLibraryVideo, youtubeVideoId,
} from '../public/lib/library.js';

class MemoryStorage {
  values = new Map();
  getItem(key) { return this.values.get(key) ?? null; }
  setItem(key, value) { this.values.set(key, String(value)); }
  removeItem(key) { this.values.delete(key); }
}

function response(status, body) {
  return {
    ok: status >= 200 && status < 300, status,
    async text() { return body == null ? '' : JSON.stringify(body); },
  };
}

const firstTime = '2026-10-06T10:00:00.000Z';
const secondTime = '2026-10-06T11:00:00.000Z';
const channelId = 'channel:123e4567-e89b-42d3-a456-426614174000';

function channel(overrides = {}) {
  return {
    id: channelId, title: 'Bluey', url: 'https://www.youtube.com/@BlueyOfficialChannel',
    topics: ['가족'], tags: ['animation'], createdAt: firstTime, updatedAt: firstTime, ...overrides,
  };
}

function video(overrides = {}) {
  return {
    id: 'video:qAEqxJjN9Cw', youtubeId: 'qAEqxJjN9Cw', title: 'Faceytalk', durationSeconds: 180,
    channelId,
    topics: ['가족', '대화'], tags: ['Bluey'], transcript: 'Can you hear me?',
    chapters: [
      { id: 'chapter:intro', title: 'Intro', startSeconds: 0, endSeconds: 20, transcript: 'Hello.' },
      { id: 'chapter:talk', title: 'Talk', startSeconds: 20, transcript: 'Can you hear me?' },
    ],
    createdAt: firstTime, updatedAt: secondTime, ...overrides,
  };
}

test('custom channels and videos normalize YouTube links and preserve manual chapters', () => {
  assert.equal(channelIdFromUuid('123e4567-e89b-42d3-a456-426614174000'), channelId);
  let library = upsertLibraryChannel(emptyLibrary(), channel());
  library = upsertLibraryVideo(library, video({ url: 'https://youtu.be/qAEqxJjN9Cw?t=20', youtubeId: undefined }));
  assert.equal(library.videos[0].youtubeId, 'qAEqxJjN9Cw');
  assert.equal(library.videos[0].url, 'https://www.youtube.com/watch?v=qAEqxJjN9Cw');
  assert.deepEqual(library.videos[0].chapters.map(({ startSeconds }) => startSeconds), [0, 20]);
  assert.equal(youtubeVideoId('https://www.youtube.com/shorts/qAEqxJjN9Cw'), 'qAEqxJjN9Cw');
});

test('library rejects unsafe or inconsistent input before persistence', () => {
  assert.throws(() => normalizeLibrary({ version: 1, channels: [], videos: [video()] }), /채널이 현재 라이브러리/);
  assert.throws(() => upsertLibraryVideo(
    upsertLibraryChannel(emptyLibrary(), channel()),
    video({ chapters: [video().chapters[1], video().chapters[0]] }),
  ), /시작 시간/);
  assert.throws(() => upsertLibraryVideo(
    upsertLibraryChannel(emptyLibrary(), channel()),
    video({ durationSeconds: 10 }),
  ), /영상 길이 안/);
  assert.throws(() => youtubeVideoId('https://example.com/watch?v=qAEqxJjN9Cw'), /YouTube/);
  assert.throws(() => upsertLibraryChannel(emptyLibrary(), channel({ url: 'https://evil.example/@Bluey' })), /YouTube/);
});

test('topic and tag filtering is pure, sortable, and exposes stable facets', () => {
  const base = upsertLibraryChannel(emptyLibrary(), channel());
  const library = upsertLibraryVideo(
    upsertLibraryVideo(base, video()),
    video({ id: 'video:abcdefghijk', youtubeId: 'abcdefghijk', title: 'A Song', topics: ['음악'], tags: ['Bluey', 'song'] }),
  );
  assert.deepEqual(sortLibraryVideos(library.videos, { tag: 'bluey' }).map(({ title }) => title), ['A Song', 'Faceytalk']);
  assert.deepEqual(sortLibraryVideos(library.videos, { topic: '가족', sortBy: 'updatedAt', direction: 'desc' }).map(({ title }) => title), ['Faceytalk']);
  assert.deepEqual(libraryFacets(library), { topics: ['가족', '대화', '음악'], tags: ['Bluey', 'song'] });
  assert.equal(removeLibraryChannel(library, channelId).videos.every((item) => item.channelId === null), true);
  assert.equal(library.videos.every((item) => item.channelId === channelId), true, 'helpers do not mutate input');
});

test('guest library uses CAS and remains separate from account caches', async () => {
  const storage = new MemoryStorage();
  const store = createStore(createAuth({ storage }));
  const initial = await store.loadLibrary();
  assert.deepEqual(initial, { library: emptyLibrary(), updatedAt: null, mode: 'guest' });
  const library = upsertLibraryChannel(initial.library, channel());
  const saved = await store.saveLibrary(library, initial.updatedAt, 'guest');
  assert.equal((await store.loadLibrary()).library.channels[0].title, 'Bluey');
  await assert.rejects(store.saveLibrary(library, null, 'guest'), /다른 화면/);
  assert.ok(saved.updatedAt);
  assert.equal(storage.getItem('wordtrail:cloud:user-a:v1'), null);
  assert.equal((await store.startLearning('custom-qAEqxJjN9Cw', 'c0001', 'guest')).allowed, true);
});

test('cloud library uses the current account token, CAS RPC, and account switch guard', async () => {
  const storage = new MemoryStorage();
  let session = { user: { id: 'user-a', email: '' }, access_token: 'token-a' };
  let current = null;
  const calls = [];
  const fetch = async (url, init = {}) => {
    calls.push([url, init]);
    if (url.includes('/user_libraries?')) return response(200, current ? [current] : []);
    if (url.includes('/rpc/save_user_library')) {
      const body = JSON.parse(init.body);
      if ((current?.updated_at || null) !== body.p_expected_updated_at) return response(409, { message: 'library_conflict: reload' });
      current = { record: body.p_record, updated_at: secondTime };
      return response(200, current);
    }
    throw new Error(`unexpected ${url}`);
  };
  const auth = {
    config: { supabaseUrl: 'https://test.supabase.co', supabaseAnonKey: 'public', fetch }, storage,
    async getSession() { return session; },
  };
  const store = createStore(auth);
  const library = upsertLibraryChannel(emptyLibrary(), channel());
  const saved = await store.saveLibrary(library, null, 'user-a');
  assert.equal(saved.updatedAt, secondTime);
  assert.equal(calls[0][1].headers.Authorization, 'Bearer token-a');
  assert.equal((await store.loadLibrary('user-a')).library.channels.length, 1);
  session = { user: { id: 'user-b', email: '' }, access_token: 'token-b' };
  await assert.rejects(store.saveLibrary(library, secondTime, 'user-a'), /계정이 변경/);
});

test('library SQL is owner-only and writes through its CAS function', async () => {
  const schema = await readFile(new URL('../supabase/schema.sql', import.meta.url), 'utf8');
  const migration = await readFile(new URL('../supabase/migrations/202610060001_user_libraries.sql', import.meta.url), 'utf8');
  for (const sql of [schema, migration]) {
    assert.match(sql, /create table if not exists public\.user_libraries/);
    assert.match(sql, /create policy user_libraries_own_select/);
    assert.match(sql, /using \(user_id = auth\.uid\(\)\)/);
    assert.match(sql, /create or replace function public\.save_user_library/);
    assert.match(sql, /library_conflict: reload before saving again/);
    assert.match(sql, /revoke insert, update, delete on public\.user_libraries from anon, authenticated/);
    assert.doesNotMatch(sql, /is_admin|admin_role|user_metadata/);
  }
  assert.match(migration, /learning_progress_video_id_format_check/);
  assert.match(migration, /custom-\[A-Za-z0-9_\-\]\{11\}/);
});
