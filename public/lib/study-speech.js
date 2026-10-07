import { alphabetSpeechText, configureUtterance } from './voice-settings.js';

function guideSegments(guide) {
  const source = Array.isArray(guide) ? guide : Array.isArray(guide?.segments) ? guide.segments : [];
  return source.map(item => String(typeof item === 'string' ? item : item?.text ?? '').trim()).filter(Boolean);
}

function segmentRanges(word, segments) {
  const source = String(word).toLocaleLowerCase('en-US');
  let cursor = 0;
  return segments.map(text => {
    const needle = text.toLocaleLowerCase('en-US').replace(/[^a-z']/g, '');
    const found = needle ? source.indexOf(needle, cursor) : -1;
    const start = found >= 0 ? found : cursor;
    const end = Math.max(start + 1, start + needle.length);
    cursor = end;
    return { text, start, end };
  });
}

export function createStudySpeechSequence({
  onStatus = () => {},
  onHighlight = () => {},
  engine = globalThis.speechSynthesis,
  Utterance = globalThis.SpeechSynthesisUtterance,
  Audio = globalThis.Audio
} = {}) {
  let generation = 0;
  let active = false;
  let activeUtterance = null;
  let activeAudio = null;

  function cleanActiveMedia() {
    if (activeUtterance) {
      activeUtterance.onstart = null;
      activeUtterance.onend = null;
      activeUtterance.onerror = null;
      activeUtterance.onboundary = null;
      activeUtterance = null;
    }
    if (activeAudio) {
      activeAudio.onplaying = null;
      activeAudio.onended = null;
      activeAudio.onerror = null;
      try { activeAudio.pause?.(); } catch {}
      activeAudio = null;
    }
  }

  function cancelEngine() {
    try { engine?.cancel?.(); } catch {}
  }

  function stop({ silent = false } = {}) {
    const hadWork = active || activeUtterance || activeAudio;
    generation += 1;
    active = false;
    cleanActiveMedia();
    if (hadWork) cancelEngine();
    if (hadWork && !silent) onStatus({ type: 'ready', message: '단어 읽기를 멈췄어요.' });
  }

  function fail(currentGeneration, message) {
    if (currentGeneration !== generation) return;
    active = false;
    cleanActiveMedia();
    cancelEngine();
    onStatus({ type: 'error', message });
  }

  function speakPart(text, highlight, currentGeneration, { rate = 1, onBoundary } = {}) {
    return new Promise((resolve, reject) => {
      if (!active || currentGeneration !== generation) return resolve(false);
      try {
        const utterance = new Utterance(text);
        activeUtterance = utterance;
        configureUtterance(utterance, { engine, rate });
        utterance.onstart = () => {
          if (!active || currentGeneration !== generation || activeUtterance !== utterance) return;
          if (highlight) onHighlight(highlight);
        };
        utterance.onboundary = event => {
          if (active && currentGeneration === generation && activeUtterance === utterance) onBoundary?.(event);
        };
        utterance.onend = () => {
          if (!active || currentGeneration !== generation || activeUtterance !== utterance) return resolve(false);
          activeUtterance = null;
          resolve(true);
        };
        utterance.onerror = event => {
          if (!active || currentGeneration !== generation || activeUtterance !== utterance) return resolve(false);
          activeUtterance = null;
          if (['interrupted', 'canceled'].includes(event?.error)) resolve(false);
          else reject(new Error('speech-error'));
        };
        engine.speak(utterance);
        engine.resume?.();
      } catch (error) {
        activeUtterance = null;
        reject(error);
      }
    });
  }

  function playRecordedA(currentGeneration, index) {
    if (typeof Audio !== 'function') return speakPart('ay', { type: 'letter', index, text: 'a' }, currentGeneration);
    return new Promise((resolve, reject) => {
      if (!active || currentGeneration !== generation) return resolve(false);
      try {
        const audio = new Audio(new URL('../audio/letter-a.mp3', import.meta.url).href);
        activeAudio = audio;
        let started = false;
        audio.onplaying = () => {
          if (!active || currentGeneration !== generation || activeAudio !== audio) return;
          started = true;
          onHighlight({ type: 'letter', index, text: 'a' });
        };
        audio.onended = () => {
          if (!active || currentGeneration !== generation || activeAudio !== audio) return resolve(false);
          activeAudio = null;
          resolve(true);
        };
        audio.onerror = () => {
          if (!active || currentGeneration !== generation || activeAudio !== audio) return resolve(false);
          activeAudio = null;
          reject(new Error('audio-error'));
        };
        Promise.resolve(audio.play()).catch(reject);
        // Some test doubles and older WebViews do not emit onplaying.
        if (!started && audio.paused === false) audio.onplaying?.();
      } catch (error) {
        activeAudio = null;
        reject(error);
      }
    });
  }

  async function run(text, options, currentGeneration) {
    try {
      if (!await speakPart(text, { type: 'word', index: 0, text }, currentGeneration, { rate: 0.92 })) return;
      if (options.spell !== false) {
        const letters = text.match(/[A-Za-z]/g) || [];
        for (let index = 0; index < letters.length; index += 1) {
          if (!active || currentGeneration !== generation) return;
          const letter = letters[index];
          const completed = letter.toLocaleLowerCase('en-US') === 'a'
            ? await playRecordedA(currentGeneration, index)
            : await speakPart(alphabetSpeechText(letter), { type: 'letter', index, text: letter }, currentGeneration);
          if (!completed) return;
        }
      }

      const ranges = segmentRanges(text, guideSegments(options.guide));
      let highlightedSegment = -1;
      const highlightSegment = index => {
        if (index < 0 || index >= ranges.length || index === highlightedSegment) return;
        highlightedSegment = index;
        onHighlight({ type: 'segment', index, text: ranges[index].text });
      };
      const completed = await speakPart(text, { type: 'word', index: 0, text }, currentGeneration, {
        rate: 0.92,
        onBoundary(event) {
          const charIndex = Number(event?.charIndex);
          if (!Number.isFinite(charIndex)) return;
          const index = ranges.findIndex(range => charIndex >= range.start && charIndex < range.end);
          highlightSegment(index);
        }
      });
      if (!completed || !active || currentGeneration !== generation) return;
      if (ranges.length && highlightedSegment < 0) highlightSegment(0);
      active = false;
      activeUtterance = null;
      onStatus({ type: 'ready', message: '단어와 전체 철자를 모두 읽었어요.' });
    } catch {
      fail(currentGeneration, '기기 영어 음성으로 단어와 철자를 읽을 수 없어요. 다시 시도해 주세요.');
    }
  }

  function start(text, options = {}) {
    const value = String(text ?? '').normalize('NFKC').trim();
    stop({ silent: true });
    if (!engine || !Utterance) {
      onStatus({ type: 'error', message: '이 기기에서는 영어 읽어주기를 지원하지 않아요.' });
      return false;
    }
    if (!/[A-Za-z]/.test(value)) {
      onStatus({ type: 'error', message: '읽을 영어 단어가 없어요.' });
      return false;
    }
    active = true;
    const currentGeneration = generation;
    onStatus({ type: 'info', message: '단어, 철자, 전체 발음 순서로 읽고 있어요.' });
    run(value, options, currentGeneration);
    return true;
  }

  return { start, stop: () => stop(), isActive: () => active };
}
