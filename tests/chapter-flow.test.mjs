import test from 'node:test';
import assert from 'node:assert/strict';
import { chapterForScene, restoredChapters, chapterRangeMatches } from '../public/app.js';
const video = { id: 'video-01', contentVersion: 'new', chapters: [
  { id: 'chapter-001', start: 26, end: 65, sceneIds: ['c0001', 'c0002'] },
  { id: 'chapter-002', start: 65, end: 104, sceneIds: ['c0003'] }
] };
test('dialogue selection resolves its containing chapter, including a chapter boundary', () => {
  assert.equal(chapterForScene(video, 'c0002').id, 'chapter-001');
  assert.equal(chapterForScene(video, 'c0003').id, 'chapter-002');
  assert.equal(chapterForScene(video, 'missing'), undefined);
});
test('chapter viewing history is scoped to video and content version, and ignores obsolete ids', () => {
  const saved = { videoId: video.id, contentVersion: 'new', watchedChapters: ['chapter-001', 'obsolete'] };
  assert.deepEqual([...restoredChapters(saved, video)], ['chapter-001']);
  assert.equal(restoredChapters({ ...saved, videoId: 'other' }, video).size, 0);
  assert.equal(restoredChapters({ ...saved, contentVersion: 'old' }, video).size, 0);
  assert.equal(restoredChapters({ ...saved, watchedChapters: 'bad' }, video).size, 0);
});
test('only the active chapter range from the same video can complete chapter viewing', () => {
  const chapter = video.chapters[0];
  const event = { videoId: 'youtube-id', start: 26, end: 65 };
  assert.equal(chapterRangeMatches(chapter, event, 'youtube-id'), true);
  assert.equal(chapterRangeMatches(chapter, { ...event, end: 34 }, 'youtube-id'), false);
  assert.equal(chapterRangeMatches(video.chapters[1], event, 'youtube-id'), false);
  assert.equal(chapterRangeMatches(chapter, event, 'another-video'), false);
  assert.equal(chapterRangeMatches(undefined, event, 'youtube-id'), false);
});
