import test from 'node:test';
import assert from 'node:assert/strict';
import { createPlayer } from '../public/lib/player.js';

function harness({ autoReady = true, rates = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2] } = {}) {
  const intervals = new Map();
  const timeouts = new Map();
  const statuses = [];
  let counter = 0;
  let fake;
  const iframe = {
    attributes: new Map([['allow', 'fullscreen']]),
    getAttribute(name) { return this.attributes.get(name) || ''; },
    setAttribute(name, value) { this.attributes.set(name, value); }
  };
  const clock = {
    setInterval(fn) { const id = ++counter; intervals.set(id, fn); return id; },
    clearInterval(id) { intervals.delete(id); },
    setTimeout(fn) { const id = ++counter; timeouts.set(id, fn); return id; },
    clearTimeout(id) { timeouts.delete(id); }
  };
  class FakePlayer {
    constructor(element, settings) {
      fake = this;
      this.events = settings.events;
      this.time = 0;
      this.calls = [];
      this.destroyed = false;
      if (autoReady) queueMicrotask(() => this.ready());
    }
    ready() { this.events.onReady(); }
    cueVideoById(value) { this.calls.push(['cue', value]); this.cued = value; this.time = value.startSeconds; }
    loadVideoById(value) { this.calls.push(['load', value]); this.loaded = value; this.time = value.startSeconds; }
    playVideo() { this.calls.push(['play']); this.events.onStateChange({ data: 1 }); }
    pauseVideo() { this.calls.push(['pause']); this.events.onStateChange({ data: 2 }); }
    getCurrentTime() { return this.time; }
    seekTo(value) { this.calls.push(['seek', value]); this.time = value; }
    getAvailablePlaybackRates() { return typeof rates === 'function' ? rates(this) : rates; }
    setPlaybackRate(value) { this.calls.push(['rate', value]); this.rate = value; }
    getIframe() { return iframe; }
    destroy() { this.destroyed = true; }
  }
  const instance = createPlayer({ replaceChildren() {} }, status => statuses.push(status), { clock, loadAPI: async () => ({ Player: FakePlayer }) });
  return { instance, statuses, intervals, timeouts, iframe, get fake() { return fake; } };
}

test('default load only cues; explicit play loads and starts the selected range without cue/play race', async () => {
  const originalDocument = globalThis.document;
  globalThis.document = { createElement: () => ({}) };
  try {
    const setup = harness();
    assert.equal(await setup.instance.load('kx8_wF9HOX8', 26, 29), false);
    assert.deepEqual(setup.fake.calls.filter(([name]) => ['cue', 'load', 'play'].includes(name)), [
      ['cue', { videoId: 'kx8_wF9HOX8', startSeconds: 26, endSeconds: 29 }]
    ]);
    assert.equal(setup.instance.play(), true);
    assert.deepEqual(setup.fake.calls.find(([name]) => name === 'load'), ['load', { videoId: 'kx8_wF9HOX8', startSeconds: 26, endSeconds: 29 }]);
    assert.equal(setup.fake.calls.some(([name]) => name === 'play'), false, 'a cued range uses loadVideoById instead of racing playVideo');

    assert.equal(await setup.instance.load('kx8_wF9HOX8', 30, 34, { play: true }), true);
    assert.deepEqual(setup.fake.calls.filter(([name]) => name === 'load').at(-1), ['load', { videoId: 'kx8_wF9HOX8', startSeconds: 30, endSeconds: 34 }]);
    assert.equal(setup.iframe.attributes.get('allow'), 'fullscreen; autoplay; encrypted-media; picture-in-picture');
  } finally { globalThis.document = originalDocument; }
});

test('pause while initialization is pending cancels explicit play intent and leaves the range cued', async () => {
  const originalDocument = globalThis.document;
  globalThis.document = { createElement: () => ({}) };
  try {
    const setup = harness({ autoReady: false });
    const loading = setup.instance.load('kx8_wF9HOX8', 26, 29, { play: true });
    await Promise.resolve(); await Promise.resolve();
    setup.instance.pause();
    setup.fake.ready();
    assert.equal(await loading, false);
    assert.equal(setup.fake.calls.some(([name]) => name === 'load'), false);
    assert.deepEqual(setup.fake.calls.find(([name]) => name === 'cue'), ['cue', { videoId: 'kx8_wF9HOX8', startSeconds: 26, endSeconds: 29 }]);
  } finally { globalThis.document = originalDocument; }
});

test('only the newest concurrent load may prepare video', async () => {
  const originalDocument = globalThis.document;
  globalThis.document = { createElement: () => ({}) };
  try {
    const setup = harness({ autoReady: false });
    const stale = setup.instance.load('kx8_wF9HOX8', 10, 14, { play: true });
    const current = setup.instance.load('kx8_wF9HOX8', 20, 25);
    await Promise.resolve(); await Promise.resolve();
    setup.fake.ready();
    assert.equal(await stale, false);
    assert.equal(await current, false);
    assert.deepEqual(setup.fake.calls.filter(([name]) => ['cue', 'load'].includes(name)), [
      ['cue', { videoId: 'kx8_wF9HOX8', startSeconds: 20, endSeconds: 25 }]
    ]);
  } finally { globalThis.document = originalDocument; }
});

