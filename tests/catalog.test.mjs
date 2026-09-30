import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  CONTENT_VERSION,
  addTargets,
  alignCleanedCues,
  buildCatalog,
  buildOriginalCueGroups,
  groupDialogueCues,
  isNonSpeechAnnotation,
  parseScriptHeadings,
  parseTranscriptText,
  segmentCues,
  validateExpressionBank,
  validateVideo,
  youtubeVideoIdFromUrl,
} from '../scripts/build-catalog.mjs';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const expressionPath = path.join(rootDir, 'content/expressions.json');

test('transcript parser supports hour timestamps and rejects reversed cues', () => {
  const parsed = parseTranscriptText(`Title: Fixture\nVideo: https://youtu.be/test\nLength: 1:00:01\nCaptions: Fixture\n\n[59:59 - 1:00:01] Last line\n[00:05 - 00:04] Backwards\n[00:06 - 00:06] Zero`, 'fixture.txt');
  assert.equal(parsed.declaredDuration, 3601);
  assert.equal(parsed.cues.length, 2);
  assert.deepEqual(parsed.cues[0], { id: 'c0001', start: 3599, end: 3601, text: 'Last line', sourceLine: 6 });
  assert.equal(parsed.rejected.length, 1);
  assert.equal(parsed.rejected[0].reason, 'malformed-cue');
});

test('script headings retain their exact first-cue marker including hour timestamps', () => {
  assert.deepEqual(parseScriptHeadings(`# Video\n\n## Opening\n\n- \`[00:12 - 00:15]\` Hello.\n## Later\n- \`[1:02:03 - 1:02:05]\` Again.`), [
    { title: 'Opening', markerStart: 12 },
    { title: 'Later', markerStart: 3723 }
  ]);
});

test('source links accept only HTTPS YouTube watch or short URLs with valid IDs', () => {
  assert.equal(youtubeVideoIdFromUrl('https://www.youtube.com/watch?v=kx8_wF9HOX8'), 'kx8_wF9HOX8');
  assert.equal(youtubeVideoIdFromUrl('https://youtube.com/watch?v=kx8_wF9HOX8'), 'kx8_wF9HOX8');
  assert.equal(youtubeVideoIdFromUrl('https://youtu.be/kx8_wF9HOX8'), 'kx8_wF9HOX8');
  for (const unsafe of [
    'javascript:alert(1)',
    'http://www.youtube.com/watch?v=kx8_wF9HOX8',
    'https://youtube.com.evil.example/watch?v=kx8_wF9HOX8',
    'https://youtube.com@evil.example/watch?v=kx8_wF9HOX8',
    'https://www.youtube.com/embed/kx8_wF9HOX8',
    'https://www.youtube.com/watch?v=too-short',
    'https://www.youtube.com/watch?v=kx8_wF9HOX8&v=0uxmFpGFKyY',
  ]) assert.equal(youtubeVideoIdFromUrl(unsafe), null, unsafe);
});

test('video validation rejects an unsafe source URL before it can reach an app link', () => {
  assert.throws(() => validateVideo({ id: 'evil', sourceUrl: 'javascript:alert(1)', duration: 1, scenes: [] }, []), /invalid-youtube-source-url/);
});

test('zero-duration cleaned cues repair from every overlapping original reference', () => {
  const cleaned = parseTranscriptText('Title: T\nLength: 00:10\n\n[00:05 - 00:05] Hi!', 'clean.txt');
  const original = parseTranscriptText('Title: T\nLength: 00:10\n\n[00:04 - 00:06] - Oh! - Hi!\n[00:05 - 00:07] Hi again!', 'original.txt');
  const aligned = alignCleanedCues(cleaned, original);
  assert.equal(aligned.repairedZeroDuration, 1);
  assert.equal(aligned.excludedZeroDuration, 0);
  assert.equal(aligned.cues[0].start, 4);
  assert.equal(aligned.cues[0].end, 7);
  assert.equal(aligned.cues[0].originalCueRefs.length, 2);
  assert.ok(aligned.cues[0].qualityFlags.includes('zero-duration-repaired-from-original'));
});

