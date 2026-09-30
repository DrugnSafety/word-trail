import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeAnswer, checkAnswer, nextReview, isDue, speak, insertedLetters, createLetterSpeaker, createSpeechLoop
} from '../public/lib/learning.js';

test('spelling tolerates presentation differences, not different words', () => {
  assert.equal(normalizeAnswer('  Let’s   Go!  '), "let's go");
  assert.ok(checkAnswer('THANK YOU.', 'thank you'));
  assert.ok(checkAnswer('  I’m ready! ', "I'm ready"));
  assert.equal(checkAnswer('your', "you're"), false);
  assert.equal(checkAnswer('help', 'help me'), false);
  assert.equal(checkAnswer('', ''), false);
});

test('reading schedules 1/3/7/14 days and resists same-day/early repetition', () => {
  const first = nextReview({}, true, '2026-09-25T14:00:00Z');
  assert.deepEqual(first, { step: 0, dueAt: '2026-09-26T14:00:00.000Z', lastReviewedDate: '2026-09-25' });
  assert.deepEqual(nextReview(first, true, '2026-09-25T18:00:00Z'), first);
  assert.deepEqual(nextReview(first, true, '2026-09-26T10:00:00Z'), first);
  const second = nextReview(first, true, '2026-09-26T15:00:00Z');
  assert.equal(second.step, 1);
  assert.equal(second.dueAt, '2026-09-29T15:00:00.000Z');
  const third = nextReview(second, true, second.dueAt);
  assert.equal(third.dueAt, '2026-10-06T15:00:00.000Z');
  const fourth = nextReview(third, true, third.dueAt);
  assert.equal(fourth.dueAt, '2026-10-20T15:00:00.000Z');
  assert.equal(nextReview(fourth, true, fourth.dueAt).step, 3);
});

test('helped reading resets to tomorrow; due comparison crosses year and time zones', () => {
  const result = nextReview({ step: 3 }, false, '2026-12-31T23:30:00-05:00');
  assert.equal(result.dueAt, '2027-01-02T04:30:00.000Z');
  assert.equal(result.step, 0);
  assert.equal(isDue({ review: result }, '2027-01-02T04:29:59Z'), false);
  assert.equal(isDue({ review: result }, result.dueAt), true);
  assert.equal(isDue({}), false);
});

test('speech fallback is explicit when browser speech is unavailable', () => {
  const status = [];
  assert.equal(speak('hello', message => status.push(message)), false);
  assert.equal(status[0].type, 'error');
});

test('inserted letters only reports ordinary ASCII insertText changes', () => {
  assert.equal(insertedLetters('ac', 'abc', 'insertText', false), 'b');
  assert.equal(insertedLetters('', 'A!', 'insertText', false), 'A');
  assert.equal(insertedLetters('a', 'ab', 'insertFromPaste', false), '');
  assert.equal(insertedLetters('a', '', 'deleteContentBackward', false), '');
  assert.equal(insertedLetters('', '한', 'insertText', true), '');
});

test('letter speaker queues explicit alphabet names and preserves typed case in status', () => {
  const originalEngine = globalThis.speechSynthesis;
  const OriginalUtterance = globalThis.SpeechSynthesisUtterance;
  const utterances = [];
  let cancellations = 0;
  class MockUtterance { constructor(text) { this.text = text; } }
  globalThis.speechSynthesis = {
    speak(utterance) { utterances.push(utterance); },
    cancel() { cancellations += 1; }
  };
  globalThis.SpeechSynthesisUtterance = MockUtterance;
  try {
    const statuses = [];
    const speaker = createLetterSpeaker(status => statuses.push(status));
    assert.deepEqual(speaker.enqueue('a-B'), ['a', 'B']);
    assert.equal(cancellations, 0);
    assert.deepEqual(utterances.map(item => [item.text, item.lang, item.volume]), [
      ['ay', 'en-US', 1], ['bee', 'en-US', 1]
    ]);
    utterances[0].onstart();
    utterances[1].onstart();
    assert.deepEqual(statuses, [
      { type: 'letter', letter: 'a' },
      { type: 'letter', letter: 'B' }
    ]);
    speaker.cancel();
    assert.equal(cancellations, 1);
    utterances[1].onstart();
    utterances[1].onerror({ error: 'network' });
    assert.deepEqual(statuses, [
      { type: 'letter', letter: 'a' },
      { type: 'letter', letter: 'B' }
    ]);
  } finally {
    globalThis.speechSynthesis = originalEngine;
    globalThis.SpeechSynthesisUtterance = OriginalUtterance;
  }
});

test('letter speaker has pronunciation text for every English letter', () => {
  const originalEngine = globalThis.speechSynthesis;
  const OriginalUtterance = globalThis.SpeechSynthesisUtterance;
  const utterances = [];
  class MockUtterance { constructor(text) { this.text = text; } }
  globalThis.speechSynthesis = {
    speak(utterance) { utterances.push(utterance); },
    cancel() {}
  };
  globalThis.SpeechSynthesisUtterance = MockUtterance;
  try {
    const alphabet = 'abcdefghijklmnopqrstuvwxyz';
    createLetterSpeaker().enqueue(alphabet);
    assert.deepEqual(utterances.map(item => item.text), [
      'ay', 'bee', 'cee', 'dee', 'ee', 'ef', 'gee', 'aitch', 'eye',
      'jay', 'kay', 'el', 'em', 'en', 'oh', 'pee', 'cue', 'ar', 'ess',
      'tee', 'you', 'vee', 'double you', 'ex', 'why', 'zee'
    ]);
    assert.ok(utterances.every(item => !/\b(?:capital|letter)\b/i.test(item.text)));
  } finally {
    globalThis.speechSynthesis = originalEngine;
    globalThis.SpeechSynthesisUtterance = OriginalUtterance;
  }
});

