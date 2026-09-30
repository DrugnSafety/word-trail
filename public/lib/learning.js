export const REVIEW_DAYS = Object.freeze([1, 3, 7, 14]);

export function normalizeAnswer(text) {
  return String(text ?? '').normalize('NFKC').toLocaleLowerCase('en-US')
    .replace(/[‘’ʼ]/g, "'").trim().replace(/\s+/g, ' ')
    .replace(/[.!?,;:]+$/g, '').trim();
}

export function checkAnswer(input, expected) {
  const answer = normalizeAnswer(input);
  return answer.length > 0 && answer === normalizeAnswer(expected);
}

// UTC calendar days keep the same result on a Mac and an iPad in different zones.
export function nextReview(previous = {}, independent = false, now = new Date()) {
  const date = new Date(now);
  if (!Number.isFinite(date.getTime())) throw new TypeError('Invalid review date');
  const today = date.toISOString().slice(0, 10);
  const prior = previous || {};
  const oldStep = Number.isInteger(prior.step) ? Math.max(-1, Math.min(3, prior.step)) : -1;
  // An early practice may refresh memory, but cannot advance the due review.
  const priorDue = new Date(prior.dueAt).getTime();
  if (independent && (prior.lastReviewedDate === today || (Number.isFinite(priorDue) && priorDue > date.getTime()))) {
    return { step: Math.max(0, oldStep), dueAt: prior.dueAt, lastReviewedDate: prior.lastReviewedDate };
  }
  const step = independent ? Math.min(3, oldStep + 1) : 0;
  const due = new Date(date);
  due.setUTCDate(due.getUTCDate() + REVIEW_DAYS[step]);
  return { step, dueAt: due.toISOString(), lastReviewedDate: today };
}

export function isDue(record, now = new Date()) {
  const review = record?.review || record;
  return Boolean(review?.dueAt) && new Date(review.dueAt).getTime() <= new Date(now).getTime();
}

