import assert from 'node:assert/strict';
import test from 'node:test';

import { canRefreshYoutubeMetadata, normalizeYoutubeChapters, youtubeMetadataEntry } from '../scripts/refresh-youtube-chapters.mjs';

test('YouTube chapter metadata is normalized with explicit provenance', () => {
  const entry = youtubeMetadataEntry({
    id: 'MnFue5zu454', title: 'Season 3 Full Episodes', duration: 1586,
    chapters: [
      { start_time: 0, end_time: 380, title: 'Mini Bluey' },
      { start_time: 380, end_time: 825, title: 'Pass the Parcel' },
      { start_time: 825, end_time: 1586, title: 'Pizza Girls' },
    ],
  }, '2026-10-06T00:00:00.000Z');
  assert.equal(entry.status, 'youtube-metadata-verified');
  assert.equal(entry.expectedChapterCount, 3);
  assert.deepEqual(entry.chapters.map(({ title, markerStart, sourceEnd, source }) => ({ title, markerStart, sourceEnd, source })), [
    { title: 'Mini Bluey', markerStart: 0, sourceEnd: 380, source: 'youtube-chapter' },
    { title: 'Pass the Parcel', markerStart: 380, sourceEnd: 825, source: 'youtube-chapter' },
    { title: 'Pizza Girls', markerStart: 825, sourceEnd: 1586, source: 'youtube-chapter' },
  ]);
});

test('malformed or discontinuous YouTube chapters are rejected as a set', () => {
  assert.deepEqual(normalizeYoutubeChapters(null, 100), []);
  assert.deepEqual(normalizeYoutubeChapters([{ start_time: 0, end_time: 50, title: '' }], 100), []);
  assert.deepEqual(normalizeYoutubeChapters([
    { start_time: 0, end_time: 50, title: 'One' },
    { start_time: 51, end_time: 100, title: 'Two' },
  ], 100), []);
});

test('automated refresh cannot replace browser-visible or manually confirmed chapters', () => {
  assert.equal(canRefreshYoutubeMetadata(undefined), true);
  assert.equal(canRefreshYoutubeMetadata({ status: 'youtube-metadata-verified' }), true);
  assert.equal(canRefreshYoutubeMetadata({ status: 'browser-visible-youtube-auto-chapters' }), false);
  assert.equal(canRefreshYoutubeMetadata({ status: 'partial-user-confirmed' }), false);
});