test('zero-duration cue without source evidence is excluded honestly', () => {
  const cleaned = parseTranscriptText('Title: T\nLength: 00:10\n\n[00:05 - 00:05] Hi!', 'clean.txt');
  const original = parseTranscriptText('Title: T\nLength: 00:10\n\n[00:07 - 00:08] Later', 'original.txt');
  const aligned = alignCleanedCues(cleaned, original);
  assert.equal(aligned.cues.length, 0);
  assert.equal(aligned.excludedZeroDuration, 1);
  assert.equal(aligned.rejected[0].reason, 'zero-duration-without-original-overlap');
});

test('raw fallback removes non-spoken directions but preserves captured provenance', () => {
  const original = parseTranscriptText('Title: T\nLength: 00:16\n\n[00:01 - 00:03] (PHONE CHIMES) Okay, go.\n[00:03 - 00:05] [Trixie] Look, I will handle it.\n[00:05 - 00:07] (MUFFIN SQUEALS, STRIPE GRUNTS)\n[00:07 - 00:09] [Together] (GASP)!\n[00:09 - 00:11] (HUMS) [Bingo] Bluey!\n[00:11 - 00:13] [Muffin] (SCREAMS) [Stripe] Argh!\n[00:13 - 00:15] We made beeswax animals. [music]', 'original.txt');
  const cleaned = parseTranscriptText('Title: T\nLength: 00:10', 'cleaned.txt');
  const groups = buildOriginalCueGroups(original, cleaned);
  assert.equal(groups[0].text, 'Okay, go.');
  assert.equal(groups[0].originalText, '(PHONE CHIMES) Okay, go.');
  assert.ok(groups[0].qualityFlags.includes('raw-original-text'));
  assert.ok(groups[0].qualityFlags.includes('non-spoken-annotation-removed'));
  assert.equal(groups[0].originalCueRefs[0].text, '(PHONE CHIMES) Okay, go.');
  assert.equal(groups[1].text, 'Look, I will handle it.');
  const directionScene = segmentCues([groups[2]])[0];
  assert.equal(directionScene.selectable, false);
  assert.ok(directionScene.qualityFlags.includes('non-speech-cue'));
  const mixedDirectionScene = segmentCues([groups[3]])[0];
  assert.equal(mixedDirectionScene.selectable, false);
  assert.equal(isNonSpeechAnnotation('[Together] (GASP)!'), true);
  assert.equal(groups[4].text, 'Bluey!');
  assert.equal(groups[4].originalText, '(HUMS) [Bingo] Bluey!');
  assert.equal(groups[5].text, 'Argh!');
  assert.equal(groups[5].originalText, '[Muffin] (SCREAMS) [Stripe] Argh!');
  assert.equal(groups[6].text, 'We made beeswax animals.');
  assert.equal(groups[6].originalText, 'We made beeswax animals. [music]');
  assert.ok(groups.slice(4).every((group) => group.qualityFlags.includes('non-spoken-annotation-removed')));
});

test('each aligned cue becomes one short scene with its stable cue id and exact range', () => {
  const cues = [
    { id: 'c0001', start: 2, end: 4, text: 'First sentence.', originalCueRefs: [{ id: 'o1', start: 2, end: 4, text: 'First sentence.' }], qualityFlags: [] },
    { id: 'c0002', start: 4, end: 8, text: 'A brief second cue.', originalCueRefs: [{ id: 'o2', start: 4, end: 8, text: 'A brief second cue.' }], qualityFlags: [] },
  ];
  const scenes = segmentCues(cues);
  assert.equal(scenes.length, 2);
  assert.deepEqual(scenes.map((scene) => scene.id), ['c0001', 'c0002']);
  assert.deepEqual(scenes.map((scene) => [scene.start, scene.end]), [[2, 4], [4, 8]]);
  assert.deepEqual(scenes.map((scene) => scene.sentenceText), ['First sentence.', 'A brief second cue.']);
  assert.ok(scenes.every((scene) => scene.cues.length === 1));
  assert.ok(scenes.every((scene) => scene.selectable));
});

