import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const CONTENT_VERSION = '2026.10.06-1';
export const GENERATION_METHOD = 'editorial-bank+deterministic-match';
const EXPRESSION_CONTENT_VERSION = '2026.09.25-3';
const SOURCE_GROUPING_VERSION = '2026.09.30-1';
const TARGET_SCENE_SECONDS = 5;
const MAX_SCENE_SECONDS = 15;
const HARD_GAP_SECONDS = 3;
const MAX_REFERENCE_LENGTH = 2000;

const CUE_RE = /^\[(\d{1,2}:\d{2}(?::\d{2})?)\s*-\s*(\d{1,2}:\d{2}(?::\d{2})?)\]\s*(.*)$/;

export function timestampToSeconds(value) {
  const parts = value.split(':').map(Number);
  if (parts.some((part) => !Number.isFinite(part))) return Number.NaN;
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  return Number.NaN;
}

export function youtubeVideoIdFromUrl(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.port) return null;
    const host = url.hostname.toLowerCase();
    let id = null;
    if (host === 'youtube.com' || host === 'www.youtube.com') {
      if (url.pathname !== '/watch' || url.searchParams.getAll('v').length !== 1) return null;
      id = url.searchParams.get('v');
    } else if (host === 'youtu.be') {
      const segments = url.pathname.split('/').filter(Boolean);
      if (segments.length !== 1) return null;
      [id] = segments;
    } else {
      return null;
    }
    return /^[A-Za-z0-9_-]{11}$/.test(id || '') ? id : null;
  } catch {
    return null;
  }
}

export function parseTranscriptText(text, sourceName = 'transcript.txt') {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const header = {};
  for (const line of lines) {
    const separator = line.indexOf(':');
    if (separator > 0 && !line.startsWith('[')) {
      header[line.slice(0, separator).trim().toLowerCase()] = line.slice(separator + 1).trim();
    }
  }

  const cues = [];
  const rejected = [];
  for (const [lineIndex, line] of lines.entries()) {
    const match = line.match(CUE_RE);
    if (!match) continue;
    const start = timestampToSeconds(match[1]);
    const end = timestampToSeconds(match[2]);
    const cue = {
      id: `c${String(cues.length + 1).padStart(4, '0')}`,
      start,
      end,
      text: match[3].trim(),
      sourceLine: lineIndex + 1,
    };
    if (!Number.isFinite(start) || !Number.isFinite(end) || end < start || !cue.text) {
      rejected.push({ line: lineIndex + 1, reason: 'malformed-cue', value: line });
      continue;
    }
    cues.push(cue);
  }

  const duration = timestampToSeconds(header.length || '');
  return {
    sourceName,
    title: header.title || path.basename(sourceName, path.extname(sourceName)),
    sourceUrl: header.video || '',
    declaredDuration: Number.isFinite(duration) ? duration : 0,
    captionType: header.captions || 'Unknown',
    cues,
    rejected,
  };
}

