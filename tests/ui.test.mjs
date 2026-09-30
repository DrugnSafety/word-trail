import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { availableStages, canEnterStage, canNavigateSource, canResumeScene, clearUiState, clozeParts, createKeyedQueue, createSingleFlight, CURRENT_CONTENT_VERSION, durationBucket, filterCatalog, filterVocabulary, isCompletedWord, isVocabularyWord, makeProgress, meaningQuizAvailable, savedDictationComparison, scopedStorageKey, secondsLabel, selectableScenes, sentenceWordRanges, sourceVideoId, STAGES, updateMistakeWord, vocabularyAttemptCount } from '../public/app.js';
import { registerPractice } from '../public/lib/vocabulary.js';

test('catalog search and duration filtering are independent', () => {
  const videos = [
    { id: 'a', title: 'Faceytalk', duration: 420 },
    { id: 'b', title: 'Long Family Collection', duration: 1500 }
  ];
  assert.deepEqual(filterCatalog(videos, 'FACEY', 'all').map((video) => video.id), ['a']);
  assert.deepEqual(filterCatalog(videos, '', 'short').map((video) => video.id), ['a']);
  assert.deepEqual(filterCatalog(videos, 'family', 'long').map((video) => video.id), ['b']);
  assert.equal(durationBucket(600), 'short');
  assert.equal(durationBucket(601), 'long');
});

test('cloze uses the exact target substring, including multiword expressions', () => {
  const quote = 'Mum, can we do Faceytalk with Muffin?';
  const start = quote.indexOf('can we');
  assert.deepEqual(clozeParts({ quote, matchStart: start, matchEnd: start + 'can we'.length }), {
    before: 'Mum, ', answer: 'can we', after: ' do Faceytalk with Muffin?'
  });
  assert.equal(clozeParts({ quote, matchStart: -1, matchEnd: 2 }), null);
  assert.equal(clozeParts({ quote, matchStart: 5, matchEnd: 200 }), null);
});

test('typing success does not promote reading status', () => {
  const now = new Date('2026-09-25T12:00:00Z');
  const base = { video: { id: 'v1', contentVersion: '1' }, scene: { id: 's1' }, target: { expressionId: 'can-we' } };
  const spelling = makeProgress({ ...base, answer: 'can we', correct: true, hints: 1, now });
  assert.equal(spelling.spelling.correct, true);
  assert.equal(spelling.reading.result, null);
  assert.equal(spelling.review.dueAt, null);
  const reading = makeProgress({ ...base, previous: spelling, readingResult: 'independent', now });
  assert.equal(reading.reading.result, 'independent');
  assert.equal(reading.review.dueAt, '2026-09-26T12:00:00.000Z');
  assert.equal(reading.spelling.attempts, 1);
});

test('format helpers cover source links and video time', () => {
  assert.equal(sourceVideoId('https://www.youtube.com/watch?v=kx8_wF9HOX8'), 'kx8_wF9HOX8');
  assert.equal(sourceVideoId('https://youtu.be/kx8_wF9HOX8'), 'kx8_wF9HOX8');
  assert.equal(sourceVideoId('https://youtube.com.evil.test/watch?v=kx8_wF9HOX8'), '');
  assert.equal(sourceVideoId('javascript:alert(1)'), '');
  assert.equal(sourceVideoId('http://www.youtube.com/watch?v=kx8_wF9HOX8'), '');
  assert.equal(sourceVideoId('https://www.youtube.com/watch?v=too-short'), '');
  assert.equal(sourceVideoId('not a url'), '');
  assert.equal(secondsLabel(419.8), '6:59');
  assert.deepEqual(STAGES, ['listen', 'dictation', 'workspace']);
});

test('all selectable cue scenes remain available even without expression-bank targets', () => {
  const video = { contentVersion: CURRENT_CONTENT_VERSION, scenes: [
    { id: 'c0001', selectable: true, targets: [{ expressionId: 'please' }] },
    { id: 'c0002', selectable: true, targets: [] },
    { id: 'c0003', selectable: false, targets: [{ expressionId: 'music' }] }
  ] };
  assert.deepEqual(selectableScenes(video).map((scene) => scene.id), ['c0001', 'c0002']);
  assert.equal(canResumeScene({ sceneId: 'c0002', contentVersion: CURRENT_CONTENT_VERSION }, video), true);
  assert.equal(canResumeScene({ sceneId: 'c0003', contentVersion: CURRENT_CONTENT_VERSION }, video), false);
  assert.equal(canResumeScene({ sceneId: 's001', contentVersion: '2026.09.25-1' }, video), false);
  assert.equal(canResumeScene({ sceneId: 'c0001', contentVersion: '2026.09.25-1' }, video), false);
});

