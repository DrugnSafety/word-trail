import { alphabetSpeechText, configureUtterance } from './voice-settings.js';
import { createLetterTonePlayer } from './letter-tones.js';

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

let wordSpeechGeneration = 0;
let activeWordUtterance = null;
let activeWordEngine = null;

function resumeSpeechEngine(engine) {
  if (typeof engine?.resume === 'function') engine.resume();
}

export function cancelWordSpeech(onStatus = () => {}) {
  wordSpeechGeneration += 1;
  if (!activeWordUtterance || !activeWordEngine) return false;
  const engine = activeWordEngine;
  activeWordUtterance = null;
  activeWordEngine = null;
  try {
    engine.cancel();
    return true;
  } catch {
    onStatus({ type: 'error', message: '기기 영어 음성을 멈출 수 없어요.' });
    return false;
  }
}

export function speak(text, onStatus = () => {}) {
  const engine = globalThis.speechSynthesis;
  if (!engine || !globalThis.SpeechSynthesisUtterance) {
    onStatus({ type: 'error', message: '이 기기에서는 단어 읽어주기를 지원하지 않아요. 영상 소리를 다시 들어 주세요.' });
    return false;
  }
  const generation = ++wordSpeechGeneration;
  try {
    if (activeWordUtterance && activeWordEngine) activeWordEngine.cancel();
    else if (engine.speaking || engine.pending) engine.cancel();
    const utterance = new SpeechSynthesisUtterance(String(text));
    activeWordUtterance = utterance;
    activeWordEngine = engine;
    configureUtterance(utterance, { engine, rate: 1 });
    utterance.onstart = () => {
      if (generation === wordSpeechGeneration && activeWordUtterance === utterance) {
        onStatus({ type: 'info', message: '기기의 영어 음성으로 읽고 있어요.' });
      }
    };
    utterance.onend = () => {
      if (generation !== wordSpeechGeneration || activeWordUtterance !== utterance) return;
      activeWordUtterance = null;
      activeWordEngine = null;
      onStatus({ type: 'ready', message: '기기 읽어주기 완료' });
    };
    utterance.onerror = event => {
      if (generation !== wordSpeechGeneration || activeWordUtterance !== utterance) return;
      activeWordUtterance = null;
      activeWordEngine = null;
      if (!['interrupted', 'canceled'].includes(event.error)) onStatus({ type: 'error', message: '기기 영어 음성을 재생할 수 없어요. 영상 소리를 사용해 주세요.' });
    };
    engine.speak(utterance);
    resumeSpeechEngine(engine);
    return true;
  } catch {
    if (generation === wordSpeechGeneration) {
      activeWordUtterance = null;
      activeWordEngine = null;
    }
    onStatus({ type: 'error', message: '기기 영어 음성을 재생할 수 없어요. 영상 소리를 사용해 주세요.' });
    return false;
  }
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
    const hadWork = active || timer !== null;
    active = false;
    clearPendingTimer();
    if (engine && hadWork) {
      try { engine.cancel(); } catch { /* status below remains the useful error */ }
    }
    onStatus({ type: 'error', message });
  }

  function start(text) {
    const value = String(text ?? '').trim();
    const hadWork = active || timer !== null;
    generation += 1;
    const currentGeneration = generation;
    active = false;
    clearPendingTimer();
    if (engine && hadWork) {
      try { engine.cancel(); } catch {
        onStatus({ type: 'error', message: '기기 영어 음성을 반복 재생할 수 없어요. 영상 소리를 사용해 주세요.' });
        return false;
      }
    }

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
        configureUtterance(utterance, { engine, rate: 1 });
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
        resumeSpeechEngine(engine);
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
    const hadWork = active || timer !== null;
    generation += 1;
    active = false;
    clearPendingTimer();
    if (engine && hadWork) {
      try { engine.cancel(); } catch {
        onStatus({ type: 'error', message: '단어 반복 재생을 멈출 수 없어요.' });
        return;
      }
    }
    if (hadWork) onStatus({ type: 'ready', message: '단어 반복 재생을 멈췄어요.' });
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

export function createLetterSpeaker(onStatus = () => {}, { tonePlayer = createLetterTonePlayer() } = {}) {
  const engine = globalThis.speechSynthesis;
  const Utterance = globalThis.SpeechSynthesisUtterance;
  let generation = 0;
  let warned = false;
  let activeUtterance = null;
  let activeAudio = null;
  let pending = [];

  function playNext() {
    if (activeUtterance || activeAudio || !pending.length) return true;
    const item = pending.shift();
    const currentGeneration = generation;
    try {
      tonePlayer.play(item.letter);
      if (item.letter.toLowerCase() === 'a' && typeof globalThis.Audio === 'function') {
        const audio = new globalThis.Audio(new URL('../audio/letter-a.mp3', import.meta.url).href);
        activeAudio = audio;
        const settleAudio = error => {
          if (currentGeneration !== generation || activeAudio !== audio) return;
          activeAudio = null;
          audio.onended = audio.onerror = audio.onplaying = null;
          if (error) onStatus({ type: 'error', message: 'A의 글자 소리를 재생하지 못했어요. 다시 입력해 주세요.' });
          playNext();
        };
        audio.onplaying = () => {
          if (currentGeneration === generation && activeAudio === audio) onStatus({ type: 'letter', letter: item.letter });
        };
        audio.onended = () => settleAudio(false);
        audio.onerror = () => settleAudio(true);
        audio.play().catch(() => settleAudio(true));
        return true;
      }
      const utterance = new Utterance(alphabetSpeechText(item.letter));
      activeUtterance = utterance;
      configureUtterance(utterance, { engine, rate: 1, volume: 1 });
      utterance.onstart = () => {
        if (currentGeneration === generation && activeUtterance === utterance) {
          onStatus({ type: 'letter', letter: item.letter });
        }
      };
      const settle = event => {
        if (currentGeneration !== generation || activeUtterance !== utterance) return;
        activeUtterance = null;
        if (event?.type === 'error' && !['interrupted', 'canceled'].includes(event.error)) {
          onStatus({ type: 'error', message: '글자 소리를 재생할 수 없어요.' });
        }
        playNext();
      };
      utterance.onend = settle;
      utterance.onerror = event => settle({ type: 'error', error: event?.error });
      engine.speak(utterance);
      resumeSpeechEngine(engine);
      return true;
    } catch {
      if (activeAudio) {
        activeAudio.onended = activeAudio.onerror = activeAudio.onplaying = null;
        try { activeAudio.pause(); } catch {}
        activeAudio = null;
      }
      activeUtterance = null;
      pending = [];
      if (currentGeneration === generation) onStatus({ type: 'error', message: '글자 소리를 재생할 수 없어요.' });
      return false;
    }
  }

  function enqueue(text) {
    const letters = String(text ?? '').match(/[A-Za-z]/g) ?? [];
    if (!letters.length) return [];
    if (!engine || !Utterance) {
      if (!warned) onStatus({ type: 'error', message: '이 기기에서는 글자 읽어주기를 지원하지 않아요.' });
      warned = true;
      return [];
    }
    const additions = letters.map(letter => ({ letter }));
    tonePlayer.unlock();
    if (!activeUtterance && !activeAudio && !pending.length) {
      pending.push(additions.shift());
      if (!playNext()) return [];
    }
    pending.push(...additions);
    if (pending.length > 3) pending = pending.slice(-3);
    return letters;
  }

  function cancel() {
    const hadWork = Boolean(activeUtterance || pending.length);
    generation += 1;
    tonePlayer.stop();
    if (activeAudio) {
      activeAudio.onended = activeAudio.onerror = activeAudio.onplaying = null;
      try { activeAudio.pause(); } catch {}
      activeAudio = null;
    }
    activeUtterance = null;
    pending = [];
    if (!engine || !hadWork) return;
    try {
      engine.cancel();
    } catch {
      onStatus({ type: 'error', message: '글자 소리를 멈출 수 없어요.' });
    }
  }

  return { enqueue, cancel };
}
