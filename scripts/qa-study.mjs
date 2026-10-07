// Real Chromium regression QA for handwriting spelling and whole-sentence cards.
// YouTube, speech, handwriting recognition, and study-guide APIs are deterministic mocks.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';

const playwrightModule = process.env.PLAYWRIGHT_MODULE
  || '/Users/mingyukang/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs';
const { chromium } = await import(playwrightModule);
const base = process.env.QA_URL || 'http://localhost:4176';
const executablePath = process.env.QA_CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const out = new URL('../tmp/qa-study/', import.meta.url).pathname;
await mkdir(out, { recursive: true });

const browser = await chromium.launch({ headless: true, executablePath });
const context = await browser.newContext({
  viewport: { width: 1440, height: 820 },
  hasTouch: true,
  reducedMotion: 'reduce'
});
const page = await context.newPage();
const checks = [];
const errors = [];
const handwritingRequests = [];
const studyGuideRequests = [];
const handwritingQueue = [];
const sourceSentence = 'A dragon guards the golden gate.';

function passed(name) {
  checks.push(name);
  console.log(`PASS ${name}`);
}

function enqueueHandwriting(payload, delay = 0) {
  handwritingQueue.push({ payload, delay });
}

async function assertNoOverflow(width) {
  const layout = await page.evaluate(() => ({
    viewport: window.innerWidth,
    scrollWidth: document.documentElement.scrollWidth,
    offenders: [...document.querySelectorAll('body *')].filter(node => {
      const box = node.getBoundingClientRect();
      return box.right > window.innerWidth + 1 || box.left < -1;
    }).slice(0, 8).map(node => ({ tag: node.tagName.toLowerCase(), id: node.id, className: String(node.className || ''), right: Math.round(node.getBoundingClientRect().right) }))
  }));
  assert.equal(layout.scrollWidth <= layout.viewport, true, `${width}px horizontal overflow: ${JSON.stringify(layout)}`);
}

async function drawStroke() {
  const canvas = page.locator('.handwriting-canvas');
  await canvas.scrollIntoViewIfNeeded();
  const box = await canvas.boundingBox();
  assert.ok(box && box.width > 80 && box.height > 80, 'handwriting canvas should be visibly usable');
  await page.mouse.move(box.x + 30, box.y + box.height - 35);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.28, box.y + 40, { steps: 5 });
  await page.mouse.move(box.x + box.width * 0.48, box.y + box.height - 35, { steps: 5 });
  await page.mouse.up();
}

async function waitForHandwritingRequest(previousCount) {
  const deadline = Date.now() + 4000;
  while (handwritingRequests.length <= previousCount) {
    if (Date.now() >= deadline) throw new Error('handwriting request was not observed');
    await new Promise(resolve => setTimeout(resolve, 20));
  }
}

async function waitForObserved(predicate, message, timeoutMs = 4000) {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error(message);
    await new Promise(resolve => setTimeout(resolve, 20));
  }
}

async function finishCurrentPlayback(probe = '__player') {
  await page.waitForFunction(name => window[name]?.playing === true, probe);
  await page.evaluate(name => window[name].finish(), probe);
}

async function saveQaVideo() {
  const editor = page.locator('.library-editor');
  if (!(await editor.getAttribute('open'))) await editor.locator(':scope > summary').click();
  const manual = page.locator('#manual-library-editor');
  if (!(await manual.getAttribute('open'))) await manual.locator(':scope > summary').click();
  const form = page.locator('#add-video-form');
  await form.locator('[name="url"]').fill('https://www.youtube.com/watch?v=abcdefghijk');
  await form.locator('[name="title"]').fill('QA Handwriting and Sentences');
  await form.locator('[name="topic"]').fill('QA Expressions');
  await form.locator('[name="duration"]').fill('18');
  await form.locator('[name="chapters"]').fill('0:00 Golden gate');
  await form.locator('[name="transcript"]').fill(`0:00 ${sourceSentence}\n0:09 We open it together.`);
  await form.getByRole('button', { name: '내 영상 저장', exact: true }).click();
  await page.locator('#library-feedback').filter({ hasText: '영상을 저장했어요' }).waitFor();
}