test('sentence highlighting keeps curly apostrophes inside words and treats hyphens as boundaries', () => {
  assert.deepEqual(sentenceWordRanges("Mum’s well-known idea").map(({ text, start, end }) => ({ text, start, end })), [
    { text: 'Mum’s', start: 0, end: 5 },
    { text: 'well', start: 6, end: 10 },
    { text: 'known', start: 11, end: 16 },
    { text: 'idea', start: 17, end: 21 }
  ]);
  assert.deepEqual(sentenceWordRanges("weʼre rock‘n’roll").map(({ text }) => text), ["weʼre", 'rock‘n’roll']);
  assert.deepEqual(sentenceWordRanges('ﬁne work').map(({ text, start, end }) => ({ text, start, end })), [
    { text: 'ﬁne', start: 0, end: 3 },
    { text: 'work', start: 4, end: 8 }
  ]);
});

test('old progress never navigates to a new cue by matching its position', () => {
  assert.equal(canNavigateSource({ sceneId: 's001', contentVersion: '2026.09.25-1' }), false);
  assert.equal(canNavigateSource({ sceneId: 'c0001', contentVersion: '2026.09.25-1' }), false);
  assert.equal(canNavigateSource({ sceneId: 'c0001', contentVersion: CURRENT_CONTENT_VERSION }), true);
});

test('answer-bearing stages unlock only after a matching scene dictation is saved', () => {
  const base = { videoId: 'v1', sceneId: 'c0001', contentVersion: CURRENT_CONTENT_VERSION, hasTargets: true };
  assert.deepEqual(availableStages({ ...base, dictations: [] }), ['listen', 'dictation']);
  assert.equal(canEnterStage('words', { ...base, dictations: [{ ...base, contentVersion: 'old' }] }), false);
  assert.equal(canEnterStage('cloze', { ...base, dictations: [{ ...base, sceneId: 'c0002' }] }), false);
  const matching = [{ videoId: 'v1', sceneId: 'c0001', contentVersion: CURRENT_CONTENT_VERSION }];
  assert.deepEqual(availableStages({ ...base, dictations: matching }), STAGES);
  assert.deepEqual(availableStages({ ...base, dictations: matching, hasTargets: false }), ['listen', 'dictation', 'workspace']);
});

test('word study only marks a mistake studied after a correct saved answer', () => {
  const word = { key: 'missing:please', term: 'Please', studied: false, studyAttempts: 0, lastAnswer: '' };
  const wrong = updateMistakeWord(word, 'plese', false);
  assert.deepEqual({ studied: wrong.studied, attempts: wrong.studyAttempts, answer: wrong.lastAnswer }, { studied: false, attempts: 1, answer: 'plese' });
  const correct = updateMistakeWord(wrong, 'please', true);
  assert.deepEqual({ studied: correct.studied, attempts: correct.studyAttempts, answer: correct.lastAnswer }, { studied: true, attempts: 2, answer: 'please' });
});

test('legacy unpracticed words remain visible without exposing modern transient mistakes', () => {
  const word = { key: 'word:mum', term: 'Mum', kind: 'replace', studied: false, studyAttempts: 0 };
  assert.equal(isVocabularyWord({}, word), true);
  assert.equal(isVocabularyWord({ selectedKeys: [] }, word), false);
  assert.equal(isVocabularyWord({ selectedKeys: [] }, { ...word, registeredAt: '2026-09-25T12:00:00.000Z' }), true);
  assert.equal(isVocabularyWord({}, { ...word, kind: 'extra' }), false);
});

test('legacy practice counts survive records without per-mode practice data', () => {
  assert.equal(vocabularyAttemptCount({ studyAttempts: 2 }), 2);
  assert.equal(vocabularyAttemptCount({ studyAttempts: 2, practice: { spelling: { attempts: 1 } } }), 2);
  assert.equal(vocabularyAttemptCount({ studyAttempts: 1, practice: { spelling: { attempts: 2 }, reading: { attempts: 3 } } }), 5);
});

