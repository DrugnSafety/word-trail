// Browser regression QA for the 2026-10 learning revision.
// External dictionary and translation requests are deterministic route mocks.
import assert from 'node:assert/strict';
import { mkdir, writeFile, readFile } from 'node:fs/promises';

const playwrightModule = process.env.PLAYWRIGHT_MODULE
  || '/Users/mingyukang/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs';
const { chromium } = await import(playwrightModule);
const base = process.env.QA_URL || 'http://localhost:4176';
const executablePath = process.env.QA_CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const out = new URL('../tmp/qa-revision/', import.meta.url).pathname;
await mkdir(out, { recursive: true });

const browser = await chromium.launch({ headless: true, executablePath });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
const page = await context.newPage();
const checks = [];
const errors = [];
const dictionaryTerms = [];
const translationQueries = [];
const aiTerms = [];

function related(term, partOfSpeech, relationship, labelKo, meaningKo, exampleEn, exampleKo) {
  return { term, partOfSpeech, relationship, labelKo, meaningKo, exampleEn, exampleKo };
}

function aiPackage(term) {
  const packages = {
    'can play': {
      definitionEn: 'To be able or allowed to take part in a game.', meaningKo: '놀이나 게임을 할 수 있다', partOfSpeech: 'phrase',
      exampleEn: 'We can play after lunch.', exampleKo: '우리는 점심을 먹고 놀 수 있어요.', familyNoteKo: '함께 놀 때 쓰는 관련 표현을 살펴봐요.',
      relatedWords: [related('play together', 'phrase', 'related', '관련 표현', '함께 놀다', 'The children play together.', '아이들이 함께 놀아요.')]
    },
    'take turns': {
      definitionEn: 'To do something one person after another.', meaningKo: '번갈아 하다', partOfSpeech: 'phrase',
      exampleEn: 'We take turns with the toy.', exampleKo: '우리는 장난감을 번갈아 사용해요.', familyNoteKo: '순서를 지킬 때 쓰는 관련 표현을 살펴봐요.',
      relatedWords: [related('alternate', 'verb', 'related', '관련어', '번갈아 하다', 'The teams alternate turns.', '두 팀이 차례를 번갈아 가져요.')]
    },
    excite: {
      definitionEn: 'To make someone feel very enthusiastic and eager.', meaningKo: '누군가를 매우 신나고 기대하게 만들다', partOfSpeech: 'verb',
      exampleEn: 'The game will excite the learners.', exampleKo: '그 게임은 학습자들을 신나게 할 거예요.', familyNoteKo: '동사에서 실제로 파생된 형용사와 명사를 함께 살펴봐요.',
      relatedWords: [
        related('excited', 'adjective', 'derivation', '파생 형용사', '신이 난', 'She felt excited about the game.', '그녀는 게임 때문에 신이 났어요.'),
        related('excitement', 'noun', 'derivation', '명사형', '흥분과 기대', 'The news caused excitement.', '그 소식은 기대감을 불러왔어요.')
      ]
    },
    goal: {
      definitionEn: 'An aim or desired result.', meaningKo: '목표 또는 원하는 결과', partOfSpeech: 'noun',
      exampleEn: 'Her goal is to finish the lesson.', exampleKo: '그녀의 목표는 수업을 마치는 것이에요.', familyNoteKo: '명사의 복수형과 뜻이 가까운 표현을 함께 살펴봐요.',
      relatedWords: [
        related('goals', 'noun', 'inflection', '복수형', '여러 목표', 'We set two goals.', '우리는 목표 두 개를 세웠어요.'),
        related('aim', 'noun', 'related', '관련어', '목표', 'My aim is to improve.', '내 목표는 발전하는 것이에요.')
      ]
    },
    'once upon a time': {
      definitionEn: 'At an unspecified time in the past, used to begin a story.', meaningKo: '옛날 옛적에, 이야기를 시작할 때 쓰는 표현', partOfSpeech: 'idiom',
      exampleEn: 'Once upon a time, a child found a hidden garden.', exampleKo: '옛날 옛적에 한 아이가 숨겨진 정원을 발견했어요.', familyNoteKo: '이야기를 시작할 때 쓰는 실제 관련 표현을 함께 살펴봐요.',
      relatedWords: [related('long ago', 'phrase', 'related', '관련 표현', '오래전에', 'Long ago, people lived here.', '오래전에 사람들이 이곳에 살았어요.')]
    },
    dragon: {
      definitionEn: 'A large imaginary creature often shown with wings and fire.', meaningKo: '용, 날개와 불을 뿜는 모습으로 그려지는 상상 속 동물', partOfSpeech: 'noun',
      exampleEn: 'A dragon guarded the treasure.', exampleKo: '용 한 마리가 보물을 지켰어요.', familyNoteKo: '명사의 복수형과 실제 파생 형용사, 의미 관련어를 함께 익혀요.',
      relatedWords: [
        related('dragons', 'noun', 'inflection', '복수형', '여러 용', 'The story has two dragons.', '그 이야기에는 용 두 마리가 나와요.'),
        related('draconic', 'adjective', 'derivation', '파생 형용사', '용을 닮은', 'The gate had a draconic design.', '그 문에는 용을 닮은 무늬가 있었어요.'),
        related('mythical creature', 'noun', 'related', '관련어', '신화 속 생물', 'A dragon is a mythical creature.', '용은 신화 속 생물이에요.')
      ]
    }
  };
  const item = packages[term] || {
    definitionEn: `A learning definition for ${term}.`, meaningKo: `${term}의 학습용 뜻`, partOfSpeech: 'word',
    exampleEn: `We use ${term} in this lesson.`, exampleKo: `이 수업에서 ${term}을 사용해요.`, familyNoteKo: '확인된 관련 표현을 함께 살펴봐요.',
    relatedWords: [related(`${term} example`, 'phrase', 'related', '관련 표현', `${term} 관련 표현`, `This is a ${term} example.`, `이것은 ${term} 관련 예문이에요.`)]
  };
  return {
    source: 'openai', model: 'gpt-5.4', term, ...item,
    meanings: [{ partOfSpeech: item.partOfSpeech, definitions: [{ definition: item.definitionEn, example: item.exampleEn }] }]
  };
}