test('dialogue grouping targets 5 to 15 seconds, keeps explicit groups standalone, and preserves source atoms', () => {
  const cue = (id, start, end, text, qualityFlags = []) => ({
    id, start, end, text, originalText: text,
    originalCueRefs: [{ id: `o-${id}`, start, end, text }],
    cleanedCueRefs: [{ id: `x-${id}`, start, end, text }],
    textSource: 'cleaned-exact-coverage', groupingProvenance: id === 'c0001' ? 'parent-explicit-grouping' : 'original-captured-cue', qualityFlags
  });
  const grouped = groupDialogueCues([
    cue('c0001', 0, 5, 'Hello.', ['explicit-parent-grouping']),
    cue('c0002', 5, 10, 'How are you?'),
    cue('c0003', 10, 16, 'Fine.'),
    cue('c0004', 16, 22, 'Next.'),
    cue('c0005', 22, 31, 'The end.')
  ], [{ title: 'First', markerStart: 0 }, { title: 'Second', markerStart: 16 }], 'Fallback');
  assert.deepEqual(grouped.chapters.map(chapter => [chapter.id, chapter.title, chapter.start, chapter.end, chapter.source, chapter.sceneIds]), [
    ['chapter-001', 'First', 0, 16, 'script-heading', ['c0001', 'c0002', 'c0003']],
    ['chapter-002', 'Second', 16, 31, 'script-heading', ['c0004', 'c0005']]
  ]);
  assert.deepEqual(grouped.cues.map(item => [item.id, item.start, item.end, item.chapterId, item.paragraphIndex]), [
    ['c0001', 0, 5, 'chapter-001', 1],
    ['c0002', 5, 10, 'chapter-001', 2],
    ['c0003', 10, 16, 'chapter-001', 3],
    ['c0004', 16, 22, 'chapter-002', 1],
    ['c0005', 22, 31, 'chapter-002', 2]
  ]);
  assert.deepEqual(grouped.cues[0].sourceCueRefs.map(ref => ref.id), ['c0001']);
  assert.deepEqual(grouped.cues[0].originalCueRefs.map(ref => ref.id), ['o-c0001']);
  assert.ok(grouped.cues[0].qualityFlags.includes('explicit-parent-grouping'));
  assert.ok(grouped.cues.every(item => item.text.length <= 2000 && item.end - item.start <= 15));
});

test('a heading marker that straddles a source atom snaps the chapter range without losing the marker', () => {
  const cue = (id, start, end, text) => ({
    id, start, end, text, originalText: text,
    originalCueRefs: [{ id: `o-${id}`, start, end, text }], cleanedCueRefs: [],
    textSource: 'original-captured', groupingProvenance: 'original-captured-cue', qualityFlags: []
  });
  const grouped = groupDialogueCues([
    cue('c0001', 0, 8, 'Intro.'),
    cue('c0002', 8, 12, 'This episode begins.'),
    cue('c0003', 12, 25, 'The dialogue continues.')
  ], [{ title: 'Episode', markerStart: 10 }], 'Fallback');
  assert.deepEqual(grouped.chapters.map(chapter => [chapter.title, chapter.start, chapter.end, chapter.source, chapter.markerStart]), [
    ['도입부', 0, 8, 'whole-video', undefined],
    ['Episode', 8, 25, 'script-heading', 10]
  ]);
  assert.deepEqual(grouped.cues[1].sourceCueRefs.map(ref => ref.id), ['c0002']);
  assert.equal(grouped.cues[1].start, 8);
  assert.deepEqual(grouped.chapters[1].qualityFlags, ['chapter-boundary-snapped-to-caption']);
  assert.equal(grouped.chapters[1].snapSeconds, 2);
});