async function openDragonSpelling() {
  await page.getByRole('button', { name: /^QA Handwriting and Sentences,/ }).click();
  await page.locator('#learning-view:not([hidden])').waitFor();
  await page.locator('#load-play-button').click();
  await finishCurrentPlayback();
  await page.locator('[data-stage="dictation"]').click();
  await page.locator('#dictation-answer').fill(sourceSentence);
  await page.getByRole('button', { name: '받아쓰기 확인', exact: true }).click();
  await page.locator('#word-selection').waitFor();
  await page.locator('.select-word').filter({ hasText: /^dragon$/ }).click();
  await page.locator('#next-action').click();
  await page.locator('.workspace-modes [data-mode="spelling"]').click();
  await page.waitForFunction(() => document.querySelector('.workspace-modes [data-mode="spelling"]')?.getAttribute('aria-pressed') === 'true');
}

page.on('pageerror', error => errors.push(`pageerror: ${error.message}`));
page.on('console', message => {
  const url = message.location()?.url || '';
  if (message.type() === 'error' && !/favicon/i.test(`${message.text()} ${url}`)) errors.push(`console: ${message.text()} @ ${url}`);
});

await page.route('**/api/handwriting', async route => {
  const body = route.request().postDataJSON();
  handwritingRequests.push(body);
  const next = handwritingQueue.shift() || { payload: { text: 'dragon', confidence: 0.99, candidates: [] }, delay: 0 };
  if (next.delay) await new Promise(resolve => setTimeout(resolve, next.delay));
  try {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(next.payload) });
  } catch {
    // Navigation and clear operations intentionally abort stale requests.
  }
});

await page.route('**/api/study-guide', async route => {
  const body = route.request().postDataJSON();
  studyGuideRequests.push(body);
  const word = {
    kind: 'word', text: body.text, ipa: '/ˈdræɡ.ən/', syllables: ['drag', 'on'], stressIndex: 0,
    segments: [{ text: 'dr', ipa: '/dr/' }, { text: 'a', ipa: '/æ/' }, { text: 'g', ipa: '/ɡ/' }, { text: 'on', ipa: '/ən/' }],
    noteKo: '첫 음절을 강하게 읽어요.'
  };
  const sentence = {
    kind: 'sentence', text: body.text,
    definitionEn: 'A mythical creature protects an entrance made of gold.',
    meaningKo: '용이 황금 문을 지키고 있어요.',
    situationKo: '이야기 속 장면을 설명할 때 쓰는 문장',
    patternEn: 'A/An + noun + verb + object.', patternKo: '누가 무엇을 하는지 말하는 문장',
    chunks: ['A dragon', 'guards', 'the golden gate'],
    examples: [{ text: 'A knight guards the castle gate.', meaningKo: '기사가 성문을 지켜요.' }],
    topic: '이야기'
  };
  await route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(body.kind === 'word' ? word : sentence)
  });
});

await page.route('**/api/meaning', route => route.fulfill({
  status: 200,
  contentType: 'application/json',
  body: JSON.stringify({
    source: 'openai', model: 'gpt-5.4', term: 'dragon', partOfSpeech: 'noun',
    definitionEn: 'A large imaginary creature.', meaningKo: '용',
    exampleEn: sourceSentence, exampleKo: '용이 황금 문을 지켜요.',
    familyNoteKo: '관련된 말을 함께 익혀요.', relatedWords: [],
    meanings: [{ partOfSpeech: 'noun', definitions: [{ definition: 'A large imaginary creature.', example: sourceSentence }] }]
  })
}));
await page.route('https://api.dictionaryapi.dev/**', route => route.fulfill({
  status: 200,
  contentType: 'application/json',
  body: JSON.stringify([{ word: 'dragon', phonetic: '/ˈdræɡ.ən/', meanings: [{
    partOfSpeech: 'noun', definitions: [{ definition: 'A large imaginary creature.', example: sourceSentence }]
  }] }])
}));
await page.route('https://api.mymemory.translated.net/**', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ responseStatus: 200, responseData: { translatedText: '용' } }) }));

