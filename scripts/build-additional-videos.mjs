import { mkdir, readFile, readdir, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileCustomVideo } from '../public/lib/custom-video.js';
import { emptyLibrary, upsertLibraryVideo, youtubeVideoId } from '../public/lib/library.js';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifestPath = path.join(rootDir, 'content/additional-videos.json');
const catalogPath = path.join(rootDir, 'public/data/catalog.json');
const videoOutputDir = path.join(rootDir, 'public/data/videos');
const REQUIRED_FIELDS = [
  'id', 'youtubeId', 'url', 'title', 'durationSeconds', 'topics', 'tags',
  'transcript', 'chapters', 'createdAt', 'updatedAt',
];
const GENERATED_VIDEO_ID = /^custom-[A-Za-z0-9_-]{11}$/;
const GENERATED_VIDEO_FILE = /^(custom-[A-Za-z0-9_-]{11})\.json$/;

function assertManifestShape(manifest) {
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    throw new Error('content/additional-videos.json must contain an object.');
  }
  if (manifest.version !== 1 || !Array.isArray(manifest.videos)) {
    throw new Error('content/additional-videos.json must use { "version": 1, "videos": [] }.');
  }
}

function validatePreparedRecord(record, index) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) {
    throw new Error(`Additional video ${index + 1} must be an object.`);
  }
  for (const field of REQUIRED_FIELDS) {
    if (!Object.hasOwn(record, field)) throw new Error(`Additional video ${index + 1} is missing "${field}".`);
  }
  if (!String(record.transcript).trim()) {
    throw new Error(`Additional video ${index + 1} requires a real timed transcript; it cannot be blank.`);
  }
  if (!Array.isArray(record.topics) || !Array.isArray(record.tags) || !Array.isArray(record.chapters)) {
    throw new Error(`Additional video ${index + 1} must provide topics, tags, and chapters as arrays.`);
  }
  for (const field of ['captionType', 'transcriptProvenance', 'chapterProvenance']) {
    if (record[field] != null && (typeof record[field] !== 'string' || !record[field].trim() || record[field].length > 500)) {
      throw new Error(`Additional video ${index + 1} has invalid "${field}" source metadata.`);
    }
  }
}

function youtubeIdFromCatalogItem(item) {
  try {
    return youtubeVideoId(item?.youtubeId || item?.sourceUrl);
  } catch {
    return null;
  }
}

function catalogItemFor(video, compiled, number) {
  return {
    id: compiled.id,
    number,
    title: compiled.title,
    duration: compiled.duration,
    captionType: compiled.captionType,
    sourceUrl: compiled.sourceUrl,
    chapterCount: compiled.chapters.length,
    sceneCount: compiled.scenes.filter((scene) => scene.selectable).length,
    expressionCount: compiled.expressionCount,
    qualityFlags: compiled.qualityFlags,
    topics: video.topics,
    tags: video.tags,
    createdAt: video.createdAt,
    updatedAt: video.updatedAt,
  };
}

/**
 * Validate a complete prepared manifest and merge it without mutating the base
 * catalog. The caller writes only after this function has validated every row.
 */