test('videos without script headings get one honestly labeled whole-video chapter', () => {
  const grouped = groupDialogueCues([{
    id: 'c0001', start: 2, end: 18, text: 'A complete dialogue.', originalText: 'A complete dialogue.',
    originalCueRefs: [{ id: 'o1', start: 2, end: 18, text: 'A complete dialogue.' }],
    cleanedCueRefs: [], textSource: 'original-captured', groupingProvenance: 'original-captured-cue', qualityFlags: []
  }], [], 'Captured video');
  assert.deepEqual(grouped.chapters, [{
    id: 'chapter-001', title: 'Captured video', start: 2, end: 18,
    source: 'whole-video', sceneIds: ['c0001']
  }]);
});

test('cue scenes sort chronologically while IDs remain tied to original cue records', () => {
  const cues = [
    { id: 'c0001', start: 85, end: 106, text: 'Later source row.', originalCueRefs: [{ id: 'o1', start: 85, end: 106, text: 'Later source row.' }], qualityFlags: [] },
    { id: 'c0002', start: 80, end: 88, text: 'Repaired row moved earlier.', originalCueRefs: [{ id: 'o2', start: 80, end: 88, text: 'Repaired row moved earlier.' }], qualityFlags: ['zero-duration-repaired-from-original'] },
    { id: 'c0003', start: 106, end: 110, text: 'Last row.', originalCueRefs: [{ id: 'o3', start: 106, end: 110, text: 'Last row.' }], qualityFlags: [] },
  ];
  const scenes = segmentCues(cues);
  assert.deepEqual(scenes.map((scene) => scene.id), ['c0002', 'c0001', 'c0003']);
  assert.deepEqual(scenes.map((scene) => scene.cues[0].id), ['c0002', 'c0001', 'c0003']);
  assert.deepEqual(scenes.map((scene) => [scene.start, scene.end]), [[80, 88], [85, 106], [106, 110]]);
});

test('a source-backed cue stays learnable when no expression-bank target matches', () => {
  const [scene] = addTargets(segmentCues([
    { id: 'c0042', start: 10, end: 12, text: 'Zibble wobble.', originalCueRefs: [{ id: 'o7', start: 10, end: 12, text: 'Zibble wobble.' }], qualityFlags: [] },
  ]), []);
  assert.equal(scene.id, 'c0042');
  assert.equal(scene.sentenceText, 'Zibble wobble.');
  assert.equal(scene.selectable, true);
  assert.deepEqual(scene.targets, []);
  assert.equal(validateVideo({ id: 'fixture', sourceUrl: 'https://youtu.be/kx8_wF9HOX8', duration: 12, scenes: [scene] }, []), true);
});

test('bracket-only non-speech cue is preserved but excluded from dictation', () => {
  const scenes = segmentCues([
    { id: 'c0051', start: 10, end: 12, text: '[music]', originalCueRefs: [{ id: 'o51', start: 10, end: 12, text: '[music]' }], qualityFlags: [] },
    { id: 'c0052', start: 12, end: 14, text: 'Hello!', originalCueRefs: [{ id: 'o52', start: 12, end: 14, text: 'Hello!' }], qualityFlags: [] },
  ]);
  assert.equal(scenes[0].id, 'c0051');
  assert.equal(scenes[0].selectable, false);
  assert.ok(scenes[0].qualityFlags.includes('non-speech-cue'));
  assert.equal(scenes[1].selectable, true);
  assert.equal(validateVideo({ id: 'fixture', sourceUrl: 'https://youtu.be/kx8_wF9HOX8', duration: 14, scenes }, []), true);
});

