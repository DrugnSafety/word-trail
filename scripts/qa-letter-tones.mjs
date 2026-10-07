// Real Web Audio and recorded A; deterministic speech avoids device voice timing.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || '/Users/mingyukang/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs');
const base = process.env.QA_URL || 'http://localhost:4177';
const out = new URL('../tmp/qa-letter-tones/', import.meta.url).pathname;
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true, executablePath: process.env.QA_CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
const checks = [], errors = [];
const context = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
await context.addInitScript(() => {
  window.__tones = []; window.__letters = [];
  const NativeContext = window.AudioContext;
  const create = NativeContext.prototype.createOscillator;
  NativeContext.prototype.createOscillator = function () {
    const oscillator = create.call(this), event = { state: this.state };
    const start = oscillator.start.bind(oscillator), stop = oscillator.stop.bind(oscillator);
    oscillator.start = at => { event.hz = oscillator.frequency.value; window.__tones.push(event); start(at); };
    oscillator.stop = at => { event.stops = (event.stops || 0) + 1; stop(at); };
    oscillator.addEventListener('ended', () => { event.hz = oscillator.frequency.value; event.ended = true; });
    return oscillator;
  };
  let timers = [];
  Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: {
    getVoices: () => [{ lang: 'en-US', name: 'QA Natural', voiceURI: 'qa-natural', default: true }],
    cancel() { timers.forEach(clearTimeout); timers = []; }, resume() {},
    speak(utterance) { window.__letters.push(utterance.text); utterance.onstart?.(); timers.push(setTimeout(() => utterance.onend?.(), 20)); }
  } });
  window.SpeechSynthesisUtterance = class { constructor(text) { this.text = text; } };
});
const page = await context.newPage();
page.on('pageerror', error => errors.push(error.message));
page.on('console', event => { if (event.type() === 'error' && !/favicon\.ico/.test(event.location().url)) errors.push(`${event.location().url}: ${event.text()}`); });
const pass = name => { checks.push(name); console.log(`PASS ${name}`); };
const openSettings = async () => { await page.getByRole('button', { name: '음성 설정', exact: true }).click(); };
const sample = () => page.getByRole('button', { name: 'A·B·C 기억 소리 듣기', exact: true });
try {
  await page.goto(base); await openSettings();
  assert.equal(await page.locator('#letter-tones-enabled').isChecked(), true);
  pass('memory tones start enabled in a fresh browser');
  await sample().click();
  await page.waitForFunction(() => window.__tones.length === 3 && window.__tones.every(item => item.ended));
  const first = await page.evaluate(() => window.__tones.map(item => item.hz));
  assert.equal(new Set(first).size, 3);
  assert.equal(await page.evaluate(() => window.__tones.every(item => item.state === 'running')), true);
  assert.deepEqual(await page.evaluate(() => window.__letters), ['bee', 'see']);
  pass('native Web Audio runs three different notes; recorded A and spoken B/C remain serialized');
  await sample().click();
  await page.waitForFunction(() => window.__tones.length === 6 && window.__tones.every(item => item.ended));
  assert.deepEqual(await page.evaluate(() => window.__tones.slice(3).map(item => item.hz)), first);
  pass('repeated A/B/C uses exactly the same notes');
  await page.locator('#letter-tones-enabled').uncheck();
  await sample().click();
  await page.waitForFunction(() => window.__letters.length === 6);
  assert.equal(await page.evaluate(() => window.__tones.length), 6);
  pass('opting out preserves alphabet speech and produces no new tones');
  await page.reload(); await openSettings();
  assert.equal(await page.locator('#letter-tones-enabled').isChecked(), false);
  pass('tone preference survives reload');
  await page.locator('#letter-tones-enabled').check();
  await sample().click();
  await page.getByRole('button', { name: '음성 설정 닫기', exact: true }).click();
  await page.waitForTimeout(1400);
  assert.equal(await page.evaluate(() => window.__tones.length), 1);
  assert.deepEqual(await page.evaluate(() => window.__letters), []);
  pass('closing settings stops recorded A, tones and pending B/C');
  await openSettings(); await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.locator('#settings-dialog').screenshot({ path: `${out}settings-mobile.png` });
  pass('settings fit a 390px viewport');
  await page.setViewportSize({ width: 1280, height: 1000 });
  await page.locator('#settings-dialog').screenshot({ path: `${out}settings-desktop.png` });
  assert.deepEqual(errors, []); pass('browser JavaScript and console errors: 0');
  await writeFile(`${out}results.json`, JSON.stringify({ date: new Date().toISOString(), base, checks, first, errors,
    evidence: 'Native Web Audio nodes ran and ended in headless Chrome; A used the real local MP3. Speech was mocked. This does not evaluate speaker output, memorization benefits, or iPad Safari.' }, null, 2));
} finally { await browser.close(); }