await page.addInitScript(() => {
  window.__speech = [];
  window.__player = { playing: false, starts: 0, plays: 0, pauses: 0, ranges: [] };
  window.__sentence = { playing: false, starts: 0, plays: 0, pauses: 0, ranges: [] };
  let timers = [];
  Object.defineProperty(window, 'speechSynthesis', {
    configurable: true,
    value: {
      speaking: false, pending: false,
      getVoices: () => [{ lang: 'en-US', name: 'QA Natural', voiceURI: 'qa-natural', default: true }],
      cancel: () => { timers.forEach(clearTimeout); timers = []; },
      resume: () => {},
      speak: utterance => {
        window.__speech.push(utterance.text);
        utterance.onstart?.();
        timers.push(setTimeout(() => utterance.onend?.(), 8));
      }
    }
  });
  window.SpeechSynthesisUtterance = class { constructor(text) { this.text = text; } };
  class SilentAudioContext {
    constructor() { this.state = 'running'; this.currentTime = 0; this.destination = {}; }
    resume() { this.state = 'running'; return Promise.resolve(); }
    createOscillator() { return { frequency: { setValueAtTime() {} }, connect() {}, disconnect() {}, start() {}, stop() { this.onended?.(); }, onended: null, type: 'sine' }; }
    createGain() { return { gain: { setValueAtTime() {}, linearRampToValueAtTime() {} }, connect() {}, disconnect() {} }; }
  }
  window.AudioContext = SilentAudioContext;
  window.webkitAudioContext = SilentAudioContext;
  window.Audio = class {
    constructor(src) { this.src = src; this.paused = true; }
    play() {
      this.paused = false;
      window.__speech.push('ay');
      setTimeout(() => this.onplaying?.(), 0);
      setTimeout(() => { this.paused = true; this.onended?.(); }, 8);
      return Promise.resolve();
    }
    pause() { this.paused = true; }
  };
  window.YT = { Player: class {
    constructor(element, options) {
      this.events = options.events;
      this.time = 0;
      this.rate = 1;
      this.probe = element.parentElement?.classList.contains('sentence-player') || element.classList?.contains('sentence-player')
        ? window.__sentence : window.__player;
      this.probe.finish = () => { this.time = this.probe.range?.endSeconds || this.time; this.probe.playing = false; this.events.onStateChange?.({ data: 0 }); };
      setTimeout(() => this.events.onReady?.(), 5);
    }
    loadVideoById(config) { this.probe.range = config; this.probe.ranges.push(config); this.probe.starts += 1; this.time = config.startSeconds; this.playVideo(); }
    cueVideoById(config) { this.probe.range = config; this.probe.ranges.push(config); this.time = config.startSeconds; this.events.onStateChange?.({ data: 5 }); }
    getCurrentTime() { return this.time; }
    getAvailablePlaybackRates() { return [0.5, 0.75, 1, 1.25]; }
    getPlaybackRate() { return this.rate; }
    setPlaybackRate(rate) { this.rate = rate; this.events.onPlaybackRateChange?.({ data: rate }); }
    seekTo(time) { this.time = time; }
    playVideo() { this.probe.playing = true; this.probe.plays += 1; this.events.onStateChange?.({ data: 1 }); }
    pauseVideo() { this.probe.playing = false; this.probe.pauses += 1; this.events.onStateChange?.({ data: 2 }); }
    destroy() { this.probe.playing = false; }
  } };
});