test('target selection prefers longer expressions and preserves exact offsets', () => {
  const scenes = segmentCues([{ id: 'c1', start: 0, end: 4, text: 'Please give me the red one.', originalCueRefs: [{ id: 'o1', start: 0, end: 4, text: 'Please give me the red one.' }], qualityFlags: [] }]);
  const expressions = [
    { id: 'give', term: 'give', aliases: [], difficulty: 'starter' },
    { id: 'give-me', term: 'give me', aliases: [], difficulty: 'everyday' },
  ];
  addTargets(scenes, expressions);
  assert.equal(scenes[0].targets[0].expressionId, 'give-me');
  const target = scenes[0].targets[0];
  assert.equal(target.quote.slice(target.matchStart, target.matchEnd), 'give me');
});

test('editorial expression bank has complete provenance and exactly two dialogues', async () => {
  const expressions = JSON.parse(await readFile(expressionPath, 'utf8'));
  assert.equal(validateExpressionBank(expressions), undefined);
  assert.ok(expressions.length >= 50 && expressions.length <= 90);
  for (const expression of expressions) {
    assert.equal(expression.dialogues.length, 2);
    assert.ok(expression.dialogues.every((dialogue) => dialogue.lines.length >= 2 && dialogue.provenance === 'original-editorial'));
    assert.ok(expression.aliases.every((alias) => alias.toLowerCase().replace(/[‘’]/g, "'") === expression.term.toLowerCase().replace(/[‘’]/g, "'")));
  }
});

test('expression validation rejects synonym aliases and dialogues without the card term', async () => {
  const expressions = JSON.parse(await readFile(expressionPath, 'utf8'));
  const unsafeAlias = structuredClone(expressions[0]);
  unsafeAlias.aliases = ['kindly'];
  assert.throws(() => validateExpressionBank([unsafeAlias]), /unsafe-alias/);

  const missingCardTerm = structuredClone(expressions[0]);
  missingCardTerm.dialogues[1].lines = [
    { speaker: 'A', en: 'Could you pass the pencil?', ko: '연필을 건네줄래?' },
    { speaker: 'B', en: 'Of course.', ko: '물론이지.' },
  ];
  assert.throws(() => validateExpressionBank([missingCardTerm]), /dialogue-missing-canonical-term/);
});

