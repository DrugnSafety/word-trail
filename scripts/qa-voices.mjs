// Optional real-device speech smoke check using an existing Playwright install.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { alphabetSpeechText } from '../public/lib/voice-settings.js';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.QA_URL || 'http://localhost:4174';
const out = new URL('../tmp/qa-voices/', import.meta.url);
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true, ...(process.env.QA_CHROME ? { executablePath: process.env.QA_CHROME } : {}) });
try {
  const context = await browser.newContext();
  await context.addInitScript(() => {
    window.__voiceEvents = [];
    const engine = window.speechSynthesis;
    if (!engine) return;
    const original = engine.speak.bind(engine);
    engine.speak = utterance => {
      const event = { text: utterance.text, voice: utterance.voice?.name, lang: utterance.lang, rate: utterance.rate, started: false, ended: false };
      window.__voiceEvents.push(event);
      const start = utterance.onstart, end = utterance.onend, error = utterance.onerror;
      utterance.onstart = e => { event.started = true; start?.call(utterance, e); };
      utterance.onend = e => { event.ended = true; end?.call(utterance, e); };
      utterance.onerror = e => { event.error = e.error; error?.call(utterance, e); };
      original(utterance);
    };
  });
  const page = await context.newPage();
  await page.goto(base);
  await page.getByRole('button', { name: '음성 설정', exact: true }).click();
  await page.locator('.voice-option').first().waitFor();
  const voices = await page.locator('#voice-select option').allTextContents();
  await page.locator('.voice-option').first().getByRole('button', { name: '단어 샘플 듣기' }).click();
  await page.waitForFunction(() => window.__voiceEvents[0]?.ended || window.__voiceEvents[0]?.error, null, { timeout: 20000 });
  await page.locator('.voice-option').first().getByRole('button', { name: '알파벳 샘플 듣기' }).click();
  await page.waitForFunction(() => window.__voiceEvents[1]?.ended || window.__voiceEvents[1]?.error, null, { timeout: 20000 });
  await page.evaluate(async () => {
    const { createLetterSpeaker, createSpeechLoop, speak } = await import('/lib/learning.js');
    const input = document.createElement('input'); input.id = 'letter-speech-probe';
    const speaker = createLetterSpeaker();
    input.addEventListener('input', event => speaker.enqueue(event.data || ''));
    document.querySelector('#settings-dialog').append(input);
    const loop = createSpeechLoop();
    const word = document.createElement('button'); word.id = 'word-speech-probe'; word.textContent = '단어 재생 검사';
    word.onclick = () => { loop.stop(); speaker.cancel(); speak('Please come with me.'); };
    document.querySelector('#settings-dialog').append(word);
    speechSynthesis.pause();
  });
  await page.locator('#letter-speech-probe').pressSequentially('abcmwz', { delay: 800 });
  let letterTimeout = false;
  try { await page.waitForFunction(() => window.__voiceEvents.length === 8 && window.__voiceEvents.every(event => event.ended || event.error), null, { timeout: 20000 }); }
  catch { letterTimeout = true; }
  await page.evaluate(() => speechSynthesis.pause());
  await page.locator('#word-speech-probe').click();
  await page.locator('#word-speech-probe').click();
  await page.locator('#word-speech-probe').click();
  let wordTimeout = false;
  try { await page.waitForFunction(() => window.__voiceEvents.length === 11 && window.__voiceEvents[10].ended, null, { timeout: 20000 }); }
  catch { wordTimeout = true; }
  const events = await page.evaluate(() => window.__voiceEvents);
  await page.locator('#letter-speech-probe').evaluate(input => input.remove());
  await page.locator('#word-speech-probe').evaluate(button => button.remove());
  await writeFile(new URL('results.json', out), JSON.stringify({ date: new Date().toISOString(), voices, events, letterTimeout, wordTimeout, limitation: 'Real browser speech start/end events; speaker output and pronunciation quality require listening.' }, null, 2));
  await page.locator('#settings-dialog').screenshot({ path: new URL('settings.png', out).pathname });
  assert.ok(events.slice(0, 8).every(event => event.started && event.ended && !event.error), JSON.stringify(events));
  assert.equal(letterTimeout, false, JSON.stringify(events));
  assert.equal(wordTimeout, false, JSON.stringify(events));
  assert.equal(events[1].text, alphabetSpeechText('abcmwz'));
  assert.deepEqual(events.slice(2, 8).map(event => event.text), ['a', 'b', 'c', 'm', 'w', 'z'].map(alphabetSpeechText));
  assert.ok(events.slice(1, 8).every(event => !/\b(?:capital|letter)\b/i.test(event.text)));
  assert.ok(events.every(event => event.voice === events[0].voice));
  assert.ok(events.every(event => event.rate === 1));
  assert.ok(events[10].started && events[10].ended && !events[10].error);
  console.log(`Real speech samples completed: ${events.length}; selected voice: ${events[0].voice}; English voices: ${voices.length - 1}`);
} finally {
  await browser.close();
}
