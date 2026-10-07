export const VOICE_PREFERENCE_KEY = 'wordTrail.englishVoice';

const NOVELTY_VOICE = /\b(?:albert|bad news|bahh|bells|boing|bubbles|cellos|deranged|fred|good news|hysterical|junior|organ|pipe organ|princess|ralph|superstar|trinoids|whisper|zarvox)\b/i;
const NATURAL_VOICE = /\b(?:ava|aria|emma|guy|jenny|natural|neural|premium|samantha|siri|sonia)\b/i;
const LETTER_SPEECH_NAMES = Object.freeze({
  a: 'ay', b: 'bee', c: 'see', d: 'dee', e: 'ee', f: 'eff', g: 'gee',
  h: 'aitch', i: 'eye', j: 'jay', k: 'kay', l: 'el', m: 'em', n: 'en',
  o: 'oh', p: 'pee', q: 'cue', r: 'ar', s: 'ess', t: 'tee', u: 'you',
  v: 'vee', w: 'double you', x: 'ex', y: 'why', z: 'zee'
});

export function alphabetSpeechText(text) {
  return (String(text ?? '').match(/[A-Za-z]/g) ?? [])
    .map(letter => LETTER_SPEECH_NAMES[letter.toLowerCase()])
    .join(', ');
}

function defaultStorage() {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

function voiceId(voice) {
  return String(voice?.voiceURI || voice?.name || '').trim();
}

function isEnglishVoice(voice) {
  return /^en(?:[-_]|$)/i.test(String(voice?.lang || ''));
}

function voiceScore(voice) {
  const description = `${voice?.name || ''} ${voice?.voiceURI || ''}`;
  let score = 0;
  if (voice?.default) score += 100;
  if (/^en-US$/i.test(voice?.lang || '')) score += 30;
  if (NATURAL_VOICE.test(description)) score += 25;
  if (/\b(?:google|microsoft|apple)\b/i.test(description)) score += 10;
  if (voice?.localService) score += 5;
  if (NOVELTY_VOICE.test(description)) score -= 1000;
  return score;
}

function sortedEnglishVoices(voices) {
  const unique = new Map();
  for (const voice of Array.from(voices || [])) {
    if (!isEnglishVoice(voice)) continue;
    const id = voiceId(voice);
    if (id && !unique.has(id)) unique.set(id, voice);
  }
  return [...unique.values()].sort((left, right) =>
    voiceScore(right) - voiceScore(left)
    || String(left.name || '').localeCompare(String(right.name || ''), 'en')
  );
}

export function listEnglishVoices(engine = globalThis.speechSynthesis) {
  let voices = [];
  try {
    voices = typeof engine?.getVoices === 'function' ? engine.getVoices() : [];
  } catch {
    return [];
  }
  const english = sortedEnglishVoices(voices);
  const ordinary = english.filter(voice => !NOVELTY_VOICE.test(`${voice.name || ''} ${voice.voiceURI || ''}`));
  return ordinary.length ? ordinary : english;
}

export function getVoicePreference(storage = defaultStorage()) {
  try {
    return String(storage?.getItem?.(VOICE_PREFERENCE_KEY) || '').trim() || null;
  } catch {
    return null;
  }
}

export function setVoicePreference(preference, storage = defaultStorage()) {
  const value = String(preference || '').trim();
  try {
    if (!storage) return false;
    if (value) storage.setItem(VOICE_PREFERENCE_KEY, value);
    else storage.removeItem(VOICE_PREFERENCE_KEY);
    return true;
  } catch {
    return false;
  }
}

export function resolveVoice(voices = listEnglishVoices(), preference = getVoicePreference()) {
  const english = sortedEnglishVoices(voices);
  if (!english.length) return null;
  const selected = String(preference || '').trim();
  if (selected) {
    const match = english.find(voice => voiceId(voice) === selected || voice.name === selected);
    if (match) return match;
  }
  const ordinary = english.filter(voice => !NOVELTY_VOICE.test(`${voice.name || ''} ${voice.voiceURI || ''}`));
  return ordinary[0] || english[0];
}

export function configureUtterance(utterance, options = {}) {
  if (!utterance) return utterance;
  const voices = options.voices ?? listEnglishVoices(options.engine);
  const preference = options.preference === undefined ? getVoicePreference(options.storage) : options.preference;
  const voice = resolveVoice(voices, preference);
  utterance.voice = voice;
  utterance.lang = voice?.lang || options.lang || 'en-US';
  utterance.rate = Number.isFinite(options.rate) ? options.rate : 1;
  utterance.pitch = Number.isFinite(options.pitch) ? options.pitch : 1;
  utterance.volume = Number.isFinite(options.volume) ? options.volume : 1;
  return utterance;
}
