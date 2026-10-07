export function parseTimedText(value, duration) {
  const lines = String(value || '').split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  if (!lines.length || lines.length > 1000) throw new Error('시간이 붙은 대본·목차를 1~1,000줄 입력해 주세요.');
  return lines.map((line, index) => {
    const match = line.match(/^(?:(\d{1,2}):)?(\d{1,3}):(\d{2})\s+(.+)$/);
    if (!match || Number(match[3]) >= 60 || (match[1] && Number(match[2]) >= 60)) throw new Error(`${index + 1}번째 줄을 “0:00 내용” 형식으로 적어 주세요.`);
    const start = Number(match[1] || 0) * 3600 + Number(match[2]) * 60 + Number(match[3]);
    if (start >= duration) throw new Error('대본·목차 시간은 영상 길이보다 짧아야 해요.');
    return { start, text: match[4] };
  }).map((line, index, all) => {
    if (index && line.start <= all[index - 1].start) throw new Error('시간은 이전 줄보다 뒤여야 해요.');
    return line;
  });
}

export function compileCustomVideo(video) {
  const duration = Number(video.durationSeconds ?? video.duration);
  if (!Number.isFinite(duration) || duration < 1 || duration > 86400) throw new Error('영상 길이는 1~86,400초로 입력해 주세요.');
  const cues = parseTimedText(video.transcript, duration);
  const inputChapters = Array.isArray(video.chapters) ? video.chapters : [];
  const markers = inputChapters.length ? inputChapters.map(item => ({ start: Number(item.startSeconds), end: item.endSeconds == null ? null : Number(item.endSeconds), title: item.title })) : [{ start: 0, end: duration, title: '전체 영상' }];
  const chapters = [];
  const snapStart = marker => marker === 0 ? 0 : (cues.filter(cue => cue.start <= marker).at(-1)?.start ?? 0);
  for (let index = 0; index < markers.length; index += 1) {
    const marker = markers[index];
    const nextMarker = markers[index + 1]?.start ?? duration;
    if (!Number.isFinite(marker.start) || marker.start < 0 || marker.start >= duration || nextMarker <= marker.start) throw new Error('챕터 시작 시각을 영상 범위 안에서 순서대로 입력해 주세요.');
    const start = snapStart(marker.start);
    const end = marker.end ?? (nextMarker === duration ? duration : snapStart(nextMarker));
    if (end <= start || end > nextMarker || end > duration) throw new Error('챕터 시간이 겹치거나 너무 짧아요. 대본 시각에 맞춰 목차를 조정해 주세요.');
    if (marker.end != null && end !== duration && !cues.some(cue => cue.start === end)) throw new Error('챕터 종료 시각에 대본 줄을 추가해 주세요. 문장이 챕터 경계를 넘지 않게 해요.');
    const previousEnd = chapters.at(-1)?.end ?? 0;
    if (start < previousEnd) throw new Error('챕터 시간이 겹쳐요. 시작·종료 시각을 확인해 주세요.');
    if (start > previousEnd) chapters.push({ start: previousEnd, end: start, title: chapters.length ? '목차 사이 대화' : '도입부', source: 'study-gap' });
    chapters.push({ start, end, markerStart: marker.start, title: marker.title, source: 'user-provided' });
  }
  if (chapters.at(-1).end < duration) chapters.push({ start: chapters.at(-1).end, end: duration, title: '이후 대화', source: 'study-gap' });
  const scenes = cues.map((cue, index) => ({
    id: `c${String(index + 1).padStart(4, '0')}`, start: cue.start, end: cues[index + 1]?.start ?? duration,
    sentenceText: cue.text, text: cue.text, selectable: true, targets: [], qualityFlags: []
  }));
  const id = `custom-${video.youtubeId}`;
  // A transcript edit creates a new version; historical learning remains separate.
  const content = JSON.stringify(['timing-v2', duration, video.transcript, inputChapters]);
  let hash = 2166136261;
  for (const char of content) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619) >>> 0;
  const contentVersion = `custom-${hash.toString(16)}`;
  const data = {
    id, title: video.title, sourceUrl: video.url, duration, contentVersion, scenes,
    captionType: '직접 추가한 영어 대본', sourceStatus: 'user-provided', reviewStatus: 'unreviewed',
    sourceFiles: {}, qualityFlags: [], topics: video.topics, custom: true,
    chapterMetadataStatus: inputChapters.length ? 'user-provided' : 'whole-video',
    chapters: chapters.map((chapter, index) => {
      return { id: `chapter-${String(index + 1).padStart(3, '0')}`, title: chapter.title, start: chapter.start, end: chapter.end, markerStart: chapter.markerStart,
        source: chapter.source, coverage: 'confirmed-boundaries',
        sceneIds: scenes.filter(scene => scene.start >= chapter.start && scene.start < chapter.end).map(scene => scene.id) };
    })
  };
  return { ...data, sceneCount: scenes.length, expressionCount: 0, createdAt: video.createdAt, libraryId: video.id };
}
