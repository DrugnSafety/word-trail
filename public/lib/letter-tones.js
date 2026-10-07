const PREFERENCE_KEY = 'wordtrail:letter-tones:v1';

function defaultStorage() {
  try { return globalThis.window?.localStorage; } catch { return null; }
}

export function letterTonesEnabled(storage = defaultStorage()) {
  try { return storage?.getItem(PREFERENCE_KEY) !== 'off'; } catch { return true; }
}

export function setLetterTonesEnabled(enabled, storage = defaultStorage()) {
  try {
    if (!storage) return false;
    storage.setItem(PREFERENCE_KEY, enabled ? 'on' : 'off');
    return true;
  } catch { return false; }
}

export function letterToneFrequency(letter) {
  const value = String(letter || '').toLowerCase();
  if (!/^[a-z]$/.test(value)) return null;
  // 26 distinct, stable notes from middle C upwards in semitone steps.
  return 261.625565 * 2 ** ((value.charCodeAt(0) - 97) / 12);
}

export function createLetterTonePlayer({
  AudioContext = globalThis.AudioContext || globalThis.webkitAudioContext,
  enabled = letterTonesEnabled
} = {}) {
  let context;
  let generation = 0;
  let unlocking;
  const active = new Set();

  function unlock() {
    if (!AudioContext || !enabled()) return null;
    try {
      if (!context || context.state === 'closed') context = new AudioContext();
      if (context.state === 'running') return Promise.resolve(true);
      if (!unlocking) {
        unlocking = Promise.resolve(context.resume()).then(() => context.state === 'running', () => false)
          .finally(() => { unlocking = null; });
      }
      return unlocking;
    } catch { return null; }
  }

  function play(letter) {
    const frequency = letterToneFrequency(letter);
    if (!frequency || !enabled()) return;
    const ready = unlock();
    if (!ready) return;
    const expectedGeneration = generation;
    const start = () => {
      if (expectedGeneration !== generation || !enabled() || context?.state !== 'running') return;
      let oscillator, gain, item;
      const disconnect = () => {
        if (item) active.delete(item);
        try { oscillator?.disconnect(); } catch {}
        try { gain?.disconnect(); } catch {}
      };
      try {
        oscillator = context.createOscillator();
        gain = context.createGain();
        item = { oscillator, disconnect };
        oscillator.type = 'sine';
        oscillator.frequency.setValueAtTime(frequency, context.currentTime);
        const at = context.currentTime;
        gain.gain.setValueAtTime(0, at);
        gain.gain.linearRampToValueAtTime(0.06, at + 0.008);
        gain.gain.linearRampToValueAtTime(0, at + 0.085);
        oscillator.connect(gain); gain.connect(context.destination);
        oscillator.onended = disconnect;
        active.add(item);
        oscillator.start(at);
        oscillator.stop(at + 0.09);
      } catch {
        try { oscillator?.stop(); } catch {}
        disconnect();
      }
    };
    if (context.state === 'running') start();
    else ready.then(readyToPlay => { if (readyToPlay) start(); });
  }

  function stop() {
    generation++;
    for (const item of active) {
      item.oscillator.onended = null;
      try { item.oscillator.stop(); } catch {}
      item.disconnect();
    }
  }

  return { unlock, play, stop };
}
