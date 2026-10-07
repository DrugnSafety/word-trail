import test from 'node:test';
import assert from 'node:assert/strict';
import {
  VOICE_PREFERENCE_KEY,
  listEnglishVoices,
  getVoicePreference,
  setVoicePreference,
  resolveVoice,
  configureUtterance,
  alphabetSpeechText
} from '../public/lib/voice-settings.js';

function voice(name, lang, extras = {}) {
  return { name, lang, voiceURI: extras.voiceURI || name, ...extras };
}

test('alphabet speech uses stable letter names without case announcements', () => {
  assert.equal(
    alphabetSpeechText('ABCDEFGHIJKLMNOPQRSTUVWXYZ'),
    'ay, bee, see, dee, ee, eff, gee, aitch, eye, jay, kay, el, em, en, oh, pee, cue, ar, ess, tee, you, vee, double you, ex, why, zee'
  );
  assert.equal(alphabetSpeechText('a-B! z'), 'ay, bee, zee');
  assert.equal(alphabetSpeechText('한글 123'), '');
});

test('English voice list removes duplicates, non-English voices and novelty voices', () => {
  const samantha = voice('Samantha', 'en-US', { default: true });
  const engine = { getVoices: () => [
    voice('Zarvox', 'en-US'),
    voice('Thomas', 'fr-FR'),
    voice('Sonia Natural', 'en-GB'),
    samantha,
    samantha
  ] };
  assert.deepEqual(listEnglishVoices(engine).map(item => item.name), ['Samantha', 'Sonia Natural']);
});

test('voice list can be called again after delayed voiceschanged population', () => {
  let available = [];
  const engine = { getVoices: () => available };
  assert.deepEqual(listEnglishVoices(engine), []);
  available = [voice('Ava Premium', 'en-US')];
  assert.deepEqual(listEnglishVoices(engine).map(item => item.name), ['Ava Premium']);
});

test('voice preference storage is persistent, clearable and failure-safe', () => {
  const values = new Map();
  const storage = {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: key => values.delete(key)
  };
  assert.equal(getVoicePreference(storage), null);
  assert.equal(setVoicePreference('ava-uri', storage), true);
  assert.equal(values.get(VOICE_PREFERENCE_KEY), 'ava-uri');
  assert.equal(getVoicePreference(storage), 'ava-uri');
  assert.equal(setVoicePreference('', storage), true);
  assert.equal(getVoicePreference(storage), null);

  const broken = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } };
  assert.equal(getVoicePreference(broken), null);
  assert.equal(setVoicePreference('voice', broken), false);
});

test('voice resolution honors selection and otherwise prefers an ordinary natural English voice', () => {
  const voices = [
    voice('Zarvox', 'en-US', { default: true }),
    voice('Daniel', 'en-GB'),
    voice('Ava Premium', 'en-US')
  ];
  assert.equal(resolveVoice(voices, 'Daniel').name, 'Daniel');
  assert.equal(resolveVoice(voices, 'missing').name, 'Ava Premium');
  assert.equal(resolveVoice([voice('Amelie', 'fr-FR')]), null);
});

test('utterance configuration applies selected voice locale and stable speech controls', () => {
  const selected = voice('Sonia Natural', 'en-GB', { voiceURI: 'sonia-uri' });
  const utterance = {};
  assert.equal(configureUtterance(utterance, {
    voices: [voice('Samantha', 'en-US'), selected],
    preference: 'sonia-uri',
    rate: 0.8,
    volume: 0.7
  }), utterance);
  assert.equal(utterance.voice, selected);
  assert.equal(utterance.lang, 'en-GB');
  assert.equal(utterance.rate, 0.8);
  assert.equal(utterance.pitch, 1);
  assert.equal(utterance.volume, 0.7);
});

test('default voice playback uses the natural rate and pitch', () => {
  const utterance = configureUtterance({}, { voices: [voice('Samantha', 'en-US')] });
  assert.equal(utterance.rate, 1);
  assert.equal(utterance.pitch, 1);
  assert.equal(utterance.volume, 1);
});
