import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeAnswer, checkAnswer, nextReview, isDue, speak, cancelWordSpeech, insertedLetters, createLetterSpeaker, createSpeechLoop
} from '../public/lib/learning.js';

test('recorded A serializes with speech and cancellation ignores stale audio callbacks', async () => {
  const originals = [globalThis.Audio, globalThis.speechSynthesis, globalThis.SpeechSynthesisUtterance];
  const recordings = [], spoken = [], statuses = [];
  globalThis.Audio = class {
    constructor(src) { this.src = src; recordings.push(this); }
    play() { this.onplaying?.(); return Promise.resolve(); }
    pause() { this.paused = true; }
  };
  globalThis.SpeechSynthesisUtterance = class { constructor(text) { this.text = text; } };
  globalThis.speechSynthesis = { getVoices: () => [], speak: item => spoken.push(item), cancel() {}, resume() {} };
  try {
    const toneLetters = []; let toneStops = 0;
    const speaker = createLetterSpeaker(item => statuses.push(item), { tonePlayer: { unlock() {}, play(letter) { toneLetters.push(letter); }, stop() { toneStops++; } } });
    speaker.enqueue('ab');
    assert.match(recordings[0].src, /audio\/letter-a\.mp3$/);
    assert.equal(spoken.length, 0);
    recordings[0].onended();
    assert.equal(spoken[0].text, 'bee');
    assert.deepEqual(toneLetters, ['a', 'b']);
    spoken[0].onend();
    speaker.enqueue('ac');
    const stale = recordings[1].onended;
    speaker.cancel();
    assert.equal(toneStops, 1);
    assert.equal(recordings[1].paused, true);
    stale();
    assert.equal(spoken.length, 1);
    speaker.enqueue('a');
    recordings[2].onerror();
    assert.equal(statuses.at(-1).type, 'error');
    assert.equal(spoken.some(item => item.text === 'ay'), false);
  } finally {
    [globalThis.Audio, globalThis.speechSynthesis, globalThis.SpeechSynthesisUtterance] = originals;
  }
});

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

test('word speech reports synchronous engine failures without throwing', () => {
  const originalEngine = globalThis.speechSynthesis;
  const OriginalUtterance = globalThis.SpeechSynthesisUtterance;
  class MockUtterance { constructor(text) { this.text = text; } }
  globalThis.SpeechSynthesisUtterance = MockUtterance;
  try {
    for (const failingMethod of ['cancel', 'speak']) {
      const statuses = [];
      globalThis.speechSynthesis = {
        speaking: failingMethod === 'cancel',
        getVoices() { return []; },
        cancel() { if (failingMethod === 'cancel') throw new Error('engine failure'); },
        speak() { if (failingMethod === 'speak') throw new Error('engine failure'); }
      };
      assert.doesNotThrow(() => assert.equal(speak('hello', status => statuses.push(status)), false));
      assert.equal(statuses.at(-1).type, 'error');
    }
  } finally {
    globalThis.speechSynthesis = originalEngine;
    globalThis.SpeechSynthesisUtterance = OriginalUtterance;
  }
});

test('word speech resumes a paused engine and ignores callbacks from a replaced request', () => {
  const originalEngine = globalThis.speechSynthesis;
  const OriginalUtterance = globalThis.SpeechSynthesisUtterance;
  const utterances = [];
  const statuses = [];
  let cancellations = 0;
  let resumes = 0;
  class MockUtterance { constructor(text) { this.text = text; } }
  globalThis.speechSynthesis = {
    paused: true,
    getVoices() { return []; },
    speak(utterance) { utterances.push(utterance); },
    cancel() { cancellations += 1; },
    resume() { resumes += 1; this.paused = false; }
  };
  globalThis.SpeechSynthesisUtterance = MockUtterance;
  try {
    assert.equal(speak('first', status => statuses.push(status)), true);
    assert.equal(resumes, 1);
    assert.equal(utterances[0].rate, 1);
    globalThis.speechSynthesis.paused = true;
    assert.equal(speak('second', status => statuses.push(status)), true);
    assert.equal(cancellations, 1);
    assert.equal(resumes, 2);
    utterances[0].onend();
    assert.equal(statuses.length, 0);
    utterances[1].onstart();
    utterances[1].onend();
    assert.deepEqual(statuses.map(status => status.type), ['info', 'ready']);
    assert.equal(cancelWordSpeech(), false);
    assert.equal(cancellations, 1);

    assert.equal(speak('third', status => statuses.push(status)), true);
    assert.equal(cancelWordSpeech(status => statuses.push(status)), true);
    assert.equal(cancellations, 2);
    utterances[2].onend();
    assert.deepEqual(statuses.map(status => status.type), ['info', 'ready']);
  } finally {
    globalThis.speechSynthesis = originalEngine;
    globalThis.SpeechSynthesisUtterance = OriginalUtterance;
  }
});

