import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { buildAdditionalVideos, prepareAdditionalVideos } from '../scripts/build-additional-videos.mjs';

const prepared = {
  id: 'video:rKgtm81yi94',
  youtubeId: 'rKgtm81yi94',
  url: 'https://www.youtube.com/watch?v=rKgtm81yi94',
  title: 'Prepared lesson',
  durationSeconds: 60,
  topics: ['Science'],
  tags: ['movement'],
  transcript: '0:00 Hello everyone.\n0:30 Move your body.',
  chapters: [
    { title: 'Introduction', startSeconds: 0 },
    { title: 'Movement', startSeconds: 30 },
  ],
  createdAt: '2026-10-06T00:00:00Z',
  updatedAt: '2026-10-06T00:00:00Z',
  captionType: 'YouTube English captions (human-made)',
  transcriptProvenance: 'YouTube English caption track retrieved for this video',
  chapterProvenance: 'visible YouTube chapter markers',
};

const baseCatalog = {
  version: 'base-1',
  generatedAt: '2026-10-06T00:00:00.000Z',
  videos: [{
    id: 'video-01', number: 1, title: 'Existing', duration: 10,
    sourceUrl: 'https://www.youtube.com/watch?v=kx8_wF9HOX8',
    customMetadata: { preserved: true },
  }],
};

test('prepared videos append source-backed custom data and preserve base metadata', () => {
  const result = prepareAdditionalVideos({ version: 1, videos: [prepared] }, baseCatalog);
  assert.deepEqual(result.catalog.videos[0], baseCatalog.videos[0]);
  assert.equal(result.catalog.videos[1].id, 'custom-rKgtm81yi94');
  assert.deepEqual(result.catalog.videos[1].topics, ['Science']);
  assert.equal(result.catalog.videos[1].number, 2);
  assert.equal(result.videoFiles[0].data.contentVersion.startsWith('custom-'), true);
  assert.equal(result.videoFiles[0].data.captionType, prepared.captionType);
  assert.equal(result.videoFiles[0].data.sourceStatus, 'codex-prepared-not-audio-verified');
  assert.deepEqual(result.videoFiles[0].data.chapters.map(({ sceneIds }) => sceneIds), [['c0001'], ['c0002']]);
  assert.ok(result.videoFiles[0].data.chapters.every(({ source }) => source === 'codex-prepared'));
  assert.ok(result.videoFiles[0].data.chapters.every(({ provenance }) => provenance === prepared.chapterProvenance));
  assert.deepEqual(baseCatalog.videos, [baseCatalog.videos[0]], 'the base catalog is not mutated');
});

test('a rebuild is idempotent and a base video with the same YouTube ID is skipped', () => {
  const first = prepareAdditionalVideos({ version: 1, videos: [prepared] }, baseCatalog);
  const second = prepareAdditionalVideos({ version: 1, videos: [prepared] }, first.catalog);
  assert.deepEqual(second.catalog, first.catalog);
  assert.equal(second.videoFiles.length, 1);
  assert.deepEqual(second.skipped, []);

  const existingBase = {
    ...baseCatalog,
    videos: [{ ...baseCatalog.videos[0], sourceUrl: prepared.url }],
  };
  const skipped = prepareAdditionalVideos({ version: 1, videos: [prepared] }, existingBase);
  assert.deepEqual(skipped.catalog, existingBase);
  assert.deepEqual(skipped.videoFiles, []);
  assert.deepEqual(skipped.skipped, [{ youtubeId: prepared.youtubeId, reason: 'already-in-catalog' }]);
});

test('the full manifest fails before producing additions when any row is invalid', () => {
  const missingTranscript = { ...prepared };
  delete missingTranscript.transcript;
  assert.throws(
    () => prepareAdditionalVideos({ version: 1, videos: [prepared, missingTranscript] }, baseCatalog),
    /Additional video 2 is missing "transcript"/,
  );
  assert.throws(
    () => prepareAdditionalVideos({ version: 1, videos: [prepared, { ...prepared, title: 'Duplicate' }] }, baseCatalog),
    /Duplicate prepared video/,
  );
  assert.deepEqual(baseCatalog.videos, [baseCatalog.videos[0]]);
});