function passed(name) {
  checks.push(name);
  console.log(`PASS ${name}`);
}

page.on('pageerror', error => errors.push(`pageerror: ${error.message}`));
page.on('console', message => {
  if (message.type() === 'error' && !/favicon/i.test(message.text())) errors.push(`console: ${message.text()}`);
});

await page.route('https://api.dictionaryapi.dev/api/v2/entries/en/**', async route => {
  const term = decodeURIComponent(new URL(route.request().url()).pathname.split('/').at(-1)).toLowerCase();
  dictionaryTerms.push(term);
  const definitions = {
    excite: { partOfSpeech: 'verb', definition: 'To make someone feel very enthusiastic and eager.', example: 'The game will excite the learners.' },
    goal: { partOfSpeech: 'noun', definition: 'An aim or desired result.', example: 'Her goal is to finish the lesson.' }
  };
  const entry = definitions[term];
  if (!entry) return route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ title: 'No Definitions Found' }) });
  await route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify([{ word: term, phonetic: term === 'goal' ? '/ɡoʊl/' : '/ɪkˈsaɪt/', meanings: [{ partOfSpeech: entry.partOfSpeech, definitions: [{ definition: entry.definition, example: entry.example }] }] }])
  });
});

await page.route('https://api.mymemory.translated.net/get**', async route => {
  const query = new URL(route.request().url()).searchParams.get('q') || '';
  translationQueries.push(query);
  const translatedText = query.includes('desired result') ? '목표 또는 원하는 결과' : '누군가를 매우 신나고 기대하게 만들다';
  await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ responseStatus: 200, quotaFinished: false, responseData: { translatedText } }) });
});

await page.route('**/api/meaning', async route => {
  const { term } = route.request().postDataJSON();
  aiTerms.push(term);
  await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(aiPackage(term)) });
});
await page.route('**/api/ai-usage', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
  day: '2026-10-06', timezone: 'America/New_York', dailyLimit: 1000000,
  keys: [1,2].map(n => ({ id: `key-${n}`, used: 40, reserved: 0, remaining: 999960, disabled: false }))
}) }));