export function parseScriptHeadings(text) {
  const headings = [];
  let pendingTitle = '';
  for (const line of String(text ?? '').replace(/\r\n?/g, '\n').split('\n')) {
    const heading = line.match(/^##\s+(.+?)\s*$/);
    if (heading) {
      pendingTitle = heading[1].trim();
      continue;
    }
    if (!pendingTitle) continue;
    const cue = line.match(/^-\s*`?\[(\d{1,2}:\d{2}(?::\d{2})?)\s*-\s*(\d{1,2}:\d{2}(?::\d{2})?)\]`?\s*(.*)$/);
    if (!cue) continue;
    const start = timestampToSeconds(cue[1]);
    if (pendingTitle && Number.isFinite(start)) headings.push({ title: pendingTitle, markerStart: start });
    pendingTitle = '';
  }
  return headings;
}

function stripDisplayedTimestamp(value, minute, second) {
  const escapedMinute = String(minute).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const escapedSecond = String(Number(second)).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return value
    .replace(new RegExp(`^${escapedMinute}분\\s*${escapedSecond}초\\s*`), '')
    .replace(new RegExp(`^${escapedSecond}초\\s*`), '')
    .trim();
}

export function parseChapteredTranscriptText(text, sourceName = 'chaptered-transcript.txt') {
  const lines = String(text ?? '').replace(/\r\n?/g, '\n').split('\n');
  let expectedChapterCount;
  let excerptEnd;
  let activeChapter;
  const chapters = [];
  const sections = [];

  for (const [lineIndex, rawLine] of lines.entries()) {
    const line = rawLine.trim();
    if (!line) continue;
    const expected = line.match(/^expected[- ]chapter[- ]count\s*:\s*(\d+)\s*$/i);
    if (expected) {
      expectedChapterCount = Number(expected[1]);
      continue;
    }
    const excerpt = line.match(/^excerpt[- ]end\s*:\s*(\d{1,2}:\d{2}(?::\d{2})?)\s*$/i);
    if (excerpt) {
      excerptEnd = timestampToSeconds(excerpt[1]);
      continue;
    }
    const chapter = line.match(/^(?:chapter|챕터)\s*(\d+)\s*[:：-]\s*(.+?)\s*$/iu);
    if (chapter) {
      activeChapter = {
        number: Number(chapter[1]),
        title: chapter[2].trim(),
        markerStart: undefined,
        sections: [],
        sourceLine: lineIndex + 1,
      };
      chapters.push(activeChapter);
      continue;
    }
    const row = line.match(/^(\d{1,3}):([0-5]\d)(.*)$/u);
    if (!row || !activeChapter) continue;
    const start = Number(row[1]) * 60 + Number(row[2]);
    const section = {
      start,
      text: stripDisplayedTimestamp(row[3], row[1], row[2]),
      chapterNumber: activeChapter.number,
      sourceLine: lineIndex + 1,
    };
    if (!section.text) throw new Error(`${sourceName}:${section.sourceLine}: timestamp row has no transcript text`);
    if (sections.length && start <= sections.at(-1).start) throw new Error(`${sourceName}:${section.sourceLine}: timestamp rows must increase`);
    activeChapter.markerStart ??= start;
    activeChapter.sections.push(section);
    sections.push(section);
  }

  if (!chapters.length || chapters.some(chapter => !Number.isFinite(chapter.markerStart))) {
    throw new Error(`${sourceName}: each explicit chapter requires at least one timestamp row`);
  }
  for (const [index, section] of sections.entries()) {
    section.end = sections[index + 1]?.start ?? excerptEnd;
    if (!(section.end > section.start)) throw new Error(`${sourceName}:${section.sourceLine}: final timestamp row requires a later Excerpt-End`);
  }
  return { sourceName, expectedChapterCount, excerptEnd, chapters, sections };
}

function overlapsOrContainsPoint(original, cue) {
  if (cue.start === cue.end) return original.start <= cue.start && original.end >= cue.start && original.end > original.start;
  return original.start < cue.end && original.end > cue.start;
}

export function alignCleanedCues(cleaned, original) {
  const cues = [];
  const rejected = [...cleaned.rejected];
  let repairedZeroDuration = 0;
  let excludedZeroDuration = 0;

  for (const sourceCue of cleaned.cues) {
    const refs = original.cues.filter((candidate) => overlapsOrContainsPoint(candidate, sourceCue));
    let start = sourceCue.start;
    let end = sourceCue.end;
    const qualityFlags = [];

    if (start === end) {
      if (refs.length) {
        start = Math.min(...refs.map((ref) => ref.start));
        end = Math.max(...refs.map((ref) => ref.end));
        qualityFlags.push('zero-duration-repaired-from-original');
        repairedZeroDuration += 1;
      } else {
        rejected.push({ line: sourceCue.sourceLine, reason: 'zero-duration-without-original-overlap', value: sourceCue.text });
        excludedZeroDuration += 1;
        continue;
      }
    }

    if (end <= start) {
      rejected.push({ line: sourceCue.sourceLine, reason: 'non-positive-duration', value: sourceCue.text });
      continue;
    }

    if (!refs.length) qualityFlags.push('no-original-overlap');
    const originalCueRefs = refs.map((ref) => ({ id: ref.id, start: ref.start, end: ref.end, text: ref.text }));
    cues.push({
      id: sourceCue.id,
      start,
      end,
      text: sourceCue.text,
      originalText: refs.map((ref) => ref.text).join(' '),
      originalCueRefs,
      qualityFlags,
    });
  }

  return { cues, rejected, repairedZeroDuration, excludedZeroDuration };
}

function exactCleanedCoverage(rawCue, cleanedCues) {
  const positive = cleanedCues.filter((cue) => cue.end > cue.start);
  const exact = positive.find((cue) => cue.start === rawCue.start && cue.end === rawCue.end);
  if (exact) return { text: exact.text, refs: [exact] };

  const contained = positive
    .filter((cue) => cue.start >= rawCue.start && cue.end <= rawCue.end)
    .sort((a, b) => a.start - b.start || a.end - b.end || a.id.localeCompare(b.id));
  const refs = [];
  let cursor = rawCue.start;
  for (const cue of contained) {
    if (cue.end <= cursor) continue;
    if (cue.start !== cursor) return null;
    refs.push(cue);
    cursor = cue.end;
    if (cursor === rawCue.end) break;
  }
  if (!refs.length || cursor !== rawCue.end) return null;
  return { text: refs.map((cue) => cue.text).join(' '), refs };
}

function withoutNonSpokenAnnotations(text) {
  let value = text.replace(/^\s*>>\s*/, '');
  value = value.replace(/\[[^\]]+\]/g, ' ');
  value = value.replace(/\(([^)]*)\)/g, (whole, inner) => {
    const letters = inner.match(/[A-Za-z]/g)?.join('') || '';
    return letters && letters === letters.toUpperCase() ? ' ' : whole;
  });
  return value
    .replace(/\s+([,.;!?])/g, '$1')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

export function isNonSpeechAnnotation(text) {
  return /^\s*(?:>>\s*)?(?:(?:\[[^\]]+\]|\([^)]*\))\s*)+[.!?…]*\s*$/.test(text);
}

export function buildOriginalCueGroups(original, cleaned, overrides = []) {
  const rawById = new Map(original.cues.map((cue) => [cue.id, cue]));
  const usedRawIds = new Set();
  const groups = [];

  const addGroup = (rawRefs, config = {}) => {
    if (!rawRefs.length || rawRefs.some((cue) => cue.end <= cue.start)) throw new Error(`${original.sourceName}: grouping contains a non-positive original cue`);
    const corrected = rawRefs.map((cue) => exactCleanedCoverage(cue, cleaned.cues));
    const hasExactCoverage = corrected.every(Boolean);
    const rawText = rawRefs.map((cue) => cue.text).join(' ');
    const cleanedRawParts = rawRefs
      .map((cue) => withoutNonSpokenAnnotations(cue.text))
      .filter((part) => /[\p{L}\p{N}]/u.test(part));
    const cleanedRawText = cleanedRawParts.join(' ');
    const removedAnnotation = cleanedRawText && cleanedRawText !== rawText;
    const explicitText = typeof config.text === 'string' ? config.text.trim() : '';
    const qualityFlags = [
      ...(config.qualityFlags || []),
      ...(explicitText ? ['user-provided-transcript-text'] : []),
      hasExactCoverage ? 'corrected-text-exact-coverage' : 'raw-original-text',
      ...(!hasExactCoverage && removedAnnotation ? ['non-spoken-annotation-removed'] : []),
    ];
    groups.push({
      start: config.start ?? Math.min(...rawRefs.map((cue) => cue.start)),
      end: config.end ?? Math.max(...rawRefs.map((cue) => cue.end)),
      text: explicitText || (hasExactCoverage ? corrected.map((item) => item.text).join(' ') : (cleanedRawText || rawText)),
      originalText: rawText,
      originalCueRefs: rawRefs.map((cue) => ({ id: cue.id, start: cue.start, end: cue.end, text: cue.text })),
      cleanedCueRefs: hasExactCoverage
        ? corrected.flatMap((item) => item.refs.map((cue) => ({ id: cue.id, start: cue.start, end: cue.end, text: cue.text })))
        : [],
      textSource: explicitText ? 'user-provided-transcript' : (hasExactCoverage ? 'cleaned-exact-coverage' : 'original-captured'),
      groupingProvenance: config.provenance || 'original-captured-cue',
      qualityFlags: [...new Set(qualityFlags)],
    });
  };

  for (const override of overrides) {
    const rawRefs = override.sourceCueIds.map((id) => {
      if (usedRawIds.has(id)) throw new Error(`${original.sourceName}: original cue ${id} is used by multiple explicit groups`);
      const cue = rawById.get(id);
      if (!cue) throw new Error(`${original.sourceName}: explicit group references missing original cue ${id}`);
      usedRawIds.add(id);
      return cue;
    });
    const sourceStart = Math.min(...rawRefs.map((cue) => cue.start));
    const sourceEnd = Math.max(...rawRefs.map((cue) => cue.end));
    if (override.start > sourceStart || override.end < sourceEnd || override.end <= override.start) throw new Error(`${original.sourceName}: explicit playback range does not cover its source cues`);
    addGroup(rawRefs, override);
  }

  for (const rawCue of original.cues) {
    if (!usedRawIds.has(rawCue.id)) addGroup([rawCue]);
  }

  return groups
    .sort((a, b) => a.start - b.start || a.end - b.end || a.originalCueRefs[0].id.localeCompare(b.originalCueRefs[0].id))
    .map((group, index) => ({ ...group, id: `c${String(index + 1).padStart(4, '0')}` }));
}