test('incomplete timing and invalid chapter boundaries are rejected clearly', () => {
  assert.throws(
    () => prepareAdditionalVideos({ version: 1, videos: [{ ...prepared, transcript: 'untimed words' }] }, baseCatalog),
    /cannot be compiled/,
  );
  assert.throws(
    () => prepareAdditionalVideos({ version: 1, videos: [{ ...prepared, chapters: [{ title: 'Late', startSeconds: 70 }] }] }, baseCatalog),
    /invalid: 챕터 시간은 영상 길이 안에 있어야 합니다/,
  );
});

test('an invalid manifest leaves the catalog and output directory untouched', async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'word-trail-additional-'));
  const catalogPath = path.join(directory, 'catalog.json');
  const manifestPath = path.join(directory, 'additional-videos.json');
  const videoOutputDir = path.join(directory, 'videos');
  await mkdir(videoOutputDir);
  await writeFile(path.join(videoOutputDir, 'custom-staleVideo1.json'), '{}\n');
  await writeFile(catalogPath, `${JSON.stringify(baseCatalog)}\n`);
  const invalidSecondVideo = {
    ...prepared,
    id: 'video:qAEqxJjN9Cw',
    youtubeId: 'qAEqxJjN9Cw',
    url: 'https://www.youtube.com/watch?v=qAEqxJjN9Cw',
    transcript: 'not timed',
  };
  await writeFile(manifestPath, JSON.stringify({ version: 1, videos: [prepared, invalidSecondVideo] }));
  t.after(() => rm(directory, { recursive: true, force: true }));

  await assert.rejects(
    buildAdditionalVideos({ catalogPath, manifestPath, videoOutputDir }),
    /cannot be compiled/,
  );
  assert.deepEqual(JSON.parse(await readFile(catalogPath, 'utf8')), baseCatalog);
  assert.deepEqual(await readdir(videoOutputDir), ['custom-staleVideo1.json']);
});

test('a valid build prunes stale generated files but preserves base video files', async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'word-trail-additional-prune-'));
  const catalogPath = path.join(directory, 'catalog.json');
  const manifestPath = path.join(directory, 'additional-videos.json');
  const videoOutputDir = path.join(directory, 'videos');
  await mkdir(videoOutputDir);
  await writeFile(catalogPath, `${JSON.stringify({
    ...baseCatalog,
    videos: [...baseCatalog.videos, {
      id: 'custom-qAEqxJjN9Cw', sourceUrl: 'https://www.youtube.com/watch?v=qAEqxJjN9Cw', number: 2,
    }],
  })}\n`);
  await writeFile(manifestPath, JSON.stringify({ version: 1, videos: [prepared] }));
  await writeFile(path.join(videoOutputDir, 'video-01.json'), '{"base":true}\n');
  await writeFile(path.join(videoOutputDir, 'custom-qAEqxJjN9Cw.json'), '{"stale":true}\n');
  await writeFile(path.join(videoOutputDir, 'custom-unowned-long-id.json'), '{"unowned":true}\n');
  t.after(() => rm(directory, { recursive: true, force: true }));

  const result = await buildAdditionalVideos({ catalogPath, manifestPath, videoOutputDir });
  assert.deepEqual(result.pruned, ['custom-qAEqxJjN9Cw.json']);
  assert.deepEqual((await readdir(videoOutputDir)).sort(), ['custom-rKgtm81yi94.json', 'custom-unowned-long-id.json', 'video-01.json']);
  assert.deepEqual(JSON.parse(await readFile(path.join(videoOutputDir, 'custom-unowned-long-id.json'), 'utf8')), { unowned: true });
  assert.deepEqual(result.catalog.videos.map(({ id }) => id), ['video-01', 'custom-rKgtm81yi94']);
  const generated = JSON.parse(await readFile(path.join(videoOutputDir, 'custom-rKgtm81yi94.json'), 'utf8'));
  assert.equal(generated.sourceStatus, 'codex-prepared-not-audio-verified');
  assert.equal(generated.provenance.transcript, prepared.transcriptProvenance);
});