export function prepareAdditionalVideos(manifest, baseCatalog) {
  assertManifestShape(manifest);
  if (!baseCatalog || typeof baseCatalog !== 'object' || !Array.isArray(baseCatalog.videos)) {
    throw new Error('The generated base catalog is missing or invalid.');
  }

  const preparedIds = new Set();
  const preparedYoutubeIds = new Set();
  let library = emptyLibrary();
  const normalizedRecords = [];

  for (const [index, record] of manifest.videos.entries()) {
    validatePreparedRecord(record, index);
    let normalized;
    try {
      library = upsertLibraryVideo(library, record);
      normalized = library.videos.find((video) => video.id === record.id);
    } catch (error) {
      throw new Error(`Additional video ${index + 1} is invalid: ${error.message}`);
    }
    if (preparedIds.has(normalized.id) || preparedYoutubeIds.has(normalized.youtubeId)) {
      throw new Error(`Duplicate prepared video: ${normalized.youtubeId}.`);
    }
    preparedIds.add(normalized.id);
    preparedYoutubeIds.add(normalized.youtubeId);
    normalizedRecords.push({ normalized, source: record });
  }

  // The manifest is authoritative for generated additional videos. Removing
  // previously generated rows here also makes a standalone rebuild reconcile
  // manifest removals instead of requiring build-catalog to run first.
  const baseVideos = baseCatalog.videos.filter(({ id }) => !GENERATED_VIDEO_ID.test(id));
  const existingYoutubeIds = new Set(baseVideos.map(youtubeIdFromCatalogItem).filter(Boolean));
  const existingOutputIds = new Set(baseVideos.map(({ id }) => id));
  const additions = [];
  const skipped = [];

  for (const { normalized, source } of normalizedRecords) {
    if (existingYoutubeIds.has(normalized.youtubeId)) {
      skipped.push({ youtubeId: normalized.youtubeId, reason: 'already-in-catalog' });
      continue;
    }
    let compiled;
    try {
      compiled = compileCustomVideo(normalized);
    } catch (error) {
      throw new Error(`Additional video ${normalized.youtubeId} cannot be compiled: ${error.message}`);
    }
    if (existingOutputIds.has(compiled.id)) {
      throw new Error(`Additional output ID already exists: ${compiled.id}.`);
    }
    const transcriptProvenance = source.transcriptProvenance?.trim() || 'timed transcript recorded in manifest';
    const chapterProvenance = source.chapterProvenance?.trim() || 'chapter boundaries recorded in manifest';
    compiled = {
      ...compiled,
      captionType: source.captionType?.trim() || 'Codex-prepared source-backed English transcript',
      sourceStatus: 'codex-prepared-not-audio-verified',
      reviewStatus: 'unreviewed',
      sourceFiles: { manifest: 'content/additional-videos.json' },
      chapterMetadataStatus: normalized.chapters.length ? 'codex-prepared-source-backed' : 'whole-video',
      chapters: compiled.chapters.map((chapter) => chapter.source === 'user-provided'
        ? { ...chapter, source: 'codex-prepared', provenance: chapterProvenance }
        : chapter),
      provenance: {
        preparation: 'codex-prepared-from-declared-source-material',
        transcript: transcriptProvenance,
        chapters: normalized.chapters.length
          ? chapterProvenance
          : 'whole-video fallback',
      },
      topics: normalized.topics,
      tags: normalized.tags,
      updatedAt: normalized.updatedAt,
    };
    additions.push({ video: normalized, compiled });
    existingYoutubeIds.add(normalized.youtubeId);
    existingOutputIds.add(compiled.id);
  }

  const highestNumber = baseVideos.reduce((max, item) => Math.max(max, Number(item.number) || 0), 0);
  const catalogAdditions = additions.map(({ video, compiled }, index) => catalogItemFor(video, compiled, highestNumber + index + 1));
  return {
    catalog: { ...baseCatalog, videos: [...baseVideos, ...catalogAdditions] },
    videoFiles: additions.map(({ compiled }) => ({ id: compiled.id, data: compiled })),
    skipped,
  };
}

export async function buildAdditionalVideos(options = {}) {
  const sourcePath = options.manifestPath || manifestPath;
  const targetCatalogPath = options.catalogPath || catalogPath;
  const targetVideoDir = options.videoOutputDir || videoOutputDir;
  const [manifest, catalog] = await Promise.all([
    readFile(sourcePath, 'utf8').then(JSON.parse),
    readFile(targetCatalogPath, 'utf8').then(JSON.parse),
  ]);
  const result = prepareAdditionalVideos(manifest, catalog);
  await mkdir(targetVideoDir, { recursive: true });
  await Promise.all(result.videoFiles.map(({ id, data }) =>
    writeFile(path.join(targetVideoDir, `${id}.json`), `${JSON.stringify(data, null, 2)}\n`)));
  await writeFile(targetCatalogPath, `${JSON.stringify(result.catalog, null, 2)}\n`);
  const desiredIds = new Set(result.catalog.videos.map(({ id }) => id).filter((id) => GENERATED_VIDEO_ID.test(id)));
  const staleFiles = (await readdir(targetVideoDir)).filter((fileName) => {
    const match = fileName.match(GENERATED_VIDEO_FILE);
    return match && !desiredIds.has(match[1]);
  });
  await Promise.all(staleFiles.map((fileName) => unlink(path.join(targetVideoDir, fileName))));
  return { ...result, pruned: staleFiles };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await buildAdditionalVideos();
  console.log(`Prepared ${result.videoFiles.length} additional video(s); skipped ${result.skipped.length}.`);
}