test('completed words require saved independent reading, survive reload, and remain available for review', () => {
  const word = { key: 'word:please', term: 'Please' };
  const spelled = registerPractice(word, 'spelling', 'please', true);
  const helped = registerPractice(spelled, 'reading', 'helped', false);
  assert.equal(isCompletedWord(spelled), false);
  assert.equal(isCompletedWord(helped), false);
  assert.equal(isCompletedWord({ studied: true }), false);
  const complete = JSON.parse(JSON.stringify(registerPractice(helped, 'reading', 'independent', true)));
  assert.equal(isCompletedWord(complete), true);
  assert.equal(isCompletedWord(registerPractice(complete, 'reading', 'helped', false)), true);
  const entries = [{ record: { contentVersion: '2026.09.25-3' }, word: complete }, { record: {}, word: helped }];
  assert.deepEqual(filterVocabulary(entries, 'completed'), [entries[0]]);
  assert.deepEqual(filterVocabulary(entries, 'learning'), [entries[1]]);
  assert.equal(filterVocabulary(entries), entries);
  assert.equal(canNavigateSource(entries[0].record), false);
});

test('meaning quiz rejects only an exact normalized answer token', () => {
  assert.equal(meaningQuizAvailable('Mum', 'Mum = 엄마'), false);
  assert.equal(meaningQuizAvailable('Mum', 'mum, 엄마'), false);
  assert.equal(meaningQuizAvailable('can', '할 수 있다'), true);
  assert.equal(meaningQuizAvailable('can', 'candy처럼 들리는 말'), true);
  assert.equal(meaningQuizAvailable('can', ''), false);
});

test('saved dictation restores its submitted answer and word comparison for reselection', () => {
  const reference = 'Mum, can we do Faceytalk please?';
  const restored = savedDictationComparison({ reference, answer: 'Mom can we do Faceytalk' }, reference);
  assert.ok(restored);
  assert.equal(restored.correct, false);
  assert.deepEqual(restored.words.filter((word) => word.kind !== 'equal').map((word) => word.kind), ['replace', 'missing']);
  assert.equal(savedDictationComparison({ reference: 'old sentence', answer: 'old answer' }, reference), null);
});

