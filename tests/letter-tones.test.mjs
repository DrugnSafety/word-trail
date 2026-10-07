import test from 'node:test';
import assert from 'node:assert/strict';
import { createLetterTonePlayer, letterToneFrequency, letterTonesEnabled, setLetterTonesEnabled } from '../public/lib/letter-tones.js';

function audioMock(state = 'running') {
  const nodes = [], envelopes = [], contexts = [];
  let finishResume;
  class Context {
    constructor() { this.state = state; this.currentTime = 5; this.destination = {}; contexts.push(this); }
    resume() { this.resumes = (this.resumes || 0) + 1; return new Promise(resolve => { finishResume = () => { this.state = 'running'; resolve(); }; }); }
    createOscillator() {
      const node = { frequency: { setValueAtTime(value) { node.hz = value; } },
        connect() {}, disconnect() { node.disconnected = true; },
        start(at) { node.startAt = at; }, stop(at) { node.stopAt = at; node.stops = (node.stops || 0) + 1; } };
      nodes.push(node); return node;
    }
    createGain() {
      const calls = []; envelopes.push(calls);
      return { gain: { setValueAtTime(...args) { calls.push(args); }, linearRampToValueAtTime(...args) { calls.push(args); } }, connect() {}, disconnect() {} };
    }
  }
  return { Context, nodes, envelopes, contexts, finishResume: () => finishResume() };
}

test('every alphabet letter has a stable distinct tone; case shares a sound', () => {
  const letters = [...'abcdefghijklmnopqrstuvwxyz'];
  const frequencies = letters.map(letterToneFrequency);
  assert.equal(new Set(frequencies).size, 26);
  assert.ok(frequencies.every(hz => hz >= 250 && hz <= 1200));
  for (const letter of letters) assert.equal(letterToneFrequency(letter), letterToneFrequency(letter.toUpperCase()));
  assert.equal(letterToneFrequency('!'), null);
  assert.equal(letterToneFrequency('ab'), null);
});

test('tone preferences default on, persist opt-out, and contain unavailable storage', () => {
  const values = new Map(); const storage = { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value) };
  assert.equal(letterTonesEnabled(storage), true);
  assert.equal(setLetterTonesEnabled(false, storage), true);
  assert.equal(letterTonesEnabled(storage), false);
  assert.equal(setLetterTonesEnabled(true, storage), true);
  assert.equal(letterTonesEnabled(storage), true);
  const denied = { getItem() { throw Error(); }, setItem() { throw Error(); } };
  assert.equal(letterTonesEnabled(denied), true);
  assert.equal(setLetterTonesEnabled(false, denied), false);
});

test('short tones fade in and out and release nodes after playback', () => {
  const mock = audioMock(); const tones = createLetterTonePlayer({ AudioContext: mock.Context, enabled: () => true });
  tones.play('a'); tones.play('z');
  assert.equal(mock.nodes.length, 2);
  assert.notEqual(mock.nodes[0].hz, mock.nodes[1].hz);
  assert.ok(mock.nodes.every(node => node.stopAt - node.startAt < 0.1));
  assert.deepEqual(mock.envelopes[0].map(item => item[0]), [0, 0.06, 0]);
  mock.nodes[0].onended();
  assert.equal(mock.nodes[0].disconnected, true);
  tones.stop();
  assert.equal(mock.nodes[0].stops, 1);
  assert.equal(mock.nodes[1].stops, 2);
  assert.equal(mock.nodes[1].disconnected, true);
});

test('cancel while resuming prevents stale tones; next input can play', async () => {
  const mock = audioMock('suspended'); const tones = createLetterTonePlayer({ AudioContext: mock.Context, enabled: () => true });
  tones.unlock(); tones.play('a');
  assert.equal(mock.contexts[0].resumes, 1);
  tones.stop(); mock.finishResume();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(mock.nodes.length, 0);
  tones.play('b');
  assert.equal(mock.nodes.length, 1);
});

test('opt-out and failed Web Audio do not create tones or throw', () => {
  const mock = audioMock(); const tones = createLetterTonePlayer({ AudioContext: mock.Context, enabled: () => false });
  tones.unlock(); tones.play('a'); tones.stop();
  assert.equal(mock.contexts.length, 0);
  const broken = createLetterTonePlayer({ AudioContext: class { constructor() { throw Error(); } }, enabled: () => true });
  assert.doesNotThrow(() => { broken.unlock(); broken.play('a'); broken.stop(); });
});
