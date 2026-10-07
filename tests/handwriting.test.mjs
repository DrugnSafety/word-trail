import test from 'node:test';
import assert from 'node:assert/strict';
import {
  HANDWRITING_MODES,
  normalizeHandwritingMode,
  parseHandwritingResult,
  appendedConfirmedLetters,
  createHandwritingRecognizer
} from '../public/lib/handwriting.js';

test('handwriting modes default safely and keep dictation distinct', () => {
  assert.equal(normalizeHandwritingMode(HANDWRITING_MODES.dictation), 'dictation');
  assert.equal(normalizeHandwritingMode('tracing'), 'trace');
  assert.equal(normalizeHandwritingMode('unknown'), 'trace');
});

test('recognition response parsing cleans text and deduplicates candidates', () => {
  assert.deepEqual(parseHandwritingResult({
    text: ' rain! ', confidence: 0.91,
    candidates: [{ text: 'Rain', confidence: 0.8 }, { word: 'train', score: 0.6 }]
  }), {
    text: 'rain', confidence: 0.91,
    candidates: [{ text: 'rain', confidence: 0.91 }, { text: 'train', confidence: 0.6 }]
  });
  assert.equal(parseHandwritingResult({ text: 'rain', confidence: 'high' }).confidence, 1);
  assert.equal(parseHandwritingResult({ text: 'rain', confidence: 'medium' }).confidence, 0.5);
});

test('only stable appended letters are eligible for automatic speech', () => {
  assert.equal(appendedConfirmedLetters('', 'Rain'), 'Rain');
  assert.equal(appendedConfirmedLetters('ra', 'rain'), 'in');
  assert.equal(appendedConfirmedLetters('rain', 'train'), '');
  assert.equal(appendedConfirmedLetters('rain', 'rein'), '');
});

test('high confidence recognition accepts and announces only newly appended letters', async () => {
  const accepted = [], letters = [], statuses = [];
  const recognizer = createHandwritingRecognizer({
    request: async () => ({ text: 'rain', confidence: 0.94 }),
    onAccepted: text => accepted.push(text),
    onLetters: text => letters.push(text),
    onStatus: item => statuses.push(item)
  });
  assert.equal(await recognizer.recognize('data:image/png;base64,one'), true);
  assert.deepEqual(accepted, ['rain']);
  assert.deepEqual(letters, ['rain']);
  assert.equal(statuses.at(-1).type, 'ready');
});

test('ambiguous recognition stays unaccepted and silent until learner confirms', async () => {
  const accepted = [], letters = [], candidateSets = [];
  const recognizer = createHandwritingRecognizer({
    request: async () => ({ text: 'rain', confidence: 0.61, candidates: ['train'] }),
    onAccepted: text => accepted.push(text),
    onLetters: text => letters.push(text),
    onCandidates: items => candidateSets.push(items)
  });
  await recognizer.recognize('data:image/png;base64,two');
  assert.deepEqual(accepted, []);
  assert.deepEqual(letters, []);
  assert.deepEqual(candidateSets.at(-1).map(item => item.text), ['rain', 'train']);
  recognizer.confirm('rain');
  assert.deepEqual(accepted, ['rain']);
  assert.deepEqual(letters, ['rain']);
});

test('a newer request aborts and invalidates a stale response', async () => {
  const pending = [];
  const accepted = [];
  const recognizer = createHandwritingRecognizer({
    request: (image, signal) => new Promise(resolve => pending.push({ image, signal, resolve })),
    onAccepted: text => accepted.push(text)
  });
  const first = recognizer.recognize('first');
  await new Promise(resolve => setImmediate(resolve));
  const second = recognizer.recognize('second');
  assert.equal(pending[0].signal.aborted, true);
  pending[0].resolve({ text: 'old', confidence: 1 });
  await new Promise(resolve => setImmediate(resolve));
  pending[1].resolve({ text: 'new', confidence: 1 });
  assert.equal(await first, false);
  assert.equal(await second, true);
  assert.deepEqual(accepted, ['new']);
});

test('recognition requests stay serialized when an aborted provider ignores its signal', async () => {
  const pending = [];
  let concurrent = 0;
  let maximum = 0;
  const recognizer = createHandwritingRecognizer({
    request: image => new Promise(resolve => {
      concurrent += 1;
      maximum = Math.max(maximum, concurrent);
      pending.push({ image, resolve: value => { concurrent -= 1; resolve(value); } });
    })
  });
  const first = recognizer.recognize('first');
  await new Promise(resolve => setImmediate(resolve));
  const second = recognizer.recognize('second');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(pending.length, 1);
  pending[0].resolve({ text: 'old', confidence: 'high' });
  await first;
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(pending.length, 2);
  pending[1].resolve({ text: 'new', confidence: 'high' });
  await second;
  assert.equal(maximum, 1);
});

test('manual correction propagates without pretending letters were newly written', () => {
  const accepted = [], letters = [];
  const recognizer = createHandwritingRecognizer({
    request: async () => ({}),
    onAccepted: (text, meta) => accepted.push([text, meta.source]),
    onLetters: text => letters.push(text)
  });
  recognizer.setValue('dragon');
  assert.deepEqual(accepted, [['dragon', 'manual']]);
  assert.deepEqual(letters, []);
  assert.equal(recognizer.getValue(), 'dragon');
});

test('a new ink revision clears the gradable value but preserves the spoken prefix baseline', async () => {
  const accepted = [], letters = [];
  const responses = [
    { text: 'ra', confidence: 'high' },
    { text: 'rain', confidence: 'high' }
  ];
  const recognizer = createHandwritingRecognizer({
    request: async () => responses.shift(),
    onAccepted: (text, meta) => accepted.push([text, meta.source]),
    onLetters: text => letters.push(text)
  });
  await recognizer.recognize('first');
  recognizer.invalidateValue();
  assert.equal(recognizer.getValue(), '');
  await recognizer.recognize('second');
  assert.deepEqual(accepted, [['ra', 'recognition'], ['', 'ink-change'], ['rain', 'recognition']]);
  assert.deepEqual(letters, ['ra', 'in']);
});

test('manual correction invalidates a late recognition response', async () => {
  let resolveRequest;
  const accepted = [];
  const recognizer = createHandwritingRecognizer({
    request: () => new Promise(resolve => { resolveRequest = resolve; }),
    onAccepted: (text, meta) => accepted.push([text, meta.source])
  });
  const pending = recognizer.recognize('image');
  await new Promise(resolve => setImmediate(resolve));
  recognizer.setValue('rain');
  resolveRequest({ text: 'train', confidence: 'high' });
  assert.equal(await pending, false);
  assert.equal(recognizer.getValue(), 'rain');
  assert.deepEqual(accepted, [['rain', 'manual']]);
});