test('full build covers all 84 captured videos and matches committed deterministic data', async (t) => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'word-trail-catalog-'));
  t.after(() => rm(tempRoot, { recursive: true, force: true }));
  const outputDir = path.join(tempRoot, 'data');
  const reportPath = path.join(tempRoot, 'CATALOG_REPORT.json');
  const { catalog, report, expressions } = await buildCatalog({ rootDir, outputDir, reportPath, expressionPath });

  assert.equal(catalog.version, CONTENT_VERSION);
  assert.equal(catalog.videos.length, 84);
  assert.equal(report.coverage.videosWithLearningScenes, 84);
  assert.deepEqual(report.coverage.videosWithoutLearningScenes, []);
  assert.equal((await readdir(path.join(outputDir, 'videos'))).length, 84);
  const sourceVocabulary = JSON.parse(await readFile(path.join(rootDir, 'content/vocabulary.json'), 'utf8'));
  const generatedVocabulary = JSON.parse(await readFile(path.join(outputDir, 'vocabulary.json'), 'utf8'));
  assert.deepEqual(generatedVocabulary, sourceVocabulary);
  assert.equal(report.totals.repairedZeroDuration, 114);
  assert.equal(report.totals.excludedZeroDuration, 0);
  assert.ok(report.totals.nonSpeechCues >= 1);
  assert.equal(report.learningSceneDurations.targetSeconds, 5);
  assert.equal(report.learningSceneDurations.maximumSeconds, 15);
  assert.ok(report.learningSceneDurations.medianSeconds >= 5);
  assert.ok(report.learningSceneDurations.maxSeconds <= 15);
  assert.ok(report.learningSceneDurations.withinTargetCount > report.learningSceneDurations.belowTargetCount);

  for (const item of catalog.videos) {
    assert.ok(item.sceneCount > 0, `${item.id} has a learning scene`);
    const video = JSON.parse(await readFile(path.join(outputDir, 'videos', `${item.id}.json`), 'utf8'));
    assert.equal(validateVideo(video, expressions), true);
    assert.equal(video.scenes.filter((scene) => scene.selectable).length, item.sceneCount);
    assert.equal(video.chapters.length, item.chapterCount);
    assert.ok(video.chapters.every((chapter) => ['script-heading', 'whole-video', 'user-provided', 'partial-heading-fallback'].includes(chapter.source)));
    assert.deepEqual(video.chapters.flatMap((chapter) => chapter.sceneIds), video.scenes.map((scene) => scene.id));
    assert.ok(video.scenes.every((scene) => scene.selectable === (scene.cues[0].originalCueRefs.length > 0 && !scene.qualityFlags.includes('non-speech-cue'))));
    assert.ok(video.scenes.every((scene) => scene.id === scene.cues[0].id));
    assert.ok(video.scenes.every((scene) => scene.cues.length === 1 && scene.sentenceText === scene.cues[0].text));
    assert.ok(video.scenes.every((scene) => scene.end - scene.start <= 15));
    assert.ok(video.scenes.every((scene) => scene.sentenceText.length <= 2000));
    assert.ok(video.scenes.every((scene) => scene.chapterId && scene.paragraphIndex >= 1));
    assert.ok(video.scenes.every((scene) => !scene.selectable || !isNonSpeechAnnotation(scene.sentenceText)));
    assert.ok(video.scenes.every((scene) => !scene.selectable || !/\[[^\]]+\]/.test(scene.sentenceText)), `${item.id} has a selectable scene containing a bracket annotation`);
    const sourceAtomIds = video.scenes.flatMap((scene) => scene.cues[0].sourceCueRefs?.map((ref) => ref.id) || []);
    assert.equal(new Set(sourceAtomIds).size, sourceAtomIds.length, `${item.id} reuses or splits a source atom across scenes`);
  }

  const faceytalk = JSON.parse(await readFile(path.join(outputDir, 'videos/video-01.json'), 'utf8'));
  assert.deepEqual(faceytalk.scenes.slice(0, 4).map((scene) => ({
    id: scene.id,
    start: scene.start,
    end: scene.end,
    rawRanges: scene.cues[0].originalCueRefs.map((ref) => [ref.start, ref.end]),
  })), [
    { id: 'c0001', start: 26, end: 34, rawRanges: [[26, 29], [29, 31], [31, 32], [33, 34]] },
    { id: 'c0002', start: 33, end: 37, rawRanges: [[33, 37]] },
    { id: 'c0003', start: 37, end: 41, rawRanges: [[37, 39], [39, 41]] },
    { id: 'c0004', start: 41, end: 49, rawRanges: [[41, 43], [43, 46], [46, 48], [48, 49]] },
  ]);
  assert.match(faceytalk.scenes[0].sentenceText, /Uss!/);
  assert.doesNotMatch(faceytalk.scenes[1].sentenceText, /Uss!/);
  assert.deepEqual(faceytalk.scenes.slice(0, 4).map((scene) => scene.sentenceText), [
    "Mum, can we do Faceytalk with Muffin and Socks? Er… Please! Yeah, that's fine. Uss!",
    'But no hogging the little facey face thing, OK?',
    "Bluey, I'm talking to you. Yes, Mum. No hogging.",
    "Because you know what happens when you hog, don't you? Yes, we know what happens when you hog. Wait. Do we?! Hi!"
  ]);
  assert.ok(faceytalk.scenes.slice(0, 4).every((scene) => scene.qualityFlags.includes('explicit-parent-grouping')));
  assert.ok(faceytalk.scenes.slice(0, 2).every((scene) => scene.qualityFlags.includes('overlapping-playback-window')));
  assert.deepEqual(faceytalk.scenes.slice(0, 4).map((scene) => [scene.cues[0].sourceCueRefs[0].id, scene.cues[0].sourceCueRefs[0].originalCueIds]), [
    ['c0001', ['c0001', 'c0002', 'c0003', 'c0004']],
    ['c0002', ['c0005']],
    ['c0003', ['c0006', 'c0007']],
    ['c0004', ['c0008', 'c0009', 'c0010', 'c0011']]
  ]);
  assert.ok(faceytalk.scenes.slice(0, 4).every((scene) => !scene.qualityFlags.includes('duration-grouped-dialogue')));
  assert.equal(faceytalk.scenes.some((scene) => scene.start === 29 && scene.end === 30), false);
  assert.equal(faceytalk.scenes.some((scene) => scene.start === 30 && scene.end === 31), false);
  assert.deepEqual(faceytalk.chapters.slice(0, 2).map((chapter) => ({
    title: chapter.title,
    start: chapter.start,
    end: chapter.end,
    markerStart: chapter.markerStart,
    source: chapter.source,
    provenance: chapter.provenance
  })), [
    { title: 'Facey talk initiates', start: 26, end: 49, markerStart: 26, source: 'user-provided', provenance: 'user-provided-chapter-title-and-start' },
    { title: '목차 확인 중', start: 49, end: 404, markerStart: 49, source: 'partial-heading-fallback', provenance: 'unverified-remainder-boundary-after-confirmed-segments' }
  ]);
  assert.ok(faceytalk.chapters[0].sceneIds.every((id) => faceytalk.scenes.find((scene) => scene.id === id).end <= 49));
  assert.equal(faceytalk.chapters[0].coverage, 'confirmed-excerpt');
  assert.equal(faceytalk.chapterMetadataStatus, 'partial-user-confirmed');
  assert.equal(faceytalk.expectedChapterCount, 7);

  const compilation = JSON.parse(await readFile(path.join(outputDir, 'videos/video-02.json'), 'utf8'));
  assert.deepEqual(compilation.chapters.map((chapter) => [chapter.title, chapter.source]), [
    ['도입부', 'whole-video'],
    ['Mini Bluey', 'script-heading'],
    ['Pass the Parcel', 'script-heading'],
    ['Pizza Girls', 'script-heading'],
    ['FaceyTalk', 'script-heading']
  ]);
  assert.ok(compilation.scenes.every((scene) => compilation.chapters.some((chapter) => chapter.id === scene.chapterId && chapter.sceneIds.includes(scene.id))));

  const cubby = JSON.parse(await readFile(path.join(outputDir, 'videos/video-23.json'), 'utf8'));
  const cubbyChapter = cubby.chapters.find(chapter => chapter.source === 'script-heading');
  assert.equal(cubbyChapter.title, 'Cubby');
  assert.equal(cubbyChapter.capturedTitle, 'Puppy');
  assert.equal(cubbyChapter.titleSource, 'video-title');
  assert.equal(cubbyChapter.titleCorrectionReason, 'captured-heading-conflicts-with-video-title');
  assert.equal(cubbyChapter.markerStart, 43);
  assert.equal(cubbyChapter.start, 42);
  assert.ok(cubbyChapter.qualityFlags.includes('chapter-title-corrected-from-video-title'));
  assert.ok(cubby.qualityFlags.includes('contains-corrected-chapter-title'));

  const committedCatalog = JSON.parse(await readFile(path.join(rootDir, 'public/data/catalog.json'), 'utf8'));
  assert.deepEqual(catalog, committedCatalog);
  const committedVocabulary = JSON.parse(await readFile(path.join(rootDir, 'public/data/vocabulary.json'), 'utf8'));
  assert.deepEqual(committedVocabulary, sourceVocabulary);
});
