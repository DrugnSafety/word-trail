import test from 'node:test';
import assert from 'node:assert/strict';
import { createSentencePlayback, findSentenceClip } from '../public/lib/sentence-audio.js';

const record = Object.freeze({
  videoId: 'video-01', sceneId: 'c0001', contentVersion: '2026.09.29-1', reference: 'Mum, can we play?'
});

function video(overrides = {}) {
  return {
    id: 'video-01',
    contentVersion: '2026.09.29-1',
    sourceUrl: 'https://www.youtube.com/watch?v=kx8_wF9HOX8',
    scenes: [{ id: 'c0001', selectable: true, start: 26, end: 41, sentenceText: 'Mum, can we play?' }],
    ...overrides
  };
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function fakeFactory({ pendingLoad = null, loadEvent = null, playEvent = null } = {}) {
  const players = [];
  const factory = (element, onStatus) => {
    const player = {
      calls: [], cancelled: false, destroyed: false,
      emit(event) { onStatus(event); },
      setLoop(value) { this.calls.push(['loop', value]); },
      setRate(value) { this.calls.push(['rate', value]); },
      async load(...args) {
        this.calls.push(['load', ...args]);
        if (pendingLoad) await pendingLoad.promise;
        if (loadEvent) onStatus(loadEvent);
        else if (args[3]?.play && !this.cancelled) onStatus({ type: 'playing', message: '재생 중' });
        return args[3]?.play && !this.cancelled;
      },
      play(options) { this.calls.push(['play', options]); onStatus(playEvent || { type: 'playing', message: '재생 중' }); return true; },
      pause() { this.calls.push(['pause']); this.cancelled = true; onStatus({ type: 'paused', message: '정지' }); },
      destroy() { this.calls.push(['destroy']); this.destroyed = true; this.cancelled = true; }
    };
    players.push(player);
    return player;
  };
  return { factory, players };
}

test('findSentenceClip returns only the exact current selectable sentence and safe YouTube range', () => {
  assert.deepEqual(findSentenceClip(record, video()), { videoId: 'kx8_wF9HOX8', start: 26, end: 41 });
  assert.equal(findSentenceClip({ ...record, videoId: 'video-02' }, video()), null);
  assert.equal(findSentenceClip({ ...record, contentVersion: 'old' }, video()), null);
  assert.equal(findSentenceClip({ ...record, reference: 'Reused scene id with old text' }, video()), null);
  assert.equal(findSentenceClip({ videoId: 'video-01', sceneId: 'c0001' }, video({ contentVersion: undefined, scenes: [{ id: 'c0001', selectable: true, start: 1, end: 2 }] })), null);
  assert.equal(findSentenceClip({ ...record, reference: ' ' }, video({ scenes: [{ ...video().scenes[0], sentenceText: ' ' }] })), null);
  assert.equal(findSentenceClip(record, video({ scenes: [{ ...video().scenes[0], selectable: false }] })), null);
  assert.equal(findSentenceClip(record, video({ sourceUrl: 'https://youtube.com.evil.test/watch?v=kx8_wF9HOX8' })), null);
  assert.equal(findSentenceClip(record, video({ sourceUrl: 'https://www.youtube.com/embed/kx8_wF9HOX8' })), null);
  assert.equal(findSentenceClip(record, video({ sourceUrl: 'https://www.youtube.com/watch?v=kx8_wF9HOX8&v=abcdefghijk' })), null);
  assert.equal(findSentenceClip(record, video({ sourceUrl: 'https://user@www.youtube.com/watch?v=kx8_wF9HOX8' })), null);
  assert.equal(findSentenceClip(record, video({ scenes: [{ ...video().scenes[0], end: 26 }] })), null);
});

test('prepare loops the whole sentence video range and forwards playback status', async () => {
  const fake = fakeFactory();
  const statuses = [];
  const playback = createSentencePlayback({
    element: {}, loadVideo: async id => { assert.equal(id, 'video-01'); return video(); },
    onStatus: event => statuses.push(event), rate: 0.75, playerFactory: fake.factory
  });
  assert.equal(await playback.prepare(record), true);
  assert.deepEqual(fake.players[0].calls.slice(0, 3), [
    ['loop', true], ['rate', 0.75],
    ['load', 'kx8_wF9HOX8', 26, 41, { play: true }]
  ]);
  assert.equal(playback.isActive(), true);
  assert.ok(statuses.some(status => status.type === 'playing'));
});

test('pause before video metadata arrives cancels autoplay but still prepares a manual replay', async () => {
  const videoRequest = deferred();
  const fake = fakeFactory();
  const playback = createSentencePlayback({ element: {}, loadVideo: () => videoRequest.promise, playerFactory: fake.factory });
  const preparing = playback.prepare(record);
  assert.equal(playback.isActive(), true, 'pending autoplay can be stopped by the UI');
  playback.pause();
  assert.equal(playback.isActive(), false);
  videoRequest.resolve(video());
  assert.equal(await preparing, true);
  assert.deepEqual(fake.players[0].calls.find(([name]) => name === 'load'), ['load', 'kx8_wF9HOX8', 26, 41, { play: false }]);
  assert.equal(playback.isActive(), false);
  assert.equal(playback.play(), true);
  assert.deepEqual(fake.players[0].calls.find(([name]) => name === 'play'), ['play', { restart: true }]);
});

test('pause while player initialization is pending cannot resurrect autoplay', async () => {
  const playerReady = deferred();
  const fake = fakeFactory({ pendingLoad: playerReady });
  const playback = createSentencePlayback({ element: {}, loadVideo: async () => video(), playerFactory: fake.factory });
  const preparing = playback.prepare(record);
  await Promise.resolve(); await Promise.resolve();
  playback.pause();
  playerReady.resolve();
  assert.equal(await preparing, true);
  assert.equal(playback.isActive(), false);
  assert.ok(fake.players[0].calls.some(([name]) => name === 'pause'));
});

test('destroy before metadata resolves discards the stale request without creating a player', async () => {
  const videoRequest = deferred();
  const fake = fakeFactory();
  const playback = createSentencePlayback({ element: {}, loadVideo: () => videoRequest.promise, playerFactory: fake.factory });
  const preparing = playback.prepare(record);
  playback.destroy();
  videoRequest.resolve(video());
  assert.equal(await preparing, false);
  assert.equal(fake.players.length, 0);
  assert.equal(playback.isActive(), false);
  assert.equal(playback.play(), false);
});

test('missing or mismatched source data is explained and never replaced with synthesized speech', async () => {
  const fake = fakeFactory();
  const statuses = [];
  const playback = createSentencePlayback({
    element: {}, loadVideo: async () => video({ contentVersion: 'new-version' }),
    onStatus: event => statuses.push(event), playerFactory: fake.factory
  });
  assert.equal(await playback.prepare(record), false);
  assert.equal(fake.players.length, 0);
  assert.equal(statuses.at(-1).type, 'info');
  assert.match(statuses.at(-1).message, /정확히 일치하는 문장 영상 구간이 없어요/);
});

test('destroy stops a prepared looping player and ignores its later events', async () => {
  const fake = fakeFactory();
  const statuses = [];
  const playback = createSentencePlayback({
    element: {}, loadVideo: async () => video(), onStatus: event => statuses.push(event), playerFactory: fake.factory
  });
  await playback.prepare(record, { autoplay: false });
  playback.play();
  const count = statuses.length;
  playback.destroy();
  assert.equal(fake.players[0].destroyed, true);
  assert.equal(playback.isActive(), false);
  fake.players[0].emit({ type: 'playing', message: '늦은 이벤트' });
  assert.equal(statuses.length, count);
});

test('a synchronous autoplay-blocked event wins over a true prepare result', async () => {
  const blocked = { type: 'autoplay-blocked', message: '재생이 차단됐어요.' };
  const fake = fakeFactory({ loadEvent: blocked });
  const statuses = [];
  const playback = createSentencePlayback({
    element: {}, loadVideo: async () => video(), onStatus: event => statuses.push(event), playerFactory: fake.factory
  });
  assert.equal(await playback.prepare(record), true, 'the sentence is still prepared for a manual retry');
  assert.equal(playback.isActive(), false);
  assert.deepEqual(statuses.at(-1), blocked);
});

test('a synchronous autoplay-blocked event also wins over a true manual play result', async () => {
  const blocked = { type: 'autoplay-blocked', message: '직접 재생도 차단됐어요.' };
  const fake = fakeFactory({ playEvent: blocked });
  const statuses = [];
  const playback = createSentencePlayback({
    element: {}, loadVideo: async () => video(), onStatus: event => statuses.push(event), playerFactory: fake.factory
  });
  await playback.prepare(record, { autoplay: false });
  assert.equal(playback.play(), false);
  assert.equal(playback.isActive(), false);
  assert.deepEqual(statuses.at(-1), blocked);
});

test('a synchronous player error makes prepare fail even if the player resolves true', async () => {
  const failure = { type: 'error', message: '영상 오류' };
  const fake = fakeFactory({ loadEvent: failure });
  const playback = createSentencePlayback({ element: {}, loadVideo: async () => video(), playerFactory: fake.factory });
  assert.equal(await playback.prepare(record), false);
  assert.equal(playback.isActive(), false);
  assert.equal(fake.players[0].destroyed, true);
});