test('range monitoring loops at the end and pause cancels replay timers', async () => {
  const originalDocument = globalThis.document;
  globalThis.document = { createElement: () => ({}) };
  try {
    const setup = harness();
    await setup.instance.load('kx8_wF9HOX8', 26, 29, { play: true });
    setup.fake.events.onStateChange({ data: 1 });
    assert.equal(setup.intervals.size, 1);
    setup.fake.time = 28.9;
    [...setup.intervals.values()][0]();
    assert.equal(setup.timeouts.size, 0);
    setup.fake.time = 29;
    [...setup.intervals.values()][0]();
    assert.equal(setup.timeouts.size, 1);
    const replay = [...setup.timeouts.values()][0];
    setup.timeouts.clear(); replay();
    assert.ok(setup.fake.calls.some(([name, value]) => name === 'seek' && value === 26));
    setup.instance.pause();
    assert.equal(setup.intervals.size, 0);
    assert.equal(setup.timeouts.size, 0);
  } finally { globalThis.document = originalDocument; }
});

test('restart play reloads the range start while ordinary play resumes in-range playback', async () => {
  const originalDocument = globalThis.document;
  globalThis.document = { createElement: () => ({}) };
  try {
    const setup = harness();
    await setup.instance.load('kx8_wF9HOX8', 26, 29, { play: true });
    setup.fake.events.onStateChange({ data: 1 });
    setup.fake.time = 27;
    setup.fake.calls.length = 0;
    assert.equal(setup.instance.play(), true);
    assert.deepEqual(setup.fake.calls.find(([name]) => name === 'play'), ['play']);
    setup.fake.calls.length = 0;
    assert.equal(setup.instance.play({ restart: true }), true);
    assert.deepEqual(setup.fake.calls.find(([name]) => name === 'load'), ['load', { videoId: 'kx8_wF9HOX8', startSeconds: 26, endSeconds: 29 }]);
  } finally { globalThis.document = originalDocument; }
});

test('a requested rate survives the pre-cue 1x placeholder and publishes resolved rate options', async () => {
  const originalDocument = globalThis.document;
  globalThis.document = { createElement: () => ({}) };
  try {
    let mediaReady = false;
    const setup = harness({ rates: () => mediaReady ? [0.5, 0.75, 1, 1.25, 1.5] : [1] });
    assert.equal(setup.instance.setRate(0.75), true);
    await setup.instance.load('kx8_wF9HOX8', 26, 29);
    assert.equal(setup.instance.getRate(), 0.75, 'the pre-cue placeholder must not replace the learner selection');
    assert.equal(setup.fake.calls.some(([name]) => name === 'rate'), false);
    mediaReady = true;
    setup.fake.events.onStateChange({ data: 5 });
    assert.equal(setup.fake.rate, 0.75);
    assert.deepEqual(setup.statuses.at(-1), {
      type: 'rate', message: '', rate: 0.75, actualRate: null, availableRates: [0.5, 0.75, 1, 1.25, 1.5]
    });
    setup.fake.events.onPlaybackRateChange({ data: 1 });
    assert.equal(setup.instance.getRate(), 0.75, 'a stale actual-rate event must not overwrite the pending request');
    setup.fake.events.onPlaybackRateChange({ data: 0.75 });
    assert.equal(setup.statuses.at(-1).actualRate, 0.75);
  } finally { globalThis.document = originalDocument; }
});

test('rates support quarter increments through 2x and report actual YouTube rate changes', async () => {
  const originalDocument = globalThis.document;
  globalThis.document = { createElement: () => ({}) };
  try {
    const setup = harness({ rates: [0.5, 1, 1.25, 1.5, 1.75, 2] });
    await setup.instance.load('kx8_wF9HOX8', 26, 29);
    setup.fake.events.onStateChange({ data: 5 });
    assert.deepEqual(setup.instance.getAvailableRates(), [0.5, 1, 1.25, 1.5, 1.75, 2]);
    assert.equal(setup.instance.setRate(1.75), true);
    assert.equal(setup.fake.rate, 1.75);
    assert.equal(setup.instance.setRate(0.25), false);
    assert.equal(setup.instance.getRate(), 1);
    assert.equal(setup.instance.setRate(2.25), false);
    setup.fake.events.onPlaybackRateChange({ data: 1 });
    setup.fake.events.onPlaybackRateChange({ data: 1.5 });
    assert.equal(setup.instance.getRate(), 1.5);
    assert.deepEqual(setup.statuses.at(-1), { type: 'rate', message: '', rate: 1.5, actualRate: 1.5, availableRates: [0.5, 1, 1.25, 1.5, 1.75, 2] });
    assert.ok(setup.statuses.some(status => status.message.includes('지원하지')));
  } finally { globalThis.document = originalDocument; }
});

test('autoplay blocking has an explicit status type and cleanup destroys the player', async () => {
  const originalDocument = globalThis.document;
  globalThis.document = { createElement: () => ({}) };
  try {
    const setup = harness();
    await setup.instance.load('kx8_wF9HOX8', 26, 29, { play: true });
    setup.fake.events.onAutoplayBlocked();
    assert.equal(setup.statuses.at(-1).type, 'autoplay-blocked');
    assert.match(setup.statuses.at(-1).message, /브라우저가 자동 재생을 막았어요/);
    setup.instance.destroy();
    assert.equal(setup.fake.destroyed, true);
  } finally { globalThis.document = originalDocument; }
});

test('invalid IDs and timestamps never invoke YouTube', async () => {
  let calls = 0;
  const player = createPlayer({}, () => {}, { loadAPI: () => { calls++; } });
  await assert.rejects(player.load('bad', 0, 4));
  await assert.rejects(player.load('kx8_wF9HOX8', 4, 4));
  assert.equal(calls, 0);
});