function terminalBoundary(text) {
  return /[.!?…][”"')\]]*\s*$/u.test(String(text ?? '').trim());
}

function chapterDefinitions(cues, headings, fallbackTitle) {
  if (!cues.length) return [];
  const firstStart = cues[0].start;
  const lastEnd = Math.max(...cues.map(cue => cue.end));
  const usable = (Array.isArray(headings) ? headings : [])
    .filter(heading => heading?.title && Number.isFinite(heading.markerStart) && heading.markerStart < lastEnd)
    .sort((left, right) => left.markerStart - right.markerStart);
  if (!usable.length) {
    return [{ id: 'chapter-001', title: fallbackTitle, start: firstStart, end: lastEnd, source: 'whole-video' }];
  }
  const scriptChapters = usable.map(heading => {
    const straddlingCue = cues.find(cue => cue.start < heading.markerStart && cue.end > heading.markerStart);
    const start = straddlingCue?.start ?? heading.markerStart;
    const snapSeconds = heading.markerStart - start;
    return {
      title: heading.title,
      start,
      markerStart: heading.markerStart,
      source: heading.source || 'script-heading',
      ...(heading.provenance ? { provenance: heading.provenance } : {}),
      ...(heading.coverage ? { coverage: heading.coverage } : {}),
      ...(heading.capturedTitle ? {
        capturedTitle: heading.capturedTitle,
        titleSource: 'video-title',
        titleCorrectionReason: 'captured-heading-conflicts-with-video-title'
      } : {}),
      qualityFlags: [
        ...(snapSeconds ? ['chapter-boundary-snapped-to-caption'] : []),
        ...(heading.capturedTitle ? ['chapter-title-corrected-from-video-title'] : [])
      ],
      snapSeconds
    };
  });
  for (const [index, chapter] of scriptChapters.entries()) {
    chapter.end = scriptChapters[index + 1]?.start ?? lastEnd;
  }
  const chapters = scriptChapters[0].start > firstStart
    ? [{ title: '도입부', start: firstStart, end: scriptChapters[0].start, source: 'whole-video' }, ...scriptChapters]
    : scriptChapters;
  return chapters.map((chapter, index) => ({
    id: `chapter-${String(index + 1).padStart(3, '0')}`,
    ...chapter
  }));
}

function chapterForCue(cue, chapters) {
  return chapters.findLast(chapter => cue.start >= chapter.start) || chapters[0];
}

function uniqueRefs(refs) {
  const seen = new Set();
  return refs.filter(ref => {
    const key = `${ref.id}\u0000${ref.start}\u0000${ref.end}\u0000${ref.text}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function combineDialogueCues(cues, index, chapterId, paragraphIndex) {
  const start = Math.min(...cues.map(cue => cue.start));
  const end = Math.max(...cues.map(cue => cue.end));
  const qualityFlags = [...new Set(cues.flatMap(cue => cue.qualityFlags || []))];
  if (cues.length > 1) qualityFlags.push('duration-grouped-dialogue');
  if (end - start < TARGET_SCENE_SECONDS) qualityFlags.push('short-dialogue-fragment');
  const textSources = new Set(cues.map(cue => cue.textSource));
  return {
    id: `c${String(index + 1).padStart(4, '0')}`,
    start,
    end,
    text: cues.map(cue => cue.text).join(' ').replace(/\s{2,}/g, ' ').trim(),
    originalText: cues.map(cue => cue.originalText).join(' ').replace(/\s{2,}/g, ' ').trim(),
    originalCueRefs: uniqueRefs(cues.flatMap(cue => cue.originalCueRefs || [])),
    cleanedCueRefs: uniqueRefs(cues.flatMap(cue => cue.cleanedCueRefs || [])),
    sourceCueRefs: cues.map(cue => ({
      id: cue.id,
      start: cue.start,
      end: cue.end,
      groupingProvenance: cue.groupingProvenance,
      originalCueIds: (cue.originalCueRefs || []).map(ref => ref.id)
    })),
    textSource: textSources.size === 1 ? cues[0].textSource : 'mixed-captured-sources',
    groupingProvenance: cues.length === 1 ? cues[0].groupingProvenance : 'duration-dialogue-grouping',
    chapterId,
    paragraphIndex,
    qualityFlags
  };
}

function isExplicitSourceGroup(cue) {
  return cue.groupingProvenance === 'parent-explicit-grouping'
    || cue.groupingProvenance === 'user-provided-script-section'
    || cue.qualityFlags?.includes('explicit-parent-grouping')
    || cue.qualityFlags?.includes('explicit-script-section');
}

export function groupDialogueCues(cues, headings = [], fallbackTitle = '전체 영상') {
  const ordered = [...cues].sort((left, right) => left.start - right.start || left.end - right.end || left.id.localeCompare(right.id));
  const chapters = chapterDefinitions(ordered, headings, fallbackTitle);
  const groups = [];
  let current = [];

  const flush = () => {
    if (!current.length) return;
    const chapterId = chapterForCue(current[0], chapters).id;
    groups.push({ cues: current, chapterId });
    current = [];
  };

  for (const cue of ordered) {
    const chapterId = chapterForCue(cue, chapters).id;
    const explicitGrouping = isExplicitSourceGroup(cue);
    if (explicitGrouping) {
      flush();
      groups.push({ cues: [cue], chapterId });
      continue;
    }
    if (isNonSpeechAnnotation(cue.text)) {
      flush();
      groups.push({ cues: [cue], chapterId });
      continue;
    }
    const previous = current.at(-1);
    const proposedDuration = current.length ? Math.max(previous.end, cue.end) - Math.min(current[0].start, cue.start) : cue.end - cue.start;
    const proposedLength = current.length
      ? current.reduce((length, item) => length + item.text.length + 1, cue.text.length)
      : cue.text.length;
    const hardBoundary = previous && (chapterForCue(previous, chapters).id !== chapterId || cue.start - previous.end >= HARD_GAP_SECONDS);
    if (current.length && (hardBoundary || proposedDuration > MAX_SCENE_SECONDS || proposedLength > MAX_REFERENCE_LENGTH)) flush();
    current.push(cue);
    const duration = Math.max(...current.map(item => item.end)) - Math.min(...current.map(item => item.start));
    if (duration >= TARGET_SCENE_SECONDS && (terminalBoundary(cue.text) || duration >= MAX_SCENE_SECONDS - 2)) flush();
  }
  flush();

  for (let index = groups.length - 1; index > 0; index -= 1) {
    const group = groups[index];
    const prior = groups[index - 1];
    const duration = Math.max(...group.cues.map(cue => cue.end)) - Math.min(...group.cues.map(cue => cue.start));
    if (duration >= TARGET_SCENE_SECONDS || group.chapterId !== prior.chapterId) continue;
    if ([...prior.cues, ...group.cues].some(isExplicitSourceGroup)) continue;
    if ([...prior.cues, ...group.cues].some(cue => isNonSpeechAnnotation(cue.text))) continue;
    const combined = [...prior.cues, ...group.cues];
    const combinedDuration = Math.max(...combined.map(cue => cue.end)) - Math.min(...combined.map(cue => cue.start));
    const combinedLength = combined.reduce((length, cue) => length + cue.text.length + 1, -1);
    const gap = group.cues[0].start - prior.cues.at(-1).end;
    if (combinedDuration <= MAX_SCENE_SECONDS && combinedLength <= MAX_REFERENCE_LENGTH && gap < HARD_GAP_SECONDS) {
      prior.cues = combined;
      groups.splice(index, 1);
    }
  }

  const paragraphCounts = new Map();
  const groupedCues = groups.map((group, index) => {
    const paragraphIndex = (paragraphCounts.get(group.chapterId) || 0) + 1;
    paragraphCounts.set(group.chapterId, paragraphIndex);
    return combineDialogueCues(group.cues, index, group.chapterId, paragraphIndex);
  });
  const sceneIdsByChapter = new Map();
  for (const cue of groupedCues) {
    const ids = sceneIdsByChapter.get(cue.chapterId) || [];
    ids.push(cue.id);
    sceneIdsByChapter.set(cue.chapterId, ids);
  }
  const populatedChapters = chapters.map(chapter => ({
    ...chapter,
    sceneIds: sceneIdsByChapter.get(chapter.id) || []
  })).filter(chapter => chapter.sceneIds.length);
  return { cues: groupedCues, chapters: populatedChapters };
}

export function segmentCues(cues) {
  const sourceOrder = new Map(cues.map((cue, index) => [cue, index]));
  const orderedCues = [...cues].sort((a, b) => a.start - b.start || sourceOrder.get(a) - sourceOrder.get(b));
  return orderedCues.map((cue, index) => {
    const qualityFlags = [...new Set(cue.qualityFlags || [])];
    const nonSpeechCue = isNonSpeechAnnotation(cue.text);
    if (sourceOrder.get(cue) !== index) qualityFlags.push('cue-time-order-normalized');
    if (cue.end - cue.start > 90) qualityFlags.push('single-cue-over-90-seconds');
    if (nonSpeechCue) qualityFlags.push('non-speech-cue');
    return {
      id: cue.id,
      title: cue.paragraphIndex ? `문단 ${cue.paragraphIndex}` : `학습문장 ${index + 1}`,
      start: cue.start,
      end: cue.end,
      sentenceText: cue.text,
      chapterId: cue.chapterId,
      paragraphIndex: cue.paragraphIndex,
      selectable: cue.originalCueRefs.length > 0 && !nonSpeechCue,
      cues: [cue],
      targets: [],
      qualityFlags,
    };
  });
}

function normalizeForMatch(value) {
  // Keep one UTF-16 code unit for each source character so match offsets remain
  // valid JavaScript slice indexes in the original quote.
  return value.replace(/[‘’]/g, "'").toLocaleLowerCase('en-US');
}

export function validateVideo(video, expressions) {
  const errors = [];
  if (!youtubeVideoIdFromUrl(video.sourceUrl)) errors.push('invalid-youtube-source-url');
  const expressionMap = new Map(expressions.map((expression) => [expression.id, expression]));
  const chapterMap = new Map();
  if (video.chapters !== undefined) {
    if (!Array.isArray(video.chapters) || !video.chapters.length) errors.push('missing-chapters');
    for (const chapter of video.chapters || []) {
      if (!/^chapter-[0-9]{3}$/.test(chapter?.id || '') || chapterMap.has(chapter.id)) errors.push(`${chapter?.id || 'chapter'}: invalid-chapter-id`);
      else chapterMap.set(chapter.id, chapter);
      if (!chapter?.title || !['script-heading', 'whole-video', 'user-provided', 'youtube-chapter', 'youtube-auto-chapter', 'partial-heading-fallback'].includes(chapter?.source)) errors.push(`${chapter?.id || 'chapter'}: invalid-chapter-source`);
      if (!(chapter?.start >= 0 && chapter.start < chapter.end && chapter.end <= video.duration)) errors.push(`${chapter?.id || 'chapter'}: invalid-chapter-time`);
      if (['script-heading', 'user-provided', 'youtube-chapter', 'youtube-auto-chapter', 'partial-heading-fallback'].includes(chapter?.source)) {
        const snapped = chapter.qualityFlags?.includes('chapter-boundary-snapped-to-caption');
        if (!Number.isFinite(chapter.markerStart) || chapter.markerStart < chapter.start || chapter.markerStart >= chapter.end) errors.push(`${chapter.id}: invalid-chapter-marker`);
        if (chapter.snapSeconds !== chapter.markerStart - chapter.start || snapped !== (chapter.snapSeconds > 0)) errors.push(`${chapter.id}: invalid-chapter-snap-provenance`);
      }
      if (!Array.isArray(chapter?.sceneIds) || !chapter.sceneIds.length || new Set(chapter.sceneIds).size !== chapter.sceneIds.length) errors.push(`${chapter?.id || 'chapter'}: invalid-chapter-scenes`);
    }
  }
  let selectableSceneCount = 0;
  for (const scene of video.scenes) {
    if (!(scene.start >= 0 && scene.start < scene.end && scene.end <= video.duration)) errors.push(`${scene.id}: invalid-scene-time`);
    if (scene.sentenceText.length > MAX_REFERENCE_LENGTH) errors.push(`${scene.id}: scene-text-too-long`);
    if (scene.selectable && scene.end - scene.start > MAX_SCENE_SECONDS) errors.push(`${scene.id}: scene-over-${MAX_SCENE_SECONDS}-seconds`);
    if (scene.cues.length !== 1) errors.push(`${scene.id}: scene-must-have-one-cue`);
    const cueMap = new Map(scene.cues.map((cue) => [cue.id, cue]));
    for (const cue of scene.cues) {
      if (!(cue.start >= 0 && cue.start < cue.end && cue.end <= video.duration)) errors.push(`${scene.id}/${cue.id}: invalid-cue-time`);
      if (cue.start < scene.start || cue.end > scene.end) errors.push(`${scene.id}/${cue.id}: cue-outside-scene`);
      for (const ref of cue.originalCueRefs) {
        if (!(ref.start >= 0 && ref.start < ref.end && ref.end <= video.duration)) errors.push(`${scene.id}/${cue.id}/${ref.id}: invalid-original-ref-time`);
      }
      if (cue.sourceCueRefs) {
        const sourceOriginalIds = cue.sourceCueRefs.flatMap(ref => ref.originalCueIds || []);
        const storedOriginalIds = cue.originalCueRefs.map(ref => ref.id);
        if (sourceOriginalIds.length !== storedOriginalIds.length
            || sourceOriginalIds.some((id, index) => id !== storedOriginalIds[index])) {
          errors.push(`${scene.id}/${cue.id}: incomplete-source-cue-refs`);
        }
      }
      if (scene.selectable) selectableSceneCount += 1;
      if (scene.id !== cue.id) errors.push(`${scene.id}/${cue.id}: unstable-scene-id`);
      if (scene.start !== cue.start || scene.end !== cue.end) errors.push(`${scene.id}/${cue.id}: scene-range-must-equal-cue`);
      if (scene.sentenceText !== cue.text) errors.push(`${scene.id}/${cue.id}: sentence-text-mismatch`);
      const expectedSelectable = cue.originalCueRefs.length > 0 && !scene.qualityFlags.includes('non-speech-cue');
      if (scene.selectable !== expectedSelectable) errors.push(`${scene.id}/${cue.id}: selectable-source-mismatch`);
    }
    if (chapterMap.size) {
      const chapter = chapterMap.get(scene.chapterId);
      if (!chapter || !chapter.sceneIds.includes(scene.id)) errors.push(`${scene.id}: missing-scene-chapter`);
      else if (scene.start < chapter.start || scene.end > chapter.end) errors.push(`${scene.id}: scene-outside-chapter`);
      if (!Number.isSafeInteger(scene.paragraphIndex) || scene.paragraphIndex < 1) errors.push(`${scene.id}: invalid-paragraph-index`);
    }
    for (const target of scene.targets) {
      const cue = cueMap.get(target.cueId);
      const expression = expressionMap.get(target.expressionId);
      if (!cue || !expression) {
        errors.push(`${scene.id}/${target.cueId}: missing-cue-or-expression`);
        continue;
      }
      if (target.quote !== cue.text || target.start !== cue.start || target.end !== cue.end) errors.push(`${scene.id}/${target.cueId}: target-source-mismatch`);
      if (!cue.originalCueRefs.length) errors.push(`${scene.id}/${target.cueId}: target-without-original-reference`);
      const matched = target.quote.slice(target.matchStart, target.matchEnd);
      const variants = [expression.term, ...(expression.aliases || [])].map(normalizeForMatch);
      if (!variants.includes(normalizeForMatch(matched))) errors.push(`${scene.id}/${target.cueId}: target-text-mismatch`);
    }
  }
  for (const chapter of chapterMap.values()) {
    const scenes = video.scenes.filter(scene => scene.chapterId === chapter.id);
    if (chapter.sceneIds.join('\u0000') !== scenes.map(scene => scene.id).join('\u0000')) errors.push(`${chapter.id}: chapter-scene-order-mismatch`);
    if (scenes.some((scene, index) => scene.paragraphIndex !== index + 1)) errors.push(`${chapter.id}: chapter-paragraph-order-mismatch`);
  }
  if (!selectableSceneCount) errors.push('no-selectable-learning-scenes');
  if (errors.length) throw new Error(`${video.id} validation failed:\n${errors.join('\n')}`);
  return true;
}

function boundaryAt(text, start, end) {
  const word = /[\p{L}\p{N}]/u;
  return (start === 0 || !word.test(text[start - 1])) && (end === text.length || !word.test(text[end]));
}

function findCandidate(quote, expression) {
  const normalizedQuote = normalizeForMatch(quote);
  const variants = [expression.term, ...(expression.aliases || [])]
    .map((value) => ({ raw: value, normalized: normalizeForMatch(value) }))
    .sort((a, b) => b.normalized.length - a.normalized.length);

  for (const variant of variants) {
    let from = 0;
    while (from <= normalizedQuote.length - variant.normalized.length) {
      const start = normalizedQuote.indexOf(variant.normalized, from);
      if (start === -1) break;
      const end = start + variant.normalized.length;
      if (boundaryAt(normalizedQuote, start, end)) return { start, end, variant: variant.raw };
      from = start + 1;
    }
  }
  return null;
}

export function addTargets(scenes, expressions) {
  for (const scene of scenes) {
    const candidates = [];
    for (const cue of scene.cues) {
      if (!cue.originalCueRefs.length) continue;
      for (const expression of expressions) {
        const match = findCandidate(cue.text, expression);
        if (!match) continue;
        candidates.push({
          expressionId: expression.id,
          cueId: cue.id,
          quote: cue.text,
          start: cue.start,
          end: cue.end,
          matchStart: match.start,
          matchEnd: match.end,
          matchedVariant: match.variant,
          difficulty: expression.difficulty,
          tokenCount: normalizeForMatch(match.variant).split(/\s+/).length,
        });
      }
    }

    candidates.sort((a, b) =>
      b.tokenCount - a.tokenCount
      || (a.difficulty === 'starter' ? -1 : 1) - (b.difficulty === 'starter' ? -1 : 1)
      || a.start - b.start
      || a.matchStart - b.matchStart
      || a.expressionId.localeCompare(b.expressionId));

    const selected = [];
    const seen = new Set();
    for (const candidate of candidates) {
      if (seen.has(candidate.expressionId)) continue;
      seen.add(candidate.expressionId);
      const { difficulty, tokenCount, matchedVariant, ...target } = candidate;
      selected.push(target);
    }
    scene.targets = selected;
  }
  return scenes;
}

export function validateExpressionBank(expressions) {
  const ids = new Set();
  const errors = [];
  for (const [index, expression] of expressions.entries()) {
    const label = expression.id || `index-${index}`;
    if (!expression.id || ids.has(expression.id)) errors.push(`${label}: duplicate-or-missing-id`);
    ids.add(expression.id);
    if (!expression.term || !expression.ipa || !expression.meaningKo || !expression.explanationKo) errors.push(`${label}: missing-learning-field`);
    for (const alias of expression.aliases || []) {
      if (normalizeForMatch(alias) !== normalizeForMatch(expression.term)) errors.push(`${label}: unsafe-alias-must-be-orthographic-variant`);
    }
    if (!['starter', 'everyday'].includes(expression.difficulty)) errors.push(`${label}: invalid-difficulty`);
    if (expression.generationMethod !== GENERATION_METHOD || expression.sourceStatus !== 'captured-not-audio-verified' || expression.reviewStatus !== 'unreviewed' || expression.contentVersion !== EXPRESSION_CONTENT_VERSION) errors.push(`${label}: invalid-provenance`);
    if (!Array.isArray(expression.dialogues) || expression.dialogues.length !== 2) errors.push(`${label}: requires-exactly-two-dialogues`);
    for (const dialogue of expression.dialogues || []) {
      if (dialogue.provenance !== 'original-editorial' || !Array.isArray(dialogue.lines) || dialogue.lines.length < 2) errors.push(`${label}: invalid-dialogue`);
      if (!dialogue.lines?.some((line) => findCandidate(line.en || '', { term: expression.term, aliases: [] }))) errors.push(`${label}: dialogue-missing-canonical-term`);
    }
  }
  if (errors.length) throw new Error(`Expression bank validation failed:\n${errors.join('\n')}`);
}

async function loadPair(cleanPath, originalPath) {
  const [cleanText, originalText] = await Promise.all([readFile(cleanPath, 'utf8'), readFile(originalPath, 'utf8')]);
  return {
    cleaned: parseTranscriptText(cleanText, cleanPath),
    original: parseTranscriptText(originalText, originalPath),
  };
}

function sentenceCount(text) {
  return Math.max(1, text.match(/[.!?…]+(?:[”"')\]]+)?(?=\s|$)/g)?.length || 0);
}

function median(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

export async function buildCatalog({ rootDir, outputDir, reportPath, expressionPath }) {
  const cleanDir = path.join(rootDir, 'resource/Bluey_Season3_Scripts/txt_1_shadowing');
  const originalDir = path.join(rootDir, 'resource/Bluey_Season3_Scripts/txt_2_youtube_original');
  const expressions = JSON.parse(await readFile(expressionPath, 'utf8'));
  validateExpressionBank(expressions);
  const vocabulary = JSON.parse(await readFile(path.join(rootDir, 'content/vocabulary.json'), 'utf8'));
  if (!Array.isArray(vocabulary) || vocabulary.some((entry) => !entry.term || !entry.ipa || !entry.meaningKo || !entry.explanationKo)) throw new Error('Offline vocabulary must be an array of complete study entries');
  const groupingManifest = JSON.parse(await readFile(path.join(rootDir, 'content/transcript-groups.json'), 'utf8'));
  if (groupingManifest.contentVersion !== SOURCE_GROUPING_VERSION) throw new Error('Transcript grouping manifest source version does not match the builder');
  const chapterManifest = JSON.parse(await readFile(path.join(rootDir, 'content/chapter-metadata.json'), 'utf8'));
  if (chapterManifest.contentVersion !== CONTENT_VERSION) throw new Error('Chapter metadata version does not match the builder');

  const fileNames = (await readdir(cleanDir)).filter((name) => name.endsWith('.txt')).sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
  await mkdir(path.join(outputDir, 'videos'), { recursive: true });
  const catalogVideos = [];
  const videoReports = [];
  const learningSceneDurations = [];
  let overTwoSentenceCueCount = 0;
  const overTwoSentenceCueExamples = [];

  for (const fileName of fileNames) {
    const originalPath = path.join(originalDir, fileName);
    const cleanPath = path.join(cleanDir, fileName);
    const markdownPath = path.join(rootDir, 'resource/Bluey_Season3_Scripts', fileName.replace(/\.txt$/i, '.md'));
    const [{ cleaned, original }, markdownText] = await Promise.all([loadPair(cleanPath, originalPath), readFile(markdownPath, 'utf8')]);
    const cleanedVideoId = youtubeVideoIdFromUrl(cleaned.sourceUrl);
    const originalVideoId = youtubeVideoIdFromUrl(original.sourceUrl);
    if (!cleanedVideoId || !originalVideoId || cleanedVideoId !== originalVideoId) throw new Error(`${fileName}: invalid or mismatched YouTube source URL`);
    const numberMatch = fileName.match(/^(\d+)_/);
    const number = numberMatch ? Number(numberMatch[1]) : catalogVideos.length + 1;
    const id = `video-${String(number).padStart(2, '0')}`;
    const aligned = alignCleanedCues(cleaned, original);
    const groupedCues = buildOriginalCueGroups(original, cleaned, groupingManifest.videos[id] || []);
    const maxCueEnd = Math.max(0, ...groupedCues.map((cue) => cue.end), ...original.cues.map((cue) => cue.end));
    const duration = Math.max(cleaned.declaredDuration, original.declaredDuration, maxCueEnd);
    const qualityFlags = [];
    if (maxCueEnd > cleaned.declaredDuration) qualityFlags.push('declared-duration-shorter-than-cues');
    if (aligned.repairedZeroDuration) qualityFlags.push('contains-repaired-zero-duration-cues');
    if (aligned.excludedZeroDuration) qualityFlags.push('contains-excluded-zero-duration-cues');
    if (aligned.cues.some((cue) => cue.qualityFlags.includes('no-original-overlap'))) qualityFlags.push('contains-cues-without-original-overlap');

    if ((groupingManifest.videos[id] || []).length) qualityFlags.push('contains-explicit-source-grouping');
    const videoChapterMetadata = chapterManifest.videos[id];
    let capturedHeadings;
    if (videoChapterMetadata?.scriptSource) {
      const scriptSourcePath = path.join(rootDir, videoChapterMetadata.scriptSource);
      const chapteredTranscript = parseChapteredTranscriptText(await readFile(scriptSourcePath, 'utf8'), scriptSourcePath);
      if (chapteredTranscript.expectedChapterCount !== videoChapterMetadata.expectedChapterCount) {
        throw new Error(`${fileName}: chapter source expected count does not match metadata`);
      }
      capturedHeadings = chapteredTranscript.chapters.map((chapter, chapterIndex, chapters) => ({
        title: chapter.title,
        markerStart: chapter.markerStart,
        source: 'user-provided',
        coverage: chapterIndex < chapters.length - 1 ? 'confirmed-boundaries' : 'confirmed-excerpt',
        provenance: 'user-provided-chapter-title-and-start',
      }));
      if (videoChapterMetadata.unverifiedRemainder) capturedHeadings.push(videoChapterMetadata.unverifiedRemainder);
    } else {
      capturedHeadings = videoChapterMetadata?.chapters || parseScriptHeadings(markdownText);
    }
    const headings = capturedHeadings.map(heading => {
      // Cubby's captured episode announcement says "Puppy". Preserve that
      // source label while correcting this known title mismatch in navigation.
      if (id === 'video-23' && cleaned.title === 'Cubby' && heading.title === 'Puppy' && heading.markerStart === 43) {
        return { ...heading, title: cleaned.title, capturedTitle: heading.title };
      }
      return heading;
    });
    if (headings.some(heading => heading.capturedTitle)) qualityFlags.push('contains-corrected-chapter-title');
    const groupedDialogue = groupDialogueCues(groupedCues, headings, cleaned.title);
    const scenes = addTargets(segmentCues(groupedDialogue.cues), expressions);
    if (scenes.some((scene) => scene.qualityFlags.includes('cue-time-order-normalized'))) qualityFlags.push('contains-time-normalized-cue-order');
    const nonSpeechCueCount = scenes.filter((scene) => scene.qualityFlags.includes('non-speech-cue')).length;
    const correctedTextSceneCount = scenes.filter((scene) => scene.qualityFlags.includes('corrected-text-exact-coverage')).length;
    const rawOriginalTextSceneCount = scenes.filter((scene) => scene.qualityFlags.includes('raw-original-text')).length;
    const annotationRemovedSceneCount = scenes.filter((scene) => scene.qualityFlags.includes('non-spoken-annotation-removed')).length;
    if (nonSpeechCueCount) qualityFlags.push('contains-non-speech-cues');
    if (rawOriginalTextSceneCount) qualityFlags.push('contains-raw-original-text');
    if (annotationRemovedSceneCount) qualityFlags.push('contains-non-spoken-annotation-removal');
    const learningScenes = scenes.filter((scene) => scene.selectable);
    if (!learningScenes.length) throw new Error(`${fileName}: no source-backed learning cue`);
    for (const scene of learningScenes) {
      learningSceneDurations.push(scene.end - scene.start);
      const sentences = sentenceCount(scene.sentenceText);
      if (sentences > 2) {
        overTwoSentenceCueCount += 1;
        if (overTwoSentenceCueExamples.length < 25) overTwoSentenceCueExamples.push({ videoId: id, sceneId: scene.id, sentences, text: scene.sentenceText });
      }
    }
    const expressionCount = new Set(learningScenes.flatMap((scene) => scene.targets.map((target) => target.expressionId))).size;
    const video = {
      id,
      number,
      title: cleaned.title,
      duration,
      declaredDuration: cleaned.declaredDuration,
      captionType: cleaned.captionType,
      sourceUrl: cleaned.sourceUrl,
      sourceFiles: {
        cleaned: path.relative(rootDir, cleanPath),
        original: path.relative(rootDir, originalPath),
      },
      qualityFlags,
      generationMethod: GENERATION_METHOD,
      sourceStatus: 'captured-not-audio-verified',
      reviewStatus: 'unreviewed',
      contentVersion: CONTENT_VERSION,
      groupingMethod: '5-to-15-second-dialogue-paragraphs+script-headings+explicit-source-groups',
      ...(chapterManifest.videos[id] ? {
        chapterMetadataStatus: chapterManifest.videos[id].status,
        expectedChapterCount: chapterManifest.videos[id].expectedChapterCount
      } : {}),
      chapters: groupedDialogue.chapters,
      scenes,
    };
    validateVideo(video, expressions);
    await writeFile(path.join(outputDir, 'videos', `${id}.json`), `${JSON.stringify(video, null, 2)}\n`);
    catalogVideos.push({ id, number, title: video.title, duration, captionType: video.captionType, sourceUrl: video.sourceUrl, chapterCount: video.chapters.length, sceneCount: learningScenes.length, expressionCount, qualityFlags });
    videoReports.push({ id, fileName, cueCount: groupedCues.length, originalCueCount: original.cues.length, cleanedCueCount: cleaned.cues.length, chapterCount: video.chapters.length, sceneCount: scenes.length, learningSceneCount: learningScenes.length, expressionCount, nonSpeechCueCount, correctedTextSceneCount, rawOriginalTextSceneCount, annotationRemovedSceneCount, repairedZeroDuration: aligned.repairedZeroDuration, excludedZeroDuration: aligned.excludedZeroDuration, rejectedCueCount: aligned.rejected.length, qualityFlags });
  }

  const generatedAt = new Date(Number(process.env.SOURCE_DATE_EPOCH || 1790294400) * 1000).toISOString();
  const catalog = { version: CONTENT_VERSION, generatedAt, videos: catalogVideos };
  await writeFile(path.join(outputDir, 'catalog.json'), `${JSON.stringify(catalog, null, 2)}\n`);
  await writeFile(path.join(outputDir, 'expressions.json'), `${JSON.stringify(expressions, null, 2)}\n`);
  await writeFile(path.join(outputDir, 'vocabulary.json'), `${JSON.stringify(vocabulary, null, 2)}\n`);
  await writeFile(path.join(outputDir, 'word-families.json'), await readFile(path.join(rootDir, 'content/word-families.json')));

  const report = {
    contentVersion: CONTENT_VERSION,
    generatedAt,
    generationMethod: GENERATION_METHOD,
    sourceStatus: 'captured-not-audio-verified',
    videoCount: catalogVideos.length,
    expressionBankCount: expressions.length,
    totals: {
      cues: videoReports.reduce((sum, item) => sum + item.cueCount, 0),
      originalCues: videoReports.reduce((sum, item) => sum + item.originalCueCount, 0),
      cleanedCues: videoReports.reduce((sum, item) => sum + item.cleanedCueCount, 0),
      scenes: videoReports.reduce((sum, item) => sum + item.sceneCount, 0),
      chapters: videoReports.reduce((sum, item) => sum + item.chapterCount, 0),
      learningScenes: videoReports.reduce((sum, item) => sum + item.learningSceneCount, 0),
      nonSpeechCues: videoReports.reduce((sum, item) => sum + item.nonSpeechCueCount, 0),
      correctedTextScenes: videoReports.reduce((sum, item) => sum + item.correctedTextSceneCount, 0),
      rawOriginalTextScenes: videoReports.reduce((sum, item) => sum + item.rawOriginalTextSceneCount, 0),
      annotationRemovedScenes: videoReports.reduce((sum, item) => sum + item.annotationRemovedSceneCount, 0),
      repairedZeroDuration: videoReports.reduce((sum, item) => sum + item.repairedZeroDuration, 0),
      excludedZeroDuration: videoReports.reduce((sum, item) => sum + item.excludedZeroDuration, 0),
      rejectedCues: videoReports.reduce((sum, item) => sum + item.rejectedCueCount, 0),
    },
    learningSceneDurations: {
      targetSeconds: TARGET_SCENE_SECONDS,
      maximumSeconds: MAX_SCENE_SECONDS,
      medianSeconds: median(learningSceneDurations),
      maxSeconds: Math.max(0, ...learningSceneDurations),
      belowTargetCount: learningSceneDurations.filter(duration => duration < TARGET_SCENE_SECONDS).length,
      withinTargetCount: learningSceneDurations.filter(duration => duration >= TARGET_SCENE_SECONDS && duration <= MAX_SCENE_SECONDS).length,
      overTwoSentenceCueCount,
      overTwoSentenceCueExamples,
    },
    coverage: {
      videosWithLearningScenes: videoReports.filter((item) => item.learningSceneCount > 0).length,
      videosWithoutLearningScenes: videoReports.filter((item) => item.learningSceneCount === 0).map((item) => item.id),
    },
    notes: [
      'Cue text is captured transcript data and has not been checked against audio.',
      'Learning scenes group consecutive captured cues into dialogue paragraphs targeting 5 seconds and never exceeding 15 seconds, while parent-specified source groups remain standalone.',
      'Verified YouTube chapter metadata takes precedence when available; script headings are used only as a labeled study-section fallback, and videos without either source use one whole-video section.',
      'Corrected text is used only when cleaned cues cover each referenced original cue exactly; otherwise captured original text is retained.',
      'Scene IDs are newly assigned within this content version and must not be joined to progress from older content versions.',
      'Broad IPA is an editorial learning aid and may differ from Australian speech in the videos.',
      'A longer effective duration is used when captured cues exceed the declared video length.',
      'Every scene preserves its captured original cue references; source-backed speech remains learnable even without a curated expression match.',
      'Bracket-only or parenthesis-only music and sound labels remain in source order with a non-speech flag but are not selectable for dictation.',
    ],
    videos: videoReports,
  };
  await mkdir(path.dirname(reportPath), { recursive: true });
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  return { catalog, report, expressions, vocabulary };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const result = await buildCatalog({
    rootDir,
    outputDir: path.join(rootDir, 'public/data'),
    reportPath: path.join(rootDir, 'docs/CATALOG_REPORT.json'),
    expressionPath: path.join(rootDir, 'content/expressions.json'),
  });
  console.log(`Built ${result.catalog.videos.length} videos with ${result.report.totals.learningScenes} learning scenes.`);
}
