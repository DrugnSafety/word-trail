import test from 'node:test';
import assert from 'node:assert/strict';
import { createStudySpeechSequence } from '../public/lib/study-speech.js';

function speechHarness() {
  const utterances = [], audios = [], highlights = [], statuses = [];
  let cancellations = 0;
  class Utterance { constructor(text) { this.text = text; } }
  class Audio {
    constructor(src) { this.src = src; this.paused = true; audios.push(this); }
    play() { this.paused = false; this.onplaying?.(); return Promise.resolve(); }
    pause() { this.paused = true; }
  }
  const engine = {
    getVoices: () => [],
    speak: utterance => utterances.push(utterance),
    resume() {},
    cancel() { cancellations += 1; }
  };
  const sequence = createStudySpeechSequence({
    engine, Utterance, Audio,
    onHighlight: item => highlights.push(item),
    onStatus: item => statuses.push(item)
  });
  return { sequence, utterances, audios, highlights, statuses, cancellations: () => cancellations };
}

test('study speech reads word, every alphabet letter, then the whole word', async () => {
  const h = speechHarness();
  assert.equal(h.sequence.start('ab', { guide: ['a', 'b'] }), true);
  assert.equal(h.utterances[0].text, 'ab');
  h.utterances[0].onstart();
  h.utterances[0].onend();
  await Promise.resolve();
  assert.match(h.audios[0].src, /audio\/letter-a\.mp3$/);
  assert.deepEqual(h.highlights.slice(0, 2), [
    { type: 'word', index: 0, text: 'ab' },
    { type: 'letter', index: 0, text: 'a' }
  ]);
  h.audios[0].onended();
  await Promise.resolve();
  assert.equal(h.utterances[1].text, 'bee');
  h.utterances[1].onstart();
  h.utterances[1].onend();
  await Promise.resolve();
  assert.equal(h.utterances[2].text, 'ab');
  h.utterances[2].onstart();
  h.utterances[2].onboundary({ charIndex: 1 });
  h.utterances[2].onend();
  await Promise.resolve();
  assert.deepEqual(h.highlights, [
    { type: 'word', index: 0, text: 'ab' },
    { type: 'letter', index: 0, text: 'a' },
    { type: 'letter', index: 1, text: 'b' },
    { type: 'word', index: 0, text: 'ab' },
    { type: 'segment', index: 1, text: 'b' }
  ]);
  assert.equal(h.sequence.isActive(), false);
  assert.equal(h.statuses.at(-1).type, 'ready');
});

test('stop cancels recorded audio and stale callbacks cannot resume the sequence', async () => {
  const h = speechHarness();
  h.sequence.start('a');
  h.utterances[0].onend();
  await Promise.resolve();
  const staleEnd = h.audios[0].onended;
  h.sequence.stop();
  assert.equal(h.audios[0].paused, true);
  assert.equal(h.cancellations(), 1);
  staleEnd?.();
  await Promise.resolve();
  assert.equal(h.utterances.length, 1);
  assert.equal(h.sequence.isActive(), false);
});

test('unsupported speech and empty values fail explicitly', () => {
  const statuses = [];
  const unavailable = createStudySpeechSequence({ engine: null, Utterance: null, onStatus: item => statuses.push(item) });
  assert.equal(unavailable.start('rain'), false);
  assert.equal(statuses.at(-1).type, 'error');

  const h = speechHarness();
  assert.equal(h.sequence.start('123'), false);
  assert.equal(h.statuses.at(-1).type, 'error');
});
