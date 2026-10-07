import test from 'node:test';
import assert from 'node:assert/strict';
import { parseTimedText, compileCustomVideo } from '../public/lib/custom-video.js';
const video = { youtubeId: 'rKgtm81yi94', url: 'https://www.youtube.com/watch?v=rKgtm81yi94', title: 'TED', duration: 60, topics: ['과학'], chapters: [{ title: 'Intro', startSeconds: 0 }, { title: 'Movement', startSeconds: 30 }], transcript: '0:00 Hello everyone.\n0:30 Move your body.', createdAt: '2026-10-06T00:00:00Z', id: 'video:rKgtm81yi94' };
test('custom videos retain source and map timed dialogue to each chapter', () => {
  const data = compileCustomVideo(video);
  assert.equal(data.id, 'custom-rKgtm81yi94');
  assert.deepEqual(data.chapters.map(c => c.sceneIds), [['c0001'], ['c0002']]);
  assert.deepEqual(data.scenes.map(s => [s.start, s.end]), [[0, 30], [30, 60]]);
  assert.equal(compileCustomVideo({ ...video, title: 'Renamed' }).contentVersion, data.contentVersion);
  assert.notEqual(compileCustomVideo({ ...video, transcript: '0:00 Changed.\n0:30 Move your body.' }).contentVersion, data.contentVersion);
});
test('invalid timing fails before a video is saved', () => {
  for (const text of ['Hello', '0:60 hello', '0:10 first\n0:05 next', '1:00 too late']) assert.throws(() => parseTimedText(text, 60));
  assert.deepEqual(parseTimedText('1:02:03 hello', 4000), [{ start: 3723, text: 'hello' }]);
});

test('custom chapters honor explicit ends and keep each scene inside its chapter', () => {
  const data = compileCustomVideo({ ...video, transcript: '0:00 Intro.\n0:20 Between chapters.\n0:30 Main lesson.', chapters: [{ title: 'Intro', startSeconds: 0, endSeconds: 20 }, { title: 'Main', startSeconds: 30 }] });
  assert.deepEqual(data.chapters.map(c => [c.start, c.end]), [[0, 20], [20, 30], [30, 60]]);
  for (const chapter of data.chapters) for (const id of chapter.sceneIds) {
    const scene = data.scenes.find(s => s.id === id);
    assert.ok(scene.start >= chapter.start && scene.end <= chapter.end);
  }
  assert.throws(() => compileCustomVideo({ ...video, chapters: [{ title: 'Intro', startSeconds: 0, endSeconds: 20 }, { title: 'Main', startSeconds: 30 }] }), /대본 줄/);
  const snapped = compileCustomVideo({ ...video, chapters: [{ title: 'Intro', startSeconds: 0 }, { title: 'Main', startSeconds: 35 }] });
  assert.equal(snapped.chapters[1].start, 30);
  assert.equal(snapped.chapters[1].markerStart, 35);
});