test('same-expression writes run in order and the later task sees fresh state', async () => {
  const queue = createKeyedQueue();
  const events = [];
  const shared = { spelling: false, reading: false };
  let releaseFirst;
  const gate = new Promise((resolve) => { releaseFirst = resolve; });
  const first = queue('v\0s\0e\0version', async () => {
    events.push('spelling:start');
    await gate;
    shared.spelling = true;
    events.push('spelling:end');
  });
  const second = queue('v\0s\0e\0version', async () => {
    events.push(`reading:sees-spelling-${shared.spelling}`);
    shared.reading = true;
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(events, ['spelling:start']);
  releaseFirst();
  await Promise.all([first, second]);
  assert.deepEqual(events, ['spelling:start', 'spelling:end', 'reading:sees-spelling-true']);
  assert.deepEqual(shared, { spelling: true, reading: true });
});

test('different record keys do not block each other', async () => {
  const queue = createKeyedQueue();
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const events = [];
  const first = queue('sentence-a', async () => { events.push('a:start'); await gate; events.push('a:end'); });
  const second = queue('sentence-b', async () => { events.push('b:done'); });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(events, ['a:start', 'b:done']);
  release(); await Promise.all([first, second]);
});

test('single-flight reading guard ignores a second tap while the first save is pending', async () => {
  const run = createSingleFlight(); let release; let calls = 0;
  const gate = new Promise((resolve) => { release = resolve; });
  const first = run(async () => { calls += 1; await gate; });
  const second = await run(async () => { calls += 1; });
  assert.equal(second, false); assert.equal(calls, 1);
  release(); assert.equal(await first, true);
  assert.equal(await run(async () => { calls += 1; }), true); assert.equal(calls, 2);
});

test('UI state and correction keys are isolated by account', () => {
  assert.notEqual(scopedStorageKey('wordtrail:ui:v1', 'user-a'), scopedStorageKey('wordtrail:ui:v1', 'user-b'));
  assert.equal(scopedStorageKey('wordtrail:ui:v1', 'guest'), 'wordtrail:ui:v1:guest');
  assert.equal(scopedStorageKey('notes', 'unsafe/user'), 'notes:unsafe_user');
});

test('progress reset clears only the active account resume key', () => {
  const removed = [];
  assert.equal(clearUiState('user-a', { removeItem(key) { removed.push(key); } }), true);
  assert.deepEqual(removed, ['wordtrail:ui:v1:user-a']);
  assert.equal(clearUiState('user-b', { removeItem() { throw new Error('storage unavailable'); } }), false);
});

test('listen panel contains no answer-bearing static DOM', async () => {
  const html = await fs.readFile(new URL('../public/index.html', import.meta.url), 'utf8');
  const listenTemplate = html.match(/<div id="practice-panel"[\s\S]*?<\/div>\s*<div class="practice-footer">/)?.[0] || '';
  assert.ok(listenTemplate.includes('id="practice-panel"'));
  assert.doesNotMatch(listenTemplate, /expression-term|cloze-sentence|dialogue-card|tracking-sentence/);
  const css = await fs.readFile(new URL('../public/styles.css', import.meta.url), 'utf8');
  assert.match(css, /button\s*\{\s*min-height:\s*44px/);
  assert.match(css, /prefers-reduced-motion/);
  assert.match(css, /\.mistake-button strong, \.mistake-button small \{ display: block; \}/);
  const app = await fs.readFile(new URL('../public/app.js', import.meta.url), 'utf8');
  assert.match(app, /기록을 저장하지 못했어요/);
  assert.match(app, /clearForAccountTransition\(session, nextScope\)/);
  assert.match(app, /scope !== accountScope\(\) \|\| scope !== activeScope/);
  assert.match(app, /review-list'\)\.replaceChildren\(\)/);
  assert.match(app, /saveProgress\(record, previous\?\.updatedAt \|\| null, expectedScope\)/);
  assert.match(app, /saveDictation\(record, previous\?\.updatedAt \|\| null, scope\)/);
  assert.match(app, /saveDictation\(updated, latest\.updatedAt \|\| null, scope\)/);
  assert.match(app, /store\.startLearning\(videoId, scene\.id, scope\)/);
  assert.match(app, /store\.startLearning\(state\.video\.id, scene\.id, scope\)/);
  assert.match(app, /store\.setNickname\(nextNickname, scope\)/);
  assert.match(app, /store\.exportData\(scope\)/);
  assert.match(app, /const selectedKeys = \[\.\.\.state\.selectionDraft\][\s\S]{0,500}commitSelection\(latest, selectedKeys/);
  assert.match(app, /state\.selectionDraft = new Set\(dictationFor\([\s\S]{0,140}\?\.selectedKeys \|\| \[\]\)/);
  assert.match(app, /auth\.confirmationStatus === 'returned'/);
  assert.match(app, /auth\.confirmationStatus === 'error'/);
  assert.doesNotMatch(app, /error_description/);
  assert.match(app, /if \(state\.dictationResult\) input\.value = dictationFor\(\)\?\.answer \|\| ''/);
  assert.match(app, /await store\.resetProgress\(scope\)[\s\S]{0,400}clearUiState\(scope\)[\s\S]{0,120}resetActiveLearning\(\)/);
  assert.match(app, /videoId !== state\.videoData\?\.id[\s\S]{0,160}contentVersion !== state\.videoData\?\.contentVersion/);
  assert.doesNotMatch(app, /뜻이나 출처를 만들어내지 않습니다|표현은행 설명이 없는 단어/);
  assert.match(app, /const bundle = selectedExportBundle\(\); if \(!bundle\.expressions\.length\)/);
  assert.match(app, /workspaceContextMatches\(context\)/);
  assert.match(app, /createLetterSpeaker\(playerStatus\)/);
  assert.doesNotMatch(html, /data-stage="(?:words|read|cloze|explain|card)"/);
  assert.match(css, /\.quiz-masked \.media-column/);
  assert.match(css, /\.library-quiz-active #word-list/);
  assert.match(html, /<details id="scene-list-panel" class="scene-list-panel" open>/);
  assert.match(css, /@media \(max-width: 1000px\)[\s\S]*\.learning-grid \{ grid-template-columns: 1fr; \}/);
});