await page.addInitScript(() => {
  window.__speech = [];
  window.__player = { playing: false, starts: 0, plays: 0, pauses: 0 };
  let timers = [];
  Object.defineProperty(window, 'speechSynthesis', {
    configurable: true,
    value: {
      getVoices: () => [{ lang: 'en-US', name: 'QA Natural', voiceURI: 'qa-natural', default: true }],
      cancel: () => { timers.forEach(clearTimeout); timers = []; },
      resume: () => {},
      speak: utterance => {
        window.__speech.push(utterance.text);
        utterance.onstart?.();
        timers.push(setTimeout(() => utterance.onend?.(), 15));
      }
    }
  });
  window.SpeechSynthesisUtterance = class { constructor(text) { this.text = text; } };
  window.YT = { Player: class {
    constructor(element, options) {
      this.events = options.events;
      this.time = 0;
      this.rate = 1;
      this.probe = element.parentElement?.classList.contains('sentence-player')
        ? (window.__sentence = { playing: false, starts: 0, pauses: 0 })
        : window.__player;
      this.probe.finish = () => {
        this.time = this.probe.range?.endSeconds || this.time;
        this.probe.playing = false;
        this.events.onStateChange?.({ data: 0 });
      };
      this.probe.boundary = () => { this.time = this.probe.range?.endSeconds || this.time; };
      setTimeout(() => this.events.onReady?.(), 10);
    }
    loadVideoById(config) { this.probe.range = config; this.probe.starts += 1; this.time = config.startSeconds; this.playVideo(); }
    cueVideoById(config) { this.probe.range = config; this.time = config.startSeconds; this.events.onStateChange?.({ data: 5 }); }
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

const activeMode = () => page.locator('.view:visible .workspace-modes button[aria-pressed="true"]').getAttribute('data-mode');
async function expectMode(value) {
  await page.waitForFunction(mode => [...document.querySelectorAll(`.workspace-modes button[data-mode="${mode}"][aria-pressed="true"]`)]
    .some(node => node.getClientRects().length), value);
}
async function chooseMode(value) {
  await page.locator(`.view:visible .workspace-modes button[data-mode="${value}"]`).click();
  await expectMode(value);
}
async function saveVideo({ url, title, duration, transcript }) {
  const form = page.locator('#add-video-form');
  await form.locator('[name="url"]').fill(url);
  await form.locator('[name="title"]').fill(title);
  await form.locator('[name="topic"]').fill('QA Science');
  await form.locator('[name="duration"]').fill(String(duration));
  await form.locator('[name="chapters"]').fill('0:00 Expressions\n0:12 Word forms');
  await form.locator('[name="transcript"]').fill(transcript);
  await form.getByRole('button', { name: '내 영상 저장', exact: true }).click();
  await page.locator('#library-feedback').filter({ hasText: '영상을 저장했어요' }).waitFor();
  await page.getByRole('button', { name: new RegExp(`^${title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')},`) }).waitFor();
}
async function finishCurrentPlayback() {
  await page.waitForFunction(() => window.__player.playing === true);
  await page.evaluate(() => window.__player.finish());
}
async function submitWorkspace(answer) {
  const form = page.locator('.view:visible .answer-form');
  await form.locator('input').fill(answer);
  await form.getByRole('button', { name: '확인', exact: true }).click();
}
async function assertNoOverflow(width) {
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, `${width}px horizontal overflow`);
}
async function waitForObserved(predicate, message, timeoutMs = 2000) {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error(message);
    await new Promise(resolve => setTimeout(resolve, 20));
  }
}

try {
  await page.goto(base, { waitUntil: 'domcontentloaded' });
  await page.locator('.video-card').first().waitFor();
  assert.equal(await page.evaluate(() => localStorage.length), 0);
  passed('fresh isolated browser context starts without user storage');

  const editor = page.locator('.library-editor');
  const originalVideoCount = await page.locator('.video-card').count();
  await editor.locator(':scope > summary').click();
  const requestForm = page.locator('#video-request-form');
  assert.equal(await page.locator('#add-video-form').isVisible(), false);
  assert.equal(await requestForm.locator('[name="sources"]').isVisible(), true);
  passed('video preparation asks for links first while manual transcript entry stays collapsed');
  await requestForm.locator('[name="sources"]').fill('https://evil.example/video');
  await requestForm.getByRole('button', { name: 'Codex에 전달할 목록 만들기' }).click();
  await page.locator('#video-request-feedback').filter({hasText:'YouTube 주소만'}).waitFor();
  assert.equal(await page.locator('#video-request-result').isVisible(), false);
  await requestForm.locator('[name="sources"]').fill('시간 관리 | https://www.youtube.com/watch?v=n3kNlFMXslo\nhttps://www.youtube.com/@TED\nhttps://www.youtube.com/playlist?list=PLabc123');
  await requestForm.locator('[name="topic"]').fill('시간 관리');
  await requestForm.getByRole('button', { name: 'Codex에 전달할 목록 만들기' }).click();
  const requestText = await page.locator('#video-request-output').inputValue();
  assert.match(requestText, /영상 제목·길이·영어 대본·챕터는 Codex/);
  assert.match(requestText, /선택한 영상만/);
  assert.match(requestText, /"type": "playlist"/);
  assert.equal(await page.locator('.video-card').count(), originalVideoCount, 'handoff is not a fabricated study video');
  passed('video, channel and playlist link-only handoff validates input without adding fake study content');
  await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', {configurable:true,value:{writeText:async text=>{window.__copiedRequest=text;}}}));
  await page.locator('#copy-video-request').click();
  await page.locator('#video-request-feedback').filter({hasText:'복사했어요'}).waitFor();
  assert.equal(await page.evaluate(() => window.__copiedRequest), requestText);
  const [requestDownload] = await Promise.all([page.waitForEvent('download'), page.locator('#download-video-request').click()]);
  assert.equal(requestDownload.suggestedFilename(), 'word-trail-video-list.txt');
  assert.equal(await readFile(await requestDownload.path(), 'utf8'), requestText);
  passed('copy action and actual downloaded text contain the complete Codex handoff');
  await requestForm.locator('h2').scrollIntoViewIfNeeded();
  await page.screenshot({path:`${out}/video-list-desktop.png`,fullPage:false});
  await page.setViewportSize({width:390,height:844});
  await assertNoOverflow(390);
  await page.screenshot({path:`${out}/video-list-mobile.png`,fullPage:false});
  await page.setViewportSize({width:1440,height:1000});
  await requestForm.locator('[name="sources"]').fill('https://youtu.be/abcdefghijk');
  assert.equal(await page.locator('#video-request-result').isVisible(), false);
  assert.equal(await page.locator('#video-request-output').inputValue(), '');
  passed('editing links clears stale export content and link-only form fits 390px');
  await page.locator('#manual-library-editor > summary').click();
  const channelForm = page.locator('#add-channel-form');
  await channelForm.locator('[name="url"]').fill('https://www.youtube.com/@QAScience');
  await channelForm.locator('[name="title"]').fill('QA Science Channel');
  await channelForm.locator('[name="topic"]').fill('QA Science');
  await channelForm.getByRole('button', { name: '채널 저장', exact: true }).click();
  await page.locator('#my-channels').getByRole('link', { name: /QA Science Channel/ }).waitFor();

  await saveVideo({
    url: 'https://www.youtube.com/watch?v=abcdefghijk',
    title: 'Alpha Long Lesson',
    duration: 30,
    transcript: '0:00 We can play games and take turns today.\n0:12 She felt excited about her goals.\n0:22 Once upon a time, a dragon found a garden.'
  });
  await saveVideo({
    url: 'https://www.youtube.com/watch?v=lmnopqrstuv',
    title: 'Zeta Short Lesson',
    duration: 20,
    transcript: '0:00 This is a short lesson.\n0:12 Review it now.'
  });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.locator('.video-card').first().waitFor();
  await page.locator('.library-editor > summary').click();
  await page.locator('#manual-library-editor > summary').click();
  assert.equal(await page.locator('#my-channels').getByRole('link', { name: /QA Science Channel/ }).count(), 1);
  assert.equal(await page.getByRole('button', { name: /^Alpha Long Lesson,/ }).count(), 1);
  assert.equal(await page.getByRole('button', { name: /^Zeta Short Lesson,/ }).count(), 1);
  passed('personal channel and timed-transcript videos persist after reload');

  await page.locator('#topic-filter').selectOption({ label: 'QA Science' });
  assert.equal(await page.locator('.video-card').count(), 2);
  await page.locator('#video-sort').selectOption('title');
  assert.match(await page.locator('.video-card h3').first().innerText(), /^Alpha/);
  await page.locator('#video-sort').selectOption('duration');
  assert.match(await page.locator('.video-card h3').first().innerText(), /^Zeta/);
  await page.locator('#video-sort').selectOption('createdAt');
  assert.match(await page.locator('.video-card h3').first().innerText(), /^Zeta/);
  passed('topic filter and title, duration, recent sorting update the catalog');

  await page.getByRole('button', { name: /^Alpha Long Lesson,/ }).click();
  await page.locator('#learning-view:not([hidden])').waitFor();
  assert.equal(await page.locator('.chapter-section').count(), 2);
  const beforeWidth = (await page.locator('#player-shell').boundingBox()).width;
  await page.locator('#enlarge-video').click();
  assert.equal(await page.locator('#enlarge-video').getAttribute('aria-pressed'), 'true');
  assert.equal(await page.locator('#learning-view').evaluate(node => node.classList.contains('video-expanded')), true);
  const afterWidth = (await page.locator('#player-shell').boundingBox()).width;
  assert.ok(afterWidth > beforeWidth, `expected enlarged width ${afterWidth} > ${beforeWidth}`);
  await page.locator('#enlarge-video').click();
  passed('video enlarge toggles pressed state, layout class, and visible player width');

  await page.locator('#load-play-button').click();
  await finishCurrentPlayback();
  await page.locator('#stage-nav').waitFor();
  const firstDialoguePlay = await page.evaluate(() => window.__player.plays);
  await page.locator('#play-scene-button').click();
  await page.waitForFunction(previous => window.__player.plays > previous, firstDialoguePlay);
  const initialDialoguePlay = await page.evaluate(() => window.__player.plays);
  await page.evaluate(() => window.__player.boundary());
  await page.waitForFunction(previous => window.__player.plays > previous, initialDialoguePlay, { timeout: 2500 });
  const boundaryReplay = await page.evaluate(() => window.__player.plays);
  await page.evaluate(() => window.__player.finish());
  await page.waitForFunction(previous => window.__player.plays > previous, boundaryReplay, { timeout: 2500 });
  const endedReplay = await page.evaluate(() => window.__player.plays);
  const pausesBeforeCancel = await page.evaluate(() => window.__player.pauses);
  await page.evaluate(() => window.__player.boundary());
  await page.waitForFunction(previous => window.__player.pauses > previous && window.__player.playing === false, pausesBeforeCancel);
  await page.locator('#pause-button').click();
  const pausedPlayCount = await page.evaluate(() => window.__player.plays);
  await page.waitForTimeout(1150);
  assert.equal(await page.evaluate(() => window.__player.plays), pausedPlayCount);
  assert.ok(endedReplay >= initialDialoguePlay + 2);
  passed('specific dialogue repeats after monitored boundary and ended events, while pause cancels pending replay');

  await page.locator('[data-stage="dictation"]').click();
  await page.locator('#dictation-answer').fill('We can play games and take turns today.');
  await page.getByRole('button', { name: '받아쓰기 확인', exact: true }).click();
  await page.locator('#word-selection').waitFor();

  const tokens = page.locator('.phrase-token');
  await tokens.nth(1).click(); await tokens.nth(2).click();
  await page.getByRole('button', { name: '선택한 단어를 표현으로 묶기', exact: true }).click();
  assert.equal(await page.locator('.phrase-option[aria-pressed="true"]').count(), 1);
  assert.equal(await page.locator('.phrase-token[aria-pressed="true"]').count(), 0);
  assert.equal(await page.getByRole('button', { name: '선택한 단어를 표현으로 묶기', exact: true }).isDisabled(), true);
  await tokens.nth(5).click(); await tokens.nth(6).click();
  await page.getByRole('button', { name: '선택한 단어를 표현으로 묶기', exact: true }).click();
  assert.equal(await page.locator('.phrase-option[aria-pressed="true"]').count(), 2);
  assert.match(await page.locator('.phrase-builder .helper').innerText(), /현재 선택한 숙어·표현 2개/);
  await tokens.nth(1).click(); await tokens.nth(2).click();
  await page.getByRole('button', { name: '선택한 단어를 표현으로 묶기', exact: true }).click();
  assert.equal(await page.locator('.phrase-option[aria-pressed="true"]').count(), 2);
  assert.match(await page.locator('.phrase-builder .helper').innerText(), /현재 선택한 숙어·표현 2개/);
  await tokens.nth(1).click(); await tokens.nth(2).click(); await tokens.nth(3).click();
  await page.getByRole('button', { name: '선택한 단어를 표현으로 묶기', exact: true }).click();
  assert.equal(await page.locator('.phrase-option[aria-pressed="true"]').count(), 3);
  assert.deepEqual(new Set(await page.locator('.selection-chip').allInnerTexts()), new Set(['can play', 'take turns', 'can play games']));
  await page.locator('.phrase-option').filter({ hasText: /^can play games$/ }).click();
  assert.equal(await page.locator('.phrase-option[aria-pressed="true"]').count(), 2);
  await page.locator('#next-action').click();
  await expectMode('explain');
  const phraseQueue = await page.locator('.word-queue button').allInnerTexts();
  assert.ok(phraseQueue.some(text => text.includes('can play')));
  assert.ok(phraseQueue.some(text => text.includes('take turns')));
  const savedPhrases = await page.evaluate(() => JSON.parse(localStorage.getItem('wordtrail:guest:v1')).dictations
    .find(record => record.reference.startsWith('We can play')).selectedKeys);
  assert.deepEqual(savedPhrases.sort(), ['word:can play', 'word:take turns']);
  passed('repeated and overlapping phrase creation preserves separate selections and saves the chosen two');

  await page.locator('.return-video').click();
  await page.locator('[data-stage="dictation"]').click();
  assert.equal(await page.locator('#dictation-answer').inputValue(), '');
  const storedFirstAnswer = await page.evaluate(() => JSON.parse(localStorage.getItem('wordtrail:guest:v1')).dictations
    .find(record => record.reference.startsWith('We can play'))?.answer);
  assert.equal(storedFirstAnswer, 'We can play games and take turns today.');
  passed('returning to a saved attempt starts with a blank dictation while preserving stored history');

  const wordFormsChapter = page.locator('.chapter-section').nth(1);
  if (!(await wordFormsChapter.getAttribute('open'))) await wordFormsChapter.locator('summary').click();
  await page.locator('.scene-button').nth(1).click();
  await page.locator('#load-play-button').click();
  await finishCurrentPlayback();
  await page.locator('#stage-nav').waitFor();
  await page.locator('[data-stage="dictation"]').click();
  await page.locator('#dictation-answer').fill('She felt excited about her goals.');
  await page.getByRole('button', { name: '받아쓰기 확인', exact: true }).click();
  await page.locator('#word-selection').waitFor();
  await page.locator('.select-word').filter({ hasText: /^excited$/ }).click();
  await page.locator('.select-word').filter({ hasText: /^goals$/ }).click();
  await page.locator('#next-action').click();
  await expectMode('explain');
  const queue = await page.locator('.word-queue button').allInnerTexts();
  assert.ok(queue.some(text => /excite/.test(text)));
  assert.ok(queue.some(text => /goal/.test(text)));
  assert.equal(queue.some(text => /excited|goals/.test(text)), false);
  assert.match(await page.locator('.workspace-header .helper').innerText(), /원문: excited → 공부할 원형: excite/);
  passed('surface forms excited and goals become study headwords excite and goal');

  await page.locator('.english-definition').getByText('To make someone feel very enthusiastic and eager.', { exact: true }).waitFor();
  await page.locator('.korean-definition').filter({ hasText: '누군가를 매우 신나고 기대하게 만들다' }).waitFor();
  await page.locator('.related-words').filter({ hasText: 'excitement' }).waitFor();
  const definitionOrder = await page.locator('.knowledge-summary > section').evaluateAll(sections => sections.map(node => [...node.classList]));
  assert.equal(definitionOrder[0].includes('english-definition'), true);
  assert.equal(definitionOrder[1].includes('korean-meaning'), true);
  assert.equal(definitionOrder[2].includes('knowledge-example'), true);
  assert.equal(await page.getByText('GPT-5.4 AI 뜻풀이', { exact: true }).count(), 0);
  assert.equal(aiTerms.filter(term => term === 'excite').length, 1);
  await waitForObserved(() => aiTerms.includes('goal'), 'the next word was not prefetched before navigation');
  const goalCallsBeforeNavigation = aiTerms.filter(term => term === 'goal').length;
  passed('one AI package renders English, Korean, example, and related words in a clear order without a GPT label');

  const modes = await page.locator('.workspace-modes button').evaluateAll(buttons => buttons.map(button => button.dataset.mode));
  assert.deepEqual(modes, ['explain', 'point', 'spelling', 'audio', 'cloze', 'meaning', 'family', 'reading']);
  assert.equal(modes.indexOf('family') + 1, modes.indexOf('reading'));
  passed('current word flow exposes eight modes with family review immediately before reading');

  await chooseMode('spelling');
  await page.locator('.view:visible .answer-form input').pressSequentially('g');
  await page.waitForFunction(() => window.__speech.length > 0);
  assert.equal(await page.evaluate(() => window.__speech.at(-1)), 'gee');
  assert.equal(await page.evaluate(() => window.__speech.some(text => /\b(?:capital|letter)\b/i.test(text))), false);
  passed('spelling speaks the ordinary alphabet name without capital or letter prefixes');

  await chooseMode('cloze');
  await page.locator('.auto-advance input').uncheck();
  assert.equal((await page.locator('.cloze-sentence').innerText()).includes('excited'), false);
  await submitWorkspace('excite');
  await page.locator('.answer-feedback.incorrect').waitFor();
  assert.match(await page.locator('.answer-feedback').innerText(), /정답은 excited/);
  await page.getByRole('button', { name: '다시 해보기', exact: true }).click();
  await submitWorkspace('excited');
  await page.locator('.answer-feedback.correct').waitFor();
  assert.equal(await activeMode(), 'cloze');
  passed('cloze masks the source form and accepts excited while rejecting the lemma excite');

  await page.locator('.word-queue button').filter({ hasText: /goal/ }).click();
  await expectMode('explain');
  assert.equal(aiTerms.filter(term => term === 'goal').length, goalCallsBeforeNavigation);
  await page.locator('.english-definition').getByText('An aim or desired result.', { exact: true }).waitFor();
  await page.locator('.korean-definition').filter({ hasText: '목표 또는 원하는 결과' }).waitFor();
  await chooseMode('cloze');
  await page.locator('.auto-advance input').uncheck();
  await submitWorkspace('goal');
  await page.locator('.answer-feedback.incorrect').waitFor();
  assert.match(await page.locator('.answer-feedback').innerText(), /정답은 goals/);
  await page.getByRole('button', { name: '다시 해보기', exact: true }).click();
  await submitWorkspace('goals');
  await page.locator('.answer-feedback.correct').waitFor();
  passed('goal studies as the lemma while its source cloze validates the plural goals');

  await chooseMode('family');
  await page.locator('.family-review').waitFor();
  assert.match(await page.locator('.family-review').innerText(), /goal/);
  await page.screenshot({ path: `${out}desktop-family.png`, fullPage: true });
  await assertNoOverflow(1440);
  passed('desktop family review screenshot has no horizontal overflow');

  await page.setViewportSize({ width: 390, height: 844 });
  await assertNoOverflow(390);
  await page.screenshot({ path: `${out}mobile-390-family.png`, fullPage: true });
  assert.ok(await page.locator('.return-video').isVisible());
  passed('390px family review screenshot has no horizontal overflow and keeps return navigation visible');

  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.locator('.return-video').click();
  await page.locator('.scene-button').nth(2).click();
  await page.locator('#load-play-button').click();
  await finishCurrentPlayback();
  await page.locator('[data-stage="dictation"]').click();
  await page.locator('#dictation-answer').fill('Once upon a time, a dragon found a garden.');
  await page.getByRole('button', { name: '받아쓰기 확인', exact: true }).click();
  await page.locator('#word-selection').waitFor();
  for (let index = 0; index < 4; index++) await page.locator('.phrase-token').nth(index).click();
  await page.getByRole('button', { name: '선택한 단어를 표현으로 묶기', exact: true }).click();
  await page.locator('.select-word').filter({ hasText: /^dragon$/ }).click();
  await page.locator('#next-action').click();
  await expectMode('explain');
  await waitForObserved(() => aiTerms.includes('once upon a time') && aiTerms.includes('dragon'), 'the two selected terms were not prefetched');
  const onceCallsBeforeNavigation = aiTerms.filter(term => term === 'once upon a time').length;
  const dragonCallsBeforeNavigation = aiTerms.filter(term => term === 'dragon').length;
  await page.locator('.word-queue button').filter({ hasText: /Once upon a time/i }).click();
  await expectMode('explain');
  assert.equal(aiTerms.filter(term => term === 'once upon a time').length, onceCallsBeforeNavigation);
  await page.locator('.english-definition').getByText('At an unspecified time in the past, used to begin a story.', { exact: true }).waitFor();
  assert.match(await page.locator('.korean-definition').innerText(), /옛날 옛적에/);
  await page.locator('.related-words').filter({ hasText: 'long ago' }).waitFor();
  assert.equal(aiTerms.filter(term => term === 'once upon a time').length, 1);
  assert.equal(await page.locator('.english-definition a').count(), 0);
  await page.screenshot({ path: `${out}ai-meaning-desktop.png`, fullPage: true });
  passed('one idiom API call supplies English, Korean, example, and related-expression content');

  await page.locator('.word-queue button').filter({ hasText: /dragon/ }).click();
  await expectMode('explain');
  assert.equal(aiTerms.filter(term => term === 'dragon').length, dragonCallsBeforeNavigation);
  await page.locator('.english-definition').getByText('A large imaginary creature often shown with wings and fire.', { exact: true }).waitFor();
  const dragonRelated = page.locator('.related-words');
  await dragonRelated.filter({ hasText: 'dragons' }).waitFor();
  assert.match(await dragonRelated.innerText(), /draconic/);
  assert.doesNotMatch(await dragonRelated.innerText(), /dragon(?:ize|ify)|verb form/i);
  await chooseMode('family');
  const dragonFamily = page.locator('.family-review');
  await dragonFamily.filter({ hasText: 'mythical creature' }).waitFor();
  assert.match(await dragonFamily.innerText(), /dragons/);
  assert.match(await dragonFamily.innerText(), /draconic/);
  assert.doesNotMatch(await dragonFamily.innerText(), /dragon(?:ize|ify)|verb form/i);
  assert.equal(aiTerms.filter(term => term === 'dragon').length, 1);
  passed('dragon reuses its single prefetched package for explain and family views without an invented verb');
  await page.locator('#account-button').click();
  await page.locator('#account-dialog details summary').click();
  await page.locator('#ai-usage-button').click();
  await page.locator('#ai-usage-output').getByText('key-2', { exact: true }).waitFor();
  assert.match(await page.locator('#ai-usage-output').innerText(), /사용 40 · 예약 0 · 남음 999,960/);
  await page.screenshot({ path: `${out}ai-usage-desktop.png`, fullPage: true });
  passed('account usage panel displays safe key aliases and used, reserved, remaining tokens');

  assert.deepEqual(errors, []);
  passed('browser JavaScript and console errors: 0');
  await writeFile(`${out}results.json`, JSON.stringify({
    date: new Date().toISOString(), base, checks, errors, dictionaryTerms, translationQueries, aiTerms,
    evidence: 'YouTube, speech, dictionary, AI, usage, translation, and clipboard were deterministic browser mocks; downloads used the real browser download flow; no live external service claim.'
  }, null, 2));
} catch (error) {
  await page.screenshot({ path: `${out}failure.png`, fullPage: true });
  await writeFile(`${out}failure.txt`, `${error.stack || error}\n\n${await page.locator('body').innerText().catch(() => '')}\n`);
  throw error;
} finally {
  await browser.close();
}