test('inserted letters only reports ordinary ASCII insertText changes', () => {
  assert.equal(insertedLetters('ac', 'abc', 'insertText', false), 'b');
  assert.equal(insertedLetters('', 'A!', 'insertText', false), 'A');
  assert.equal(insertedLetters('a', 'ab', 'insertFromPaste', false), '');
  assert.equal(insertedLetters('a', '', 'deleteContentBackward', false), '');
  assert.equal(insertedLetters('', '한', 'insertText', true), '');
});

test('letter speaker serializes real graphemes and preserves typed case in status', () => {
  const originalEngine = globalThis.speechSynthesis;
  const OriginalUtterance = globalThis.SpeechSynthesisUtterance;
  const utterances = [];
  let cancellations = 0;
  let resumes = 0;
  class MockUtterance { constructor(text) { this.text = text; } }
  globalThis.speechSynthesis = {
    paused: true,
    speak(utterance) { utterances.push(utterance); },
    cancel() { cancellations += 1; },
    resume() { resumes += 1; this.paused = false; }
  };
  globalThis.SpeechSynthesisUtterance = MockUtterance;
  try {
    const statuses = [];
    const speaker = createLetterSpeaker(status => statuses.push(status));
    assert.deepEqual(speaker.enqueue('a-B'), ['a', 'B']);
    assert.equal(cancellations, 0);
    assert.deepEqual(utterances.map(item => [item.text, item.lang, item.volume, item.rate]), [
      ['ay', 'en-US', 1, 1]
    ]);
    assert.equal(resumes, 1);
    utterances[0].onstart();
    utterances[0].onend();
    assert.deepEqual(utterances.map(item => item.text), ['ay', 'bee']);
    assert.equal(resumes, 2);
    utterances[1].onstart();
    assert.deepEqual(statuses, [
      { type: 'letter', letter: 'a' },
      { type: 'letter', letter: 'B' }
    ]);
    speaker.cancel();
    assert.equal(cancellations, 1);
    utterances[1].onstart();
    utterances[1].onerror({ error: 'network' });
    utterances[1].onend();
    assert.equal(utterances.length, 2);
    assert.deepEqual(statuses, [
      { type: 'letter', letter: 'a' },
      { type: 'letter', letter: 'B' }
    ]);
  } finally {
    globalThis.speechSynthesis = originalEngine;
    globalThis.SpeechSynthesisUtterance = OriginalUtterance;
  }
});

test('letter speaker drops stale pending letters during rapid typing', () => {
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
    const speaker = createLetterSpeaker();
    for (const letter of 'abcde') speaker.enqueue(letter);
    assert.deepEqual(utterances.map(item => item.text), ['ay']);
    utterances[0].onend();
    utterances[1].onend();
    utterances[2].onend();
    utterances[3].onend();
    assert.deepEqual(utterances.map(item => item.text), ['ay', 'see', 'dee', 'ee']);
  } finally {
    globalThis.speechSynthesis = originalEngine;
    globalThis.SpeechSynthesisUtterance = OriginalUtterance;
  }
});

