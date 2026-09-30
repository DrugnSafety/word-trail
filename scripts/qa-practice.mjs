// Optional browser QA. Uses an existing Playwright installation; no app dependency.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { commitSelection, makePhraseCandidate } from '../public/lib/vocabulary.js';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.QA_URL || 'http://localhost:4174';
const out = new URL('../tmp/qa-short-dialogue-audio/', import.meta.url).pathname;
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true, ...(process.env.QA_CHROME ? { executablePath: process.env.QA_CHROME } : {}) });
const context = await browser.newContext({ viewport: { width: 1440, height: 1050 }, reducedMotion: 'reduce' });
const page = await context.newPage();
const errors = [];
page.on('pageerror', error => errors.push(error.message));
const checks = [];
function passed(name) { checks.push(name); console.log(`PASS ${name}`); }
await page.addInitScript(() => {
  window.__speech = []; window.__player = { playing: false, pauses: 0 }; window.__sentence = null;
  let timers = [];
  Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: {
    getVoices: () => [{ lang: 'en-US', name: 'QA voice' }],
    cancel: () => { timers.forEach(clearTimeout); timers = []; },
    speak: utterance => {
      window.__speech.push(utterance.text);
      utterance.onstart?.(); timers.push(setTimeout(() => utterance.onend?.(), 40));
    }
  } });
  window.SpeechSynthesisUtterance = class { constructor(text) { this.text = text; } };
  window.YT = { Player: class {
    constructor(element, options) {
      this.events = options.events; this.time = 26;
      this.probe = element.parentElement?.classList.contains('sentence-player') ? (window.__sentence = { playing: false, pauses: 0, starts: 0 }) : window.__player;
      setTimeout(() => this.events.onReady(), 30);
    }
    cueVideoById(config) { this.time = config.startSeconds; this.events.onStateChange({ data: 5 }); }
    loadVideoById(config) { this.probe.range = config; this.probe.starts++; this.time = config.startSeconds; this.playVideo(); }
    getCurrentTime() { return this.time; }
    getAvailablePlaybackRates() { return [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2]; }
    setPlaybackRate(rate) { this.events.onPlaybackRateChange?.({ data: rate }); }
    seekTo(time) { this.time = time; }
    playVideo() { this.probe.playing = true; this.events.onStateChange({ data: 1 }); }
    pauseVideo() { this.probe.playing = false; this.probe.pauses++; this.events.onStateChange({ data: 2 }); }
    destroy() { this.probe.playing = false; }
  } };
});
const mode = () => page.locator('.view:visible .workspace-modes button[aria-pressed="true"]').getAttribute('data-mode');
async function expectMode(value) { await page.waitForFunction(v => [...document.querySelectorAll(`.workspace-modes button[data-mode="${v}"][aria-pressed="true"]`)].some(node => node.getClientRects().length), value); }
async function chooseMode(value) { await page.locator(`.view:visible [data-mode="${value}"]`).click(); await expectMode(value); }
async function submit(answer) { await page.locator('.view:visible .answer-form input').fill(answer); await page.locator('.view:visible .answer-form button').click(); }
async function acknowledge() { await page.locator('.view:visible .practice-step-actions button').click(); }
async function record() { return page.evaluate(() => JSON.parse(localStorage.getItem('wordtrail:guest:v1')).dictations[0]); }
try {
  await page.goto(base); await page.locator('#video-search').fill('Faceytalk'); await page.locator('.video-card').first().click();
  await page.locator('#load-play-button').click();
  await page.waitForFunction(() => window.__player.playing);
  assert.equal(await page.locator('#rate-select option').count(), 8);
  await page.locator('#rate-select').selectOption('0.5');
  assert.equal(await page.locator('#rate-select').inputValue(), '0.5');
  passed('explicit play starts media; eight playback speeds and applied rate');
  await page.locator('[data-stage="dictation"]').click();
  const video = await (await page.request.get(`${base}/data/videos/video-01.json`)).json();
  assert.deepEqual(video.scenes.slice(0, 4).map(scene => scene.start), [26, 33, 37, 41]);
  assert.ok(video.scenes.filter(scene => scene.selectable).every(scene => scene.end - scene.start <= 15));
  assert.equal(await page.locator('.chapter-section').count(), video.chapters.length);
  await page.locator('#dictation-answer').fill(video.scenes[0].sentenceText);
  await page.getByRole('button', { name: '받아쓰기 확인', exact: true }).click();
  await page.getByRole('button', { name: '문장의 단어를 모두 맞혔어요', exact: true }).count();
  await page.locator('#word-selection h3').waitFor();
  await page.waitForFunction(() => document.activeElement?.matches('#word-selection h3'));
  assert.equal(await page.locator('.phrase-builder').count(), 0);
  const selectionBounds = await page.locator('#word-selection h3').boundingBox();
  assert.ok(selectionBounds.y >= 0 && selectionBounds.y < 1050);
  passed('paragraph chapter navigation; submitted dictation scrolls to word selection; manual grouping removed');
  await page.locator('.select-word').filter({ hasText: /^Mum$/ }).first().click();
  await page.locator('.select-word').filter({ hasText: /^Please$/ }).click();
  await page.locator('#next-action').click(); await expectMode('explain');
  assert.equal(await page.evaluate(() => window.__player.playing), false);
  assert.equal(await page.locator('.word-queue button').count(), 2);
  passed('workspace pauses video; two-item queue and meaning-first flow');
  await page.screenshot({ path: `${out}01-meaning-desktop.png`, fullPage: true });
  for (const [index, term] of ['Mum', 'Please'].entries()) {
    await expectMode('explain');
    assert.equal(await page.locator('.view:visible .workspace-word-title').innerText(), term);
    assert.ok(await page.locator('.word-family .family-item').count());
    await acknowledge(); await expectMode('point');
    await page.getByRole('button', { name: '단어·표현 듣기', exact: true }).click();
    await acknowledge(); await expectMode('spelling');
    if (index === 0) {
      await page.locator('.view:visible .answer-form input').pressSequentially('mum', { delay: 60 });
      assert.equal(await page.locator('.letter-indicator').innerText(), 'm');
      assert.equal(await page.locator('.typed-word').innerText(), 'mum');
      assert.ok((await page.evaluate(() => window.__speech)).includes('em'));
      assert.ok(!(await page.evaluate(() => window.__speech)).some(text => /^(letter|capital) /i.test(text)));
      await submit('incorrect'); await page.waitForTimeout(1300); assert.equal(await mode(), 'spelling');
      await page.getByRole('button', { name: '다시 해보기', exact: true }).click();
      passed('isolated letter names, typed word, wrong answer stays and retry works');
    }
    await submit(term); await expectMode('cloze');
    assert.equal(await page.locator('.view:visible .word-queue').innerText().then(text => text.includes(term)), false);
    assert.equal(await page.locator('.cloze-sentence').innerText().then(text => text.includes(term)), false);
    await page.waitForFunction(() => window.__sentence?.playing);
    assert.deepEqual(await page.evaluate(() => window.__sentence.range), { videoId: 'kx8_wF9HOX8', startSeconds: video.scenes[0].start, endSeconds: video.scenes[0].end });
    assert.equal(await page.locator('.view:visible .sentence-player').isVisible(), true);
    const before = await page.evaluate(() => window.__speech.length);
    await page.waitForTimeout(1750); assert.equal(await page.evaluate(() => window.__speech.length), before);
    await page.getByRole('button', { name: '문장 반복 멈추기', exact: true }).click();
    assert.equal(await page.evaluate(() => window.__sentence.playing), false);
    await page.getByRole('button', { name: '문장 처음부터 듣기', exact: true }).click();
    assert.equal(await page.evaluate(() => window.__sentence.playing), true);
    await submit(term); await expectMode('audio');
    assert.equal(await page.evaluate(() => window.__sentence.playing), false);
    await page.screenshot({ path: `${out}02-audio-quiz.png`, fullPage: true });
    const audioBefore = await page.evaluate(() => window.__speech.length);
    await page.waitForTimeout(1750); assert.ok(await page.evaluate(() => window.__speech.length) > audioBefore);
    await page.getByRole('button', { name: '소리 반복 멈추기', exact: true }).click();
    const stopped = await page.evaluate(() => window.__speech.length);
    await page.waitForTimeout(1750); assert.equal(await page.evaluate(() => window.__speech.length), stopped);
    await submit(term); await expectMode('meaning');
    assert.ok(!(await page.locator('.view:visible .workspace-word-title').innerText()).includes(term));
    await submit(term); await expectMode('reading');
    assert.ok((await page.locator('.pronunciation').innerText()).startsWith('/'));
    if (index === 0) {
      await page.getByRole('button', { name: '도움이 필요해요', exact: true }).click();
      await page.waitForTimeout(1300); assert.equal(await mode(), 'reading');
    }
    await page.getByRole('button', { name: '혼자 읽었어요', exact: true }).click();
    if (index === 0) await expectMode('explain');
    else await page.locator('.practice-complete').waitFor();
    passed(`${term}: all seven modes, speech repeats/stops, saved success auto-advances`);
  }
  let saved = await record();
  assert.equal(saved.words.filter(word => word.registeredAt).length, 2);
  assert.ok(saved.words.filter(word => word.registeredAt).every(word => word.practice.reading.correct === 1 && word.review.dueAt));
  passed('two items end in summary and reading review records persist');
  await page.getByRole('button', { name: '완료 단어 보기', exact: true }).click();
  assert.equal(await page.locator('#word-list .mistake-button').count(), 2);
  await page.reload();
  await page.locator('[data-word-filter="completed"]').click();
  assert.equal(await page.locator('#word-list .mistake-button').count(), 2);
  await page.locator('[data-word-filter="learning"]').click();
  assert.equal(await page.locator('#word-list .mistake-button').count(), 0);
  await page.locator('[data-word-filter="completed"]').click();
  await page.locator('.mistake-button').filter({ hasText: 'Mum' }).click();
  passed('completed words have a separate persistent list after refresh');
  await page.locator('.view:visible .return-video').click();
  assert.equal(await page.locator('[data-stage="listen"]').getAttribute('aria-current'), 'step');
  assert.equal(await page.evaluate(() => window.__player.playing), false);
  await page.locator('[data-stage="dictation"]').click();
  assert.equal(await page.locator('#dictation-answer').inputValue(), video.scenes[0].sentenceText);
  await page.locator('#next-action').click(); await expectMode('explain');
  await chooseMode('spelling');
  await page.locator('.auto-advance input').uncheck();
  await submit('Mum'); await page.waitForTimeout(1300); assert.equal(await mode(), 'spelling');
  await acknowledge(); await expectMode('cloze');
  await page.locator('.auto-advance input').check();
  await submit('Mum'); await chooseMode('point'); await page.waitForTimeout(1300); assert.equal(await mode(), 'point');
  passed('return to video preserves dictation; auto pause and stale navigation cancellation');
  await chooseMode('audio');
  await page.locator('.view:visible .return-video').click(); const leaving = await page.evaluate(() => window.__speech.length);
  await page.waitForTimeout(1750); assert.equal(await page.evaluate(() => window.__speech.length), leaving);
  passed('leaving word workspace cancels all repeated speech');
  await page.locator('[data-stage="dictation"]').click();
  assert.equal(await page.locator('.phrase-builder').count(), 0);
  // Existing custom expressions remain usable even though their creation UI was removed.
  const previousRecord = await record();
  const savedPhrase = makePhraseCandidate(previousRecord.reference, 1, 3);
  const withPhrase = commitSelection(previousRecord, [...previousRecord.selectedKeys, savedPhrase.key], new Date(), [savedPhrase]);
  await page.evaluate(value => {
    const data = JSON.parse(localStorage.getItem('wordtrail:guest:v1'));
    data.dictations[0] = value; localStorage.setItem('wordtrail:guest:v1', JSON.stringify(data));
  }, withPhrase);
  await page.reload(); await page.locator('[data-stage="dictation"]').click();
  await page.locator('#next-action').click(); await expectMode('explain');
  await page.locator('.word-queue button').filter({ hasText: 'can we do' }).click();
  await chooseMode('cloze'); assert.equal(await page.locator('.cloze-blank').count(), 1);
  assert.ok(!(await page.locator('.cloze-sentence').innerText()).includes('can we do'));
  await page.locator('.auto-advance input').uncheck();
  await submit('can we do');
  saved = await record(); const phrase = saved.words.find(word => word.term === 'can we do');
  assert.deepEqual(phrase.sourceIndexes, [1, 2, 3]); assert.equal(phrase.practice.cloze.correct, 1);
  const downloadPromise = page.waitForEvent('download'); await page.locator('#download-workbook').click();
  const download = await downloadPromise; await download.saveAs(`${out}phrase-workbook.html`);
  passed('previously saved phrase remains one blank, graded/stored as one item, workbook downloads');
  await page.reload(); await page.locator('[data-stage="dictation"]').click();
  assert.ok(await page.locator('.phrase-option[aria-pressed="true"]').filter({ hasText: 'can we do' }).count());
  await page.locator('#next-action').click(); await expectMode('explain');
  passed('phrase and selection restore after refresh');
  await chooseMode('spelling');
  await page.evaluate(() => {
    window.__originalSet = Storage.prototype.setItem;
    Storage.prototype.setItem = function(key, value) { if (key === 'wordtrail:guest:v1') throw new Error('QA storage unavailable'); return window.__originalSet.call(this, key, value); };
  });
  await submit('Mum');
  await page.locator('.answer-feedback').filter({ hasText: '저장하지 못했어요' }).waitFor();
  await page.waitForTimeout(1250); assert.equal(await mode(), 'spelling');
  assert.equal(await page.locator('.view:visible .answer-form input').isEnabled(), true);
  for (const failedMode of ['cloze', 'audio']) {
    await chooseMode(failedMode);
    const repeat = page.locator('.view:visible .repeat-audio button[aria-pressed]');
    const prefix = failedMode === 'cloze' ? '문장' : '소리';
    assert.equal(await repeat.getAttribute('aria-pressed'), 'true');
    await submit('Mum');
    await page.locator('.view:visible .answer-feedback').filter({ hasText: '저장하지 못했어요' }).waitFor();
    assert.equal(await repeat.innerText(), `${prefix} 반복 시작`);
    assert.equal(await repeat.getAttribute('aria-pressed'), 'false');
    const stoppedCount = await page.evaluate(() => window.__speech.length);
    await page.waitForTimeout(1750);
    assert.equal(await mode(), failedMode);
    assert.equal(await page.evaluate(() => window.__speech.length), stoppedCount);
    assert.equal(await page.locator('.view:visible .answer-form input').isEnabled(), true);
    await repeat.click();
    assert.equal(await repeat.innerText(), `${prefix} 반복 멈추기`);
    assert.equal(await repeat.getAttribute('aria-pressed'), 'true');
    if (failedMode === 'cloze') assert.equal(await page.evaluate(() => window.__sentence.playing), true);
    else assert.ok(await page.evaluate(() => window.__speech.length) > stoppedCount);
    await repeat.click();
    assert.equal(await repeat.getAttribute('aria-pressed'), 'false');
  }
  await page.evaluate(() => { Storage.prototype.setItem = window.__originalSet; });
  passed('spelling/cloze/audio storage failure restores input and synchronizes repeat controls');
  await chooseMode('spelling');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.locator('.view:visible .answer-form input').fill('');
  await page.locator('.view:visible .answer-form input').pressSequentially('M');
  assert.ok(await page.locator('.letter-indicator').evaluate(el => el.getAnimations().length > 0));
  await page.emulateMedia({ reducedMotion: 'reduce' }); await page.waitForTimeout(350);
  await page.locator('.view:visible .answer-form input').pressSequentially('u');
  assert.equal(await page.locator('.letter-indicator').evaluate(el => el.getAnimations().length), 0);
  passed('typed letter/word pop animation respects reduced-motion');
  await chooseMode('audio');
  await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, value: true }); document.dispatchEvent(new Event('visibilitychange')); });
  const hiddenCount = await page.evaluate(() => window.__speech.length);
  await page.waitForTimeout(1750); assert.equal(await page.evaluate(() => window.__speech.length), hiddenCount);
  await page.evaluate(() => { delete document.hidden; document.dispatchEvent(new Event('visibilitychange')); });
  await page.waitForTimeout(1750); assert.equal(await page.evaluate(() => window.__speech.length), hiddenCount);
  assert.ok(await page.getByRole('button', { name: '소리 반복 시작', exact: true }).isVisible());
  passed('hidden tab cancels speech; returning does not restart it without a gesture');
  await chooseMode('cloze');
  await page.waitForFunction(() => window.__sentence?.playing);
  await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, value: true }); document.dispatchEvent(new Event('visibilitychange')); });
  assert.equal(await page.evaluate(() => window.__sentence.playing), false);
  await page.evaluate(() => { delete document.hidden; document.dispatchEvent(new Event('visibilitychange')); });
  assert.equal(await page.evaluate(() => window.__sentence.playing), false);
  await page.getByRole('button', { name: '문장 반복 시작', exact: true }).click();
  assert.equal(await page.evaluate(() => window.__sentence.playing), true);
  await chooseMode('point');
  assert.equal(await page.evaluate(() => window.__sentence.playing), false);
  passed('cloze uses the full source clip; hidden tab and mode changes stop video; manual restart works');
  await page.locator('.word-queue button').nth(2).click(); await chooseMode('audio');
  await submit('can we do'); await expectMode('reading');
  assert.ok(await page.getByText('발음기호 준비 중', { exact: false }).isVisible());
  passed('unavailable meaning quiz is skipped without inventing IPA');
  await page.locator('button.nav-button[data-route="words"]').click();
  await page.locator('.mistake-button').filter({ hasText: 'Mum' }).click(); await expectMode('explain');
  await chooseMode('audio');
  assert.equal(await page.locator('#word-list').isVisible(), false);
  assert.ok(!(await page.locator('.view:visible .word-queue').innerText()).includes('Mum'));
  await submit('Mum'); await expectMode('meaning');
  passed('word-library practice shares automatic flow and masks its answer list');
  await page.locator('.view:visible .return-video').click(); await page.locator('[data-stage="dictation"]').click();
  await page.locator('#next-action').click(); await expectMode('explain');
  for (const viewport of [{ width: 1440, height: 900 }, { width: 820, height: 1180 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await chooseMode('spelling');
    const formInput = page.locator('.view:visible .answer-form input');
    const formButton = page.locator('.view:visible .answer-form button');
    const inputBox = await formInput.boundingBox(); const buttonBox = await formButton.boundingBox();
    const taskBox = await page.locator('.view:visible .workspace-task').boundingBox();
    assert.ok(Math.abs(inputBox.y + inputBox.height - buttonBox.y - buttonBox.height) <= 2);
    assert.ok(buttonBox.y >= taskBox.y && buttonBox.y + buttonBox.height <= taskBox.y + taskBox.height);
    await formInput.fill('mum');
    await formButton.scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${out}spelling-${viewport.width}.png`, fullPage: true });
    await chooseMode('explain');
    await page.screenshot({ path: `${out}layout-${viewport.width}.png`, fullPage: true });
    assert.ok(await page.locator('.view:visible .return-video').isVisible());
    passed(`layout ${viewport.width}px has aligned and unclipped input/submit, no horizontal overflow, and return control`);
  }
  assert.deepEqual(errors, []);
  passed('browser JavaScript errors: 0');
  await writeFile(`${out}results.json`, JSON.stringify({ date: new Date().toISOString(), base, checks, errors, media: 'YouTube and speech lifecycle instrumented; real acoustic output not asserted' }, null, 2));
} catch (error) {
  await page.screenshot({ path: `${out}failure.png`, fullPage: true });
  console.error(await page.locator('body').innerText());
  throw error;
} finally { await browser.close(); }