export function escapeHtml(text) {
  return String(text ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
}

export function speak(text, onStatus = () => {}) {
  const engine = globalThis.speechSynthesis;
  if (!engine || !globalThis.SpeechSynthesisUtterance) {
    onStatus({ type: 'error', message: '이 기기에서는 단어 읽어주기를 지원하지 않아요. 영상 소리를 다시 들어 주세요.' });
    return false;
  }
  engine.cancel();
  const utterance = new SpeechSynthesisUtterance(String(text));
  utterance.lang = 'en-US';
  utterance.rate = 0.85;
  const voices = engine.getVoices();
  utterance.voice = voices.find(voice => voice.lang === 'en-US') || voices.find(voice => /^en[-_]/i.test(voice.lang)) || null;
  utterance.onstart = () => onStatus({ type: 'info', message: '기기의 영어 음성으로 읽고 있어요.' });
  utterance.onend = () => onStatus({ type: 'ready', message: '기기 읽어주기 완료' });
  utterance.onerror = event => {
    if (!['interrupted', 'canceled'].includes(event.error)) onStatus({ type: 'error', message: '기기 영어 음성을 재생할 수 없어요. 영상 소리를 사용해 주세요.' });
  };
  engine.speak(utterance);
  return true;
}

export function createSpeechLoop(onStatus = () => {}, options = {}) {
  const engine = options.engine === undefined ? globalThis.speechSynthesis : options.engine;
  const Utterance = options.Utterance === undefined ? globalThis.SpeechSynthesisUtterance : options.Utterance;
  const setTimer = options.setTimeout ?? options.timers?.setTimeout?.bind(options.timers) ?? globalThis.setTimeout;
  const clearTimer = options.clearTimeout ?? options.timers?.clearTimeout?.bind(options.timers) ?? globalThis.clearTimeout;
  const gapMs = Number.isFinite(options.gapMs) ? Math.max(0, options.gapMs) : 1600;
  let generation = 0;
  let active = false;
  let timer = null;

  function clearPendingTimer() {
    if (timer === null) return;
    clearTimer(timer);
    timer = null;
  }

  function halt(message) {
    generation += 1;
    active = false;
    clearPendingTimer();
    if (engine) engine.cancel();
    onStatus({ type: 'error', message });
  }

  function start(text) {
    const value = String(text ?? '').trim();
    generation += 1;
    const currentGeneration = generation;
    active = false;
    clearPendingTimer();
    if (engine) engine.cancel();

    if (!engine || !Utterance) {
      onStatus({ type: 'error', message: '이 기기에서는 단어 반복 읽어주기를 지원하지 않아요. 영상 소리를 사용해 주세요.' });
      return false;
    }
    if (!value) {
      onStatus({ type: 'error', message: '반복해서 들을 단어가 없어요.' });
      return false;
    }

    active = true;

    function play() {
      if (!active || currentGeneration !== generation) return;
      try {
        const utterance = new Utterance(value);
        let settled = false;
        utterance.lang = 'en-US';
        utterance.rate = 0.85;
        const voices = typeof engine.getVoices === 'function' ? engine.getVoices() : [];
        utterance.voice = voices.find(voice => voice.lang === 'en-US') || voices.find(voice => /^en[-_]/i.test(voice.lang)) || null;
        utterance.onstart = () => {
          if (active && currentGeneration === generation) {
            onStatus({ type: 'info', message: '기기의 영어 음성으로 반복해서 읽고 있어요.' });
          }
        };
        utterance.onend = () => {
          if (settled || !active || currentGeneration !== generation) return;
          settled = true;
          timer = setTimer(() => {
            timer = null;
            play();
          }, gapMs);
        };
        utterance.onerror = () => {
          if (settled || !active || currentGeneration !== generation) return;
          settled = true;
          halt('기기 영어 음성을 반복 재생할 수 없어요. 영상 소리를 사용해 주세요.');
        };
        engine.speak(utterance);
      } catch {
        if (active && currentGeneration === generation) {
          halt('기기 영어 음성을 반복 재생할 수 없어요. 영상 소리를 사용해 주세요.');
        }
      }
    }

    play();
    return active;
  }

  function stop() {
    const wasActive = active;
    generation += 1;
    active = false;
    clearPendingTimer();
    if (engine) engine.cancel();
    if (wasActive) onStatus({ type: 'ready', message: '단어 반복 재생을 멈췄어요.' });
  }

  return { start, stop, isActive: () => active };
}

export function insertedLetters(previous, next, inputType, isComposing = false) {
  if (inputType !== 'insertText' || isComposing) return '';
  const before = String(previous ?? '');
  const after = String(next ?? '');
  if (after.length <= before.length) return '';
  let prefix = 0;
  while (prefix < before.length && prefix < after.length && before[prefix] === after[prefix]) prefix += 1;
  let suffix = 0;
  while (
    suffix < before.length - prefix
    && suffix < after.length - prefix
    && before[before.length - 1 - suffix] === after[after.length - 1 - suffix]
  ) suffix += 1;
  return after.slice(prefix, after.length - suffix).replace(/[^A-Za-z]/g, '');
}

const LETTER_NAMES = Object.freeze({
  a: 'ay', b: 'bee', c: 'cee', d: 'dee', e: 'ee', f: 'ef', g: 'gee',
  h: 'aitch', i: 'eye', j: 'jay', k: 'kay', l: 'el', m: 'em', n: 'en',
  o: 'oh', p: 'pee', q: 'cue', r: 'ar', s: 'ess', t: 'tee', u: 'you',
  v: 'vee', w: 'double you', x: 'ex', y: 'why', z: 'zee'
});

export function createLetterSpeaker(onStatus = () => {}) {
  const engine = globalThis.speechSynthesis;
  const Utterance = globalThis.SpeechSynthesisUtterance;
  let generation = 0;
  let warned = false;

  function enqueue(text) {
    const letters = String(text ?? '').match(/[A-Za-z]/g) ?? [];
    if (!letters.length) return [];
    if (!engine || !Utterance) {
      if (!warned) onStatus({ type: 'error', message: '이 기기에서는 글자 읽어주기를 지원하지 않아요.' });
      warned = true;
      return [];
    }
    const queuedGeneration = generation;
    for (const letter of letters) {
      const utterance = new Utterance(LETTER_NAMES[letter.toLowerCase()]);
      utterance.lang = 'en-US';
      utterance.volume = 1;
      utterance.rate = 0.8;
      utterance.onstart = () => {
        if (queuedGeneration === generation) onStatus({ type: 'letter', letter });
      };
      utterance.onerror = event => {
        if (queuedGeneration === generation && !['interrupted', 'canceled'].includes(event.error)) {
          onStatus({ type: 'error', message: '글자 소리를 재생할 수 없어요.' });
        }
      };
      engine.speak(utterance);
    }
    return letters;
  }

  function cancel() {
    generation += 1;
    if (engine) engine.cancel();
  }

  return { enqueue, cancel };
}