test('letter speaker bounds a long typing burst to the active and latest three letters', () => {
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
    assert.deepEqual(utterances.map(item => item.text), ['ay']);
    utterances[0].onend();
    utterances[1].onend();
    utterances[2].onend();
    utterances[3].onend();
    assert.deepEqual(utterances.map(item => item.text), ['ay', 'ex', 'why', 'zee']);
    assert.ok(utterances.every(item => !/\b(?:capital|letter)\b/i.test(item.text)));
  } finally {
    globalThis.speechSynthesis = originalEngine;
    globalThis.SpeechSynthesisUtterance = OriginalUtterance;
  }
});

test('letter speaker uses the same persisted English voice as word speech', () => {
  const originalEngine = globalThis.speechSynthesis;
  const OriginalUtterance = globalThis.SpeechSynthesisUtterance;
  const originalWindow = globalThis.window;
  const utterances = [];
  const voices = [
    { lang: 'en-US', name: 'Default', voiceURI: 'default', default: true },
    { lang: 'en-GB', name: 'Sonia Natural', voiceURI: 'sonia' }
  ];
  class MockUtterance { constructor(text) { this.text = text; } }
  globalThis.window = { localStorage: { getItem() { return 'sonia'; } } };
  globalThis.speechSynthesis = {
    getVoices() { return voices; },
    speak(utterance) { utterances.push(utterance); },
    cancel() {}
  };
  globalThis.SpeechSynthesisUtterance = MockUtterance;
  try {
    createLetterSpeaker().enqueue('a');
    speak('apple');
    assert.deepEqual(utterances.map(item => [item.text, item.voice?.voiceURI, item.lang]), [
      ['ay', 'sonia', 'en-GB'],
      ['apple', 'sonia', 'en-GB']
    ]);
    assert.ok(utterances.every(item => item.rate === 1));
    utterances[1].onend();
  } finally {
    globalThis.speechSynthesis = originalEngine;
    globalThis.SpeechSynthesisUtterance = OriginalUtterance;
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
  }
});

test('letter speaker contains synchronous speak and cancel failures', () => {
  const originalEngine = globalThis.speechSynthesis;
  const OriginalUtterance = globalThis.SpeechSynthesisUtterance;
  class MockUtterance { constructor(text) { this.text = text; } }
  globalThis.SpeechSynthesisUtterance = MockUtterance;
  try {
    const statuses = [];
    let cancelCalls = 0;
    globalThis.speechSynthesis = {
      getVoices() { return []; },
      speak() { throw new Error('engine failure'); },
      cancel() { cancelCalls += 1; throw new Error('engine failure'); }
    };
    const speaker = createLetterSpeaker(status => statuses.push(status));
    assert.doesNotThrow(() => assert.deepEqual(speaker.enqueue('ab'), []));
    assert.equal(statuses.at(-1).message, '글자 소리를 재생할 수 없어요.');
    assert.doesNotThrow(() => speaker.cancel());
    assert.equal(cancelCalls, 0);

    globalThis.speechSynthesis.speak = () => {};
    const activeSpeaker = createLetterSpeaker(status => statuses.push(status));
    activeSpeaker.enqueue('a');
    assert.doesNotThrow(() => activeSpeaker.cancel());
    assert.equal(cancelCalls, 1);
    assert.equal(statuses.at(-1).message, '글자 소리를 멈출 수 없어요.');
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
  assert.equal(mock.cancellations(), 0);
  assert.equal(mock.utterances.length, 1);
  assert.equal(mock.utterances[0].text, 'practice');
  assert.equal(mock.utterances[0].lang, 'en-US');
  assert.equal(mock.utterances[0].rate, 1);
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
  assert.equal(mock.cancellations(), 1);
  loop.stop();
  assert.equal(mock.cancellations(), 1);
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
  assert.equal(mock.cancellations(), 1);
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
  assert.equal(mock.cancellations(), 1);
  assert.equal(statuses.at(-1).type, 'error');
  mock.utterances[0].onend();
  assert.equal(mock.timers.size, 0);

  const unsupportedStatuses = [];
  const unsupported = createSpeechLoop(status => unsupportedStatuses.push(status), { engine: null, Utterance: null });
  assert.equal(unsupported.start('hello'), false);
  assert.equal(unsupported.isActive(), false);
  assert.equal(unsupportedStatuses.at(-1).type, 'error');
});
