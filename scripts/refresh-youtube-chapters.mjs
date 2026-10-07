import { spawn } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { youtubeVideoIdFromUrl } from './build-catalog.mjs';

const DEFAULT_TIMEOUT_MS = 20_000;
const DEFAULT_CONCURRENCY = 4;

export function normalizeYoutubeChapters(rawChapters, duration) {
  if (!Array.isArray(rawChapters)) return [];
  const chapters = rawChapters.map((chapter) => ({
    title: String(chapter?.title || '').trim(),
    markerStart: Number(chapter?.start_time),
    sourceEnd: Number(chapter?.end_time),
    source: 'youtube-chapter',
    provenance: 'youtube-player-metadata-via-yt-dlp',
    coverage: 'youtube-metadata-boundary',
  }));
  if (chapters.some((chapter) => !chapter.title
    || !Number.isFinite(chapter.markerStart)
    || !Number.isFinite(chapter.sourceEnd)
    || chapter.markerStart < 0
    || chapter.sourceEnd <= chapter.markerStart
    || chapter.sourceEnd > duration + 1)) return [];
  if (chapters.some((chapter, index) => index > 0
    && chapter.markerStart !== chapters[index - 1].sourceEnd)) return [];
  return chapters;
}

export function youtubeMetadataEntry(metadata, fetchedAt) {
  const duration = Number(metadata?.duration);
  const chapters = normalizeYoutubeChapters(metadata?.chapters, duration);
  if (!chapters.length) return null;
  return {
    status: 'youtube-metadata-verified',
    expectedChapterCount: chapters.length,
    sourceVideoId: String(metadata.id),
    sourceTitle: String(metadata.title || ''),
    sourceDuration: duration,
    fetchedAt,
    chapters,
  };
}

export function canRefreshYoutubeMetadata(existing) {
  return !existing || existing.status === 'youtube-metadata-verified';
}

function ytDlpMetadata(sourceUrl, { timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn('yt-dlp', [
      '--skip-download', '--no-warnings', '--socket-timeout', '10', '--retries', '0',
      '--extractor-retries', '0', '--dump-single-json', sourceUrl,
    ], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error(`metadata timeout after ${timeoutMs}ms`));
    }, timeoutMs);
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) return reject(new Error(stderr.trim() || `yt-dlp exited ${code}`));
      try {
        resolve(JSON.parse(stdout));
      } catch (error) {
        reject(new Error(`invalid yt-dlp JSON: ${error.message}`));
      }
    });
  });
}

async function mapConcurrent(items, concurrency, operation) {
  const results = new Array(items.length);
  let nextIndex = 0;
  async function worker() {
    while (nextIndex < items.length) {
      const index = nextIndex++;
      results[index] = await operation(items[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return results;
}

export async function refreshYoutubeChapters({
  rootDir,
  write = false,
  selectedVideoIds = [],
  concurrency = DEFAULT_CONCURRENCY,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  fetchedAt = new Date().toISOString(),
} = {}) {
  const manifestPath = path.join(rootDir, 'content/chapter-metadata.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  const catalog = JSON.parse(await readFile(path.join(rootDir, 'public/data/catalog.json'), 'utf8'));
  const selected = new Set(selectedVideoIds);
  const videos = catalog.videos.filter((video) => !selected.size || selected.has(video.id));
  const results = await mapConcurrent(videos, concurrency, async (video) => {
    const sourceVideoId = youtubeVideoIdFromUrl(video.sourceUrl);
    if (!sourceVideoId) return { id: video.id, outcome: 'error', error: 'invalid YouTube URL' };
    try {
      const metadata = await ytDlpMetadata(video.sourceUrl, { timeoutMs });
      if (metadata.id !== sourceVideoId) return { id: video.id, outcome: 'error', error: 'source video ID mismatch' };
      const entry = youtubeMetadataEntry(metadata, fetchedAt);
      if (!entry) return { id: video.id, outcome: 'no-chapters' };
      return { id: video.id, outcome: 'chapters', entry };
    } catch (error) {
      return { id: video.id, outcome: 'error', error: error.message };
    }
  });

  if (write) {
    for (const result of results) {
      const existing = manifest.videos[result.id];
      if (!canRefreshYoutubeMetadata(existing)) continue;
      if (result.outcome === 'chapters') manifest.videos[result.id] = result.entry;
      else if (result.outcome === 'no-chapters' && existing?.status === 'youtube-metadata-verified') delete manifest.videos[result.id];
    }
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  }
  return results;
}

function parseArgs(args) {
  const options = {
    write: false,
    selectedVideoIds: [],
    concurrency: DEFAULT_CONCURRENCY,
    timeoutMs: DEFAULT_TIMEOUT_MS,
  };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--write') options.write = true;
    else if (arg === '--video') options.selectedVideoIds.push(args[++index]);
    else if (arg === '--concurrency') options.concurrency = Number(args[++index]);
    else if (arg === '--timeout-ms') options.timeoutMs = Number(args[++index]);
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (options.selectedVideoIds.some((id) => !/^video-\d{2}$/.test(id || ''))) throw new Error('Video IDs must use the video-01 format');
  if (!(options.concurrency > 0 && options.concurrency <= 8)) throw new Error('Concurrency must be between 1 and 8');
  if (!(options.timeoutMs >= 5_000 && options.timeoutMs <= 60_000)) throw new Error('Timeout must be between 5000 and 60000ms');
  return options;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const results = await refreshYoutubeChapters({ rootDir, ...parseArgs(process.argv.slice(2)) });
  const chapters = results.filter((result) => result.outcome === 'chapters');
  const noChapters = results.filter((result) => result.outcome === 'no-chapters');
  const errors = results.filter((result) => result.outcome === 'error');
  console.log(JSON.stringify({
    queried: results.length,
    chapters: chapters.length,
    noChapters: noChapters.length,
    errors: errors.map(({ id, error }) => ({ id, error })),
    updated: chapters.map((result) => ({
      id: result.id,
      chapterCount: result.entry.chapters.length,
      sourceVideoId: result.entry.sourceVideoId,
    })),
  }, null, 2));
}