try {
  await page.goto(base, { waitUntil: 'domcontentloaded' });
  await page.locator('.video-card').first().waitFor();
  await saveQaVideo();
  await openDragonSpelling();

  const inputModes = page.locator('.spelling-input-modes, .spelling-input-toggle, [aria-label="철자 입력 방법"]');
  await inputModes.getByRole('button', { name: '손글씨', exact: true }).click();
  await page.locator('.handwriting-input').waitFor();
  assert.equal(await page.locator('.handwriting-canvas').isVisible(), true);
  assert.equal(await page.evaluate(() => navigator.maxTouchPoints > 0), true);
  passed('touch-capable Chromium opens a visible handwriting canvas from spelling');

  await page.getByRole('button', { name: '듣고쓰기', exact: true }).click();
  assert.doesNotMatch((await page.locator('.handwriting-input').innerText()).toLocaleLowerCase('en-US'), /dragon/);
  assert.doesNotMatch((await page.locator('.workspace-shell, .workspace-sidebar').allInnerTexts()).join(' ').toLocaleLowerCase('en-US'), /dragon/);
  assert.equal(await page.locator('.handwriting-guide').isHidden(), true);
  passed('dictation handwriting mode hides the target across the entire workspace and sidebar');
  await page.setViewportSize({ width: 390, height: 820 });
  await assertNoOverflow(390);
  const handwritingLayout = await page.locator('.workspace-task:has(.handwriting-input)').evaluate(node => {
    const canvas = node.querySelector('.handwriting-canvas-wrap');
    const content = node.querySelector(':scope > .task-content');
    return {
      canvasHeight: Math.round(canvas?.getBoundingClientRect().height || 0),
      taskClientHeight: node.clientHeight,
      taskScrollHeight: node.scrollHeight,
      contentClientHeight: content?.clientHeight || 0,
      contentScrollHeight: content?.scrollHeight || 0
    };
  });
  assert.ok(handwritingLayout.canvasHeight >= 220, `mobile handwriting canvas is too short: ${JSON.stringify(handwritingLayout)}`);
  assert.ok(handwritingLayout.taskScrollHeight <= handwritingLayout.taskClientHeight + 2,
    `mobile handwriting task is internally clipped: ${JSON.stringify(handwritingLayout)}`);
  if (handwritingLayout.contentClientHeight) assert.ok(handwritingLayout.contentScrollHeight <= handwritingLayout.contentClientHeight + 2,
    `mobile handwriting content is internally clipped: ${JSON.stringify(handwritingLayout)}`);
  await page.locator('.handwriting-input').scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${out}handwriting-mobile-390.png`, fullPage: true });
  await page.locator('.handwriting-canvas-wrap').screenshot({ path: `${out}handwriting-writing-surface-mobile-390.png` });
  await page.setViewportSize({ width: 1440, height: 820 });
  passed('touch handwriting workspace exposes a 220px canvas at 390px without internal clipping or horizontal overflow');

  enqueueHandwriting({ text: 'dragn', confidence: 0.99, candidates: [{ text: 'dragon', confidence: 0.72 }] });
  let requestCount = handwritingRequests.length;
  await drawStroke();
  await waitForHandwritingRequest(requestCount);
  await page.locator('.handwriting-result').waitFor();
  await page.waitForFunction(() => document.querySelector('.handwriting-result')?.value === 'dragn');
  assert.equal(await page.locator('.answer-feedback.correct').count(), 0);
  assert.equal(handwritingRequests.at(-1).mode, 'word');
  assert.match(handwritingRequests.at(-1).image, /^data:image\/png;base64,/);
  assert.equal(JSON.stringify(handwritingRequests.at(-1)).toLocaleLowerCase('en-US').includes('dragon'), false);
  passed('real pointer ink sends image-only recognition input and a confident misspelling is not treated as correct');

  await page.getByRole('button', { name: '지우기', exact: true }).click();
  enqueueHandwriting({ text: 'dragn', confidence: 0.61, candidates: [{ text: 'dragon', confidence: 0.79 }, { text: 'dragn', confidence: 0.61 }] });
  requestCount = handwritingRequests.length;
  await drawStroke();
  await waitForHandwritingRequest(requestCount);
  const dragonCandidate = page.locator('.handwriting-candidate').filter({ hasText: /^dragon$/ });
  await dragonCandidate.waitFor();
  assert.equal(await page.locator('.handwriting-result').inputValue(), '');
  await dragonCandidate.click();
  assert.equal(await page.locator('.handwriting-result').inputValue(), 'dragon');
  passed('low-confidence recognition waits for explicit candidate confirmation');

  enqueueHandwriting({ text: 'dragon', confidence: 0.99 }, 350);
  requestCount = handwritingRequests.length;
  await drawStroke();
  assert.equal(await page.locator('.handwriting-result').inputValue(), '');
  assert.equal(await page.locator('.answer-form input').inputValue(), '');
  await waitForHandwritingRequest(requestCount);
  await page.getByRole('button', { name: '지우기', exact: true }).click();
  await page.waitForTimeout(450);
  assert.equal(await page.locator('.handwriting-result').inputValue(), '');
  passed('new ink invalidates confirmed grading input and clearing rejects the in-flight recognition response');

  await page.locator('.handwriting-result').fill('abcdefghijklmnopqrstuvwxyz');
  await page.evaluate(() => { window.__speech.length = 0; });
  await page.getByRole('button', { name: '다 썼어요', exact: true }).click();
  await page.waitForFunction(() => window.__speech.length >= 27, null, { timeout: 5000 });
  const completionSpeech = await page.evaluate(() => window.__speech.slice());
  const alphabetNames = ['ay','bee','see','dee','ee','eff','gee','aitch','eye','jay','kay','el','em','en','oh','pee','cue','ar','ess','tee','you','vee','double you','ex','why','zee'];
  let cursor = -1;
  for (const name of alphabetNames) {
    const next = completionSpeech.findIndex((text, index) => index > cursor && String(text).toLocaleLowerCase('en-US') === name);
    assert.ok(next > cursor, `missing ordered alphabet speech ${name}: ${completionSpeech.join(', ')}`);
    cursor = next;
  }
  assert.equal(completionSpeech.some(text => /\b(?:capital|letter)\b/i.test(text)), false);
  passed('explicit completion speaks the full alphabet sequence in order without capital or letter prefixes');

  await page.getByRole('button', { name: '지우기', exact: true }).click();
  await page.locator('.handwriting-result').fill('abcdefghijkl');
  await page.evaluate(() => { window.__speech.length = 0; });
  await page.getByRole('button', { name: '다 썼어요', exact: true }).click();
  await page.waitForFunction(() => window.__speech.length > 0);
  await page.getByRole('button', { name: '지우기', exact: true }).click();
  const cancelledSpeechCount = await page.evaluate(() => window.__speech.length);
  await page.waitForTimeout(250);
  assert.equal(await page.evaluate(() => window.__speech.length), cancelledSpeechCount);
  passed('clearing the canvas cancels the remaining completion spelling sequence');

  enqueueHandwriting({ text: 'dragon', confidence: 0.99 }, 350);
  await page.getByRole('button', { name: '지우기', exact: true }).click();
  requestCount = handwritingRequests.length;
  await drawStroke();
  await waitForHandwritingRequest(requestCount);
  await page.locator('#study-sentences').click();
  await page.locator('#sentences-view:not([hidden])').waitFor();
  await page.waitForTimeout(450);
  assert.equal(await page.locator('.handwriting-input').count(), 0);
  assert.equal(await page.locator('#sentence-video-filter').inputValue() !== '', true);
  passed('scene sentence-card action navigates with the current video selected and ignores stale handwriting recognition');

  const videoFilter = page.locator('#sentence-video-filter');
  await videoFilter.selectOption({ label: 'QA Handwriting and Sentences' });
  await page.locator('#sentence-search').fill('dragon');
  const sourceMatches = page.locator('#sentence-list').getByText(sourceSentence, { exact: true });
  await sourceMatches.first().waitFor();
  assert.equal(await sourceMatches.count(), 1);
  assert.equal((await page.locator('#sentence-list').innerText()).includes('A dragon protects'), false);
  passed('sentence catalog shows one exact source sentence without AI rewriting');

  await page.locator('#sentence-search').fill('');
  await page.locator('#sentence-list').getByText('We open it together.', { exact: true }).waitFor();
  await sourceMatches.first().locator('xpath=ancestor-or-self::button[1]').click();
  await page.locator('#sentence-study-panel:not([hidden])').waitFor();
  await waitForObserved(() => studyGuideRequests.some(item => item.kind === 'sentence' && item.text === 'We open it together.'),
    'the next sentence study guide was not prefetched');
  assert.ok(studyGuideRequests.some(item => item.kind === 'sentence' && item.text === sourceSentence));
  passed('current and next exact-source sentence guides are requested before moving cards');
  const stepNav = page.locator('#sentence-study-panel .sentence-card-steps');
  const stepLabels = await stepNav.getByRole('button').allInnerTexts();
  assert.deepEqual(stepLabels, ['듣기', '뜻', '묶어 읽기', '빈칸', '순서', '혼자 말하기', '복습']);
  passed('sentence study exposes the seven requested stages in order');

  for (const label of ['빈칸', '순서']) {
    await stepNav.getByRole('button', { name: label, exact: true }).click();
    assert.doesNotMatch(await page.locator('#sentence-study-panel .sentence-card-text').innerText(), new RegExp(sourceSentence.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.equal((await page.locator('#sentence-study-panel .sentence-card-body').innerText()).includes(sourceSentence), false);
  }
  passed('cloze and word-order stages do not expose the complete answer in their heading or body');

  await stepNav.getByRole('button', { name: '뜻', exact: true }).click();
  await page.getByRole('button', { name: '뜻 보기', exact: true }).click();
  const english = page.locator('#sentence-study-panel').getByText('A mythical creature protects an entrance made of gold.', { exact: true });
  const korean = page.locator('#sentence-study-panel').getByText('용이 황금 문을 지키고 있어요.', { exact: true });
  await english.waitFor();
  await korean.waitFor();
  assert.ok(await english.evaluate((node, koreanNode) => Boolean(node.compareDocumentPosition(koreanNode) & Node.DOCUMENT_POSITION_FOLLOWING), await korean.elementHandle()));
  await page.locator('#sentence-study-panel .sentence-card').scrollIntoViewIfNeeded();
  await page.locator('#sentence-study-panel .sentence-card').screenshot({ path: `${out}sentence-card-meaning-desktop.png` });
  passed('sentence meaning displays its English definition before Korean meaning');

  await stepNav.getByRole('button', { name: '듣기', exact: true }).click();
  const originalPlay = page.getByRole('button', { name: /원본.*(?:대화|문장).*듣기/ }).last();
  const playsBefore = await page.evaluate(() => window.__sentence.plays);
  await originalPlay.click();
  await page.waitForFunction(previous => window.__sentence.plays > previous, playsBefore);
  const range = await page.evaluate(() => window.__sentence.range);
  assert.equal(range.startSeconds, 0);
  assert.equal(range.endSeconds, 9);
  passed('sentence card plays the original dialogue time range');

  await page.locator('#sentence-study-panel .sentence-save').click();
  await stepNav.getByRole('button', { name: '혼자 말하기', exact: true }).click();
  assert.equal((await page.locator('#sentence-study-panel').innerText()).includes(sourceSentence), false);
  assert.equal(await page.getByRole('button', { name: '문장 힌트 보기', exact: true }).count(), 1);
  passed('sentence recall starts without leaking the source answer');

  await page.getByRole('button', { name: '문장 힌트 보기', exact: true }).click();
  assert.equal(await page.getByRole('button', { name: '혼자 말했어요', exact: true }).isDisabled(), true);
  await page.getByRole('button', { name: '도움받았어요', exact: true }).click();
  await page.waitForFunction(() => {
    const data = JSON.parse(localStorage.getItem('wordtrail:guest:v1') || '{}');
    return data.progress?.some(item => item.expressionId?.startsWith('sentence-')
      && item.reading?.result === 'helped' && item.review?.dueAt);
  });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.locator('[data-route="sentences"]').click();
  await page.locator('#sentences-view:not([hidden])').waitFor();
  await page.locator('#sentence-filter').selectOption('saved').catch(async () => {
    await page.locator('#sentence-filter [value="saved"]').click();
  });
  await page.locator('#sentence-list').getByText(sourceSentence, { exact: true }).waitFor();
  assert.match(await page.locator('#sentence-list').innerText(), /저장됨/);
  const persistedReview = await page.evaluate(() => JSON.parse(localStorage.getItem('wordtrail:guest:v1')).progress
    .find(item => item.expressionId?.startsWith('sentence-')));
  assert.equal(persistedReview.reading.result, 'helped');
  assert.ok(persistedReview.review.dueAt);
  passed('saved sentence and helped review state survive a reload without being counted independent');

  await page.screenshot({ path: `${out}sentence-cards-desktop.png`, fullPage: true });
  await assertNoOverflow(1440);
  await page.setViewportSize({ width: 390, height: 820 });
  await assertNoOverflow(390);
  await page.screenshot({ path: `${out}sentence-cards-mobile-390.png`, fullPage: true });
  passed('sentence cards fit 1440px and 390px without horizontal overflow');

  assert.ok(studyGuideRequests.length >= 1);
  assert.deepEqual(errors, []);
  passed('browser JavaScript and console errors: 0');
  await writeFile(`${out}results.json`, JSON.stringify({
    date: new Date().toISOString(), base, checks, errors,
    handwritingRequestCount: handwritingRequests.length,
    studyGuideRequestCount: studyGuideRequests.length,
    evidence: 'Real Chromium pointer, storage, reload, layout, and DOM behavior. YouTube, speech, handwriting recognition, dictionary, translation, and study-guide responses were deterministic mocks; no real iPad, recognizer-quality, device-audio, or external-service claim.'
  }, null, 2));
} catch (error) {
  await page.screenshot({ path: `${out}failure.png`, fullPage: true }).catch(() => {});
  await writeFile(`${out}failure.txt`, `${error.stack || error}\n\n${await page.locator('body').innerText().catch(() => '')}\n`);
  throw error;
} finally {
  await browser.close();
}