function speechLoopHarness() {
  const utterances = [];
  const timers = new Map();
  const clearedTimers = [];
  let timerId = 0;
  let cancellations = 0;
  class MockUtterance { constructor(text) { this.text = text; } }
  const engine = {
    speak(utterance) { utterances.push(utterance); },
    cancel() { cancellations += 1; },
    getVoices() { return [{ lang: 'en-GB', name: 'British' }, { lang: 'en-US', name: 'American' }]; }
  };
  const setTimeout = (callback, delay) => {
    const id = ++timerId;
    timers.set(id, { callback, delay });
    return id;
  };
  const clearTimeout = id => {
    clearedTimers.push(id);
    timers.delete(id);
  };
  return {
    engine, MockUtterance, utterances, timers, clearedTimers, setTimeout, clearTimeout,
    cancellations: () => cancellations,
    runTimer(id) {
      const timer = timers.get(id);
      timers.delete(id);
      timer.callback();
    }
  };
}

test('speech loop speaks immediately and repeats only after utterance end plus the gap', () => {
  const mock = speechLoopHarness();
  const statuses = [];
  const loop = createSpeechLoop(status => statuses.push(status), {
    engine: mock.engine,
    Utterance: mock.MockUtterance,
    setTimeout: mock.setTimeout,
    clearTimeout: mock.clearTimeout
  });

  assert.equal(loop.start('practice'), true);
  assert.equal(loop.isActive(), true);
  assert.equal(mock.cancellations(), 1);
  assert.equal(mock.utterances.length, 1);
  assert.equal(mock.utterances[0].text, 'practice');
  assert.equal(mock.utterances[0].lang, 'en-US');
  assert.equal(mock.utterances[0].rate, 0.85);
  assert.equal(mock.utterances[0].voice.name, 'American');
  assert.equal(mock.timers.size, 0);

  mock.utterances[0].onstart();
  assert.equal(statuses.at(-1).type, 'info');
  mock.utterances[0].onend();
  assert.equal(mock.timers.size, 1);
  const [timerId, timer] = [...mock.timers.entries()][0];
  assert.equal(timer.delay, 1600);
  assert.equal(mock.utterances.length, 1);
  mock.runTimer(timerId);
  assert.equal(mock.utterances.length, 2);
});

test('speech loop stop clears pending work and stale events cannot restart it', () => {
  const mock = speechLoopHarness();
  const loop = createSpeechLoop(() => {}, {
    engine: mock.engine,
    Utterance: mock.MockUtterance,
    timers: { setTimeout: mock.setTimeout, clearTimeout: mock.clearTimeout }
  });

  loop.start('again');
  const first = mock.utterances[0];
  first.onend();
  const timerId = [...mock.timers.keys()][0];
  loop.stop();
  assert.equal(loop.isActive(), false);
  assert.deepEqual(mock.clearedTimers, [timerId]);
  assert.equal(mock.cancellations(), 2);
  first.onend();
  assert.equal(mock.timers.size, 0);
  assert.equal(mock.utterances.length, 1);
});

test('speech loop rapid restart ignores the former utterance and repeats only the new text', () => {
  const mock = speechLoopHarness();
  const loop = createSpeechLoop(() => {}, {
    engine: mock.engine,
    Utterance: mock.MockUtterance,
    setTimeout: mock.setTimeout,
    clearTimeout: mock.clearTimeout,
    gapMs: 25
  });

  loop.start('old');
  const oldUtterance = mock.utterances[0];
  assert.equal(loop.start('new'), true);
  assert.equal(mock.cancellations(), 2);
  assert.deepEqual(mock.utterances.map(item => item.text), ['old', 'new']);
  oldUtterance.onend();
  oldUtterance.onerror({ error: 'network' });
  assert.equal(loop.isActive(), true);
  assert.equal(mock.timers.size, 0);

  mock.utterances[1].onend();
  const [timerId, timer] = [...mock.timers.entries()][0];
  assert.equal(timer.delay, 25);
  mock.runTimer(timerId);
  assert.deepEqual(mock.utterances.map(item => item.text), ['old', 'new', 'new']);
});

test('speech loop halts on an active speech error and reports unsupported speech', () => {
  const mock = speechLoopHarness();
  const statuses = [];
  const loop = createSpeechLoop(status => statuses.push(status), {
    engine: mock.engine,
    Utterance: mock.MockUtterance,
    setTimeout: mock.setTimeout,
    clearTimeout: mock.clearTimeout
  });
  loop.start('error');
  mock.utterances[0].onerror({ error: 'network' });
  assert.equal(loop.isActive(), false);
  assert.equal(mock.cancellations(), 2);
  assert.equal(statuses.at(-1).type, 'error');
  mock.utterances[0].onend();
  assert.equal(mock.timers.size, 0);

  const unsupportedStatuses = [];
  const unsupported = createSpeechLoop(status => unsupportedStatuses.push(status), { engine: null, Utterance: null });
  assert.equal(unsupported.start('hello'), false);
  assert.equal(unsupported.isActive(), false);
  assert.equal(unsupportedStatuses.at(-1).type, 'error');
});
