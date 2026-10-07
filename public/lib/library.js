const MAX_CHANNELS = 100;
const MAX_VIDEOS = 500;
const MAX_CHAPTERS = 100;
const ID_PATTERN = /^(?:channel|video):[A-Za-z0-9_-]{1,128}$/;

export function emptyLibrary() {
  return { version: 1, channels: [], videos: [] };
}

export function channelIdFromUuid(uuid) {
  const value = String(uuid || '').trim().toLowerCase();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value)) {
    throw new Error('올바른 채널 UUID가 필요합니다.');
  }
  return `channel:${value}`;
}

export function normalizeLibrary(value) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const channels = Array.isArray(source.channels) ? source.channels.map(normalizeChannel) : [];
  const videos = Array.isArray(source.videos) ? source.videos.map(normalizeVideo) : [];
  if (channels.length > MAX_CHANNELS) throw new Error(`채널은 ${MAX_CHANNELS}개까지 저장할 수 있습니다.`);
  if (videos.length > MAX_VIDEOS) throw new Error(`영상은 ${MAX_VIDEOS}개까지 저장할 수 있습니다.`);
  assertUnique(channels, '채널');
  assertUnique(videos, '영상');
  const channelIds = new Set(channels.map(({ id }) => id));
  for (const video of videos) {
    if (video.channelId && !channelIds.has(video.channelId)) {
      throw new Error('영상의 채널이 현재 라이브러리에 없습니다.');
    }
  }
  return { version: 1, channels, videos };
}

export function upsertLibraryChannel(library, channel) {
  const current = normalizeLibrary(library);
  const normalized = normalizeChannel(channel);
  return normalizeLibrary({ ...current, channels: upsertById(current.channels, normalized) });
}

export function upsertLibraryVideo(library, video) {
  const current = normalizeLibrary(library);
  const normalized = normalizeVideo(video);
  return normalizeLibrary({ ...current, videos: upsertById(current.videos, normalized) });
}

export function removeLibraryChannel(library, channelId) {
  const current = normalizeLibrary(library);
  const id = normalizeId(channelId, 'channel');
  return {
    ...current,
    channels: current.channels.filter((channel) => channel.id !== id),
    videos: current.videos.map((video) => video.channelId === id ? { ...video, channelId: null } : video),
  };
}

export function removeLibraryVideo(library, videoId) {
  const current = normalizeLibrary(library);
  const id = normalizeId(videoId, 'video');
  return { ...current, videos: current.videos.filter((video) => video.id !== id) };
}

export function sortLibraryVideos(videos, options = {}) {
  const topic = cleanOptional(options.topic, 80).toLocaleLowerCase('en-US');
  const tag = cleanOptional(options.tag, 80).toLocaleLowerCase('en-US');
  const channelId = cleanOptional(options.channelId, 140);
  const query = cleanOptional(options.query, 200).toLocaleLowerCase('en-US');
  const direction = options.direction === 'desc' ? -1 : 1;
  const sortBy = ['title', 'createdAt', 'updatedAt', 'channel'].includes(options.sortBy) ? options.sortBy : 'title';
  return videos.map(normalizeVideo).filter((video) => {
    if (channelId && video.channelId !== channelId) return false;
    if (topic && !video.topics.some((item) => item.toLocaleLowerCase('en-US') === topic)) return false;
    if (tag && !video.tags.some((item) => item.toLocaleLowerCase('en-US') === tag)) return false;
    if (query) {
      const text = [video.title, video.transcript, ...video.topics, ...video.tags]
        .join(' ').toLocaleLowerCase('en-US');
      if (!text.includes(query)) return false;
    }
    return true;
  }).sort((left, right) => {
    const a = sortBy === 'channel' ? (left.channelId || '') : left[sortBy];
    const b = sortBy === 'channel' ? (right.channelId || '') : right[sortBy];
    return String(a).localeCompare(String(b), 'ko', { numeric: true, sensitivity: 'base' }) * direction;
  });
}

export function libraryFacets(library) {
  const current = normalizeLibrary(library);
  return {
    topics: uniqueSorted(current.videos.flatMap(({ topics }) => topics)),
    tags: uniqueSorted(current.videos.flatMap(({ tags }) => tags)),
  };
}

export function youtubeVideoId(value) {
  const input = cleanRequired(value, 'YouTube 영상 주소 또는 ID', 500);
  if (/^[A-Za-z0-9_-]{11}$/.test(input)) return input;
  let url;
  try { url = new URL(input); } catch { throw new Error('올바른 YouTube 영상 주소가 필요합니다.'); }
  const host = url.hostname.toLowerCase().replace(/^www\./, '');
  let id = '';
  if (host === 'youtu.be') id = url.pathname.split('/').filter(Boolean)[0] || '';
  if (host === 'youtube.com' || host === 'm.youtube.com') {
    if (url.pathname === '/watch') id = url.searchParams.get('v') || '';
    else if (/^\/(?:shorts|embed)\//.test(url.pathname)) id = url.pathname.split('/')[2] || '';
  }
  if (!/^[A-Za-z0-9_-]{11}$/.test(id)) throw new Error('올바른 YouTube 영상 주소가 필요합니다.');
  return id;
}

function normalizeChannel(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('채널 정보 형식이 올바르지 않습니다.');
  const url = normalizeYoutubeUrl(value.url, 'channel');
  return {
    id: normalizeId(value.id, 'channel'),
    title: cleanRequired(value.title, '채널 이름', 200),
    url,
    topics: normalizeLabels(value.topics, '주제'),
    tags: normalizeLabels(value.tags, '태그'),
    createdAt: normalizeTimestamp(value.createdAt, '채널 등록 시간'),
    updatedAt: normalizeTimestamp(value.updatedAt, '채널 수정 시간'),
  };
}

function normalizeVideo(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('영상 정보 형식이 올바르지 않습니다.');
  const youtubeId = youtubeVideoId(value.youtubeId || value.url);
  const id = normalizeId(value.id, 'video');
  if (id !== `video:${youtubeId}`) throw new Error('영상 ID는 YouTube 영상 ID와 일치해야 합니다.');
  const durationSeconds = Number(value.durationSeconds);
  if (!Number.isFinite(durationSeconds) || durationSeconds < 1 || durationSeconds > 86400) {
    throw new Error('영상 길이는 1초 이상 24시간 이하로 입력해 주세요.');
  }
  const chapters = Array.isArray(value.chapters) ? value.chapters.map(normalizeChapter) : [];
  if (chapters.length > MAX_CHAPTERS) throw new Error(`챕터는 영상당 ${MAX_CHAPTERS}개까지 저장할 수 있습니다.`);
  if (chapters.some((chapter) => chapter.startSeconds >= durationSeconds
      || (chapter.endSeconds !== null && chapter.endSeconds > durationSeconds))) {
    throw new Error('챕터 시간은 영상 길이 안에 있어야 합니다.');
  }
  for (let index = 1; index < chapters.length; index += 1) {
    if (chapters[index].startSeconds <= chapters[index - 1].startSeconds) {
      throw new Error('챕터 시작 시간은 앞 챕터보다 뒤여야 합니다.');
    }
  }
  return {
    id,
    youtubeId,
    url: `https://www.youtube.com/watch?v=${youtubeId}`,
    title: cleanRequired(value.title, '영상 제목', 300),
    durationSeconds,
    channelId: value.channelId == null || value.channelId === '' ? null : normalizeId(value.channelId, 'channel'),
    topics: normalizeLabels(value.topics, '주제'),
    tags: normalizeLabels(value.tags, '태그'),
    transcript: cleanOptional(value.transcript, 100000),
    chapters,
    createdAt: normalizeTimestamp(value.createdAt, '영상 등록 시간'),
    updatedAt: normalizeTimestamp(value.updatedAt, '영상 수정 시간'),
  };
}

function normalizeChapter(value, index) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('챕터 정보 형식이 올바르지 않습니다.');
  const startSeconds = Number(value.startSeconds);
  const endSeconds = value.endSeconds == null || value.endSeconds === '' ? null : Number(value.endSeconds);
  if (!Number.isFinite(startSeconds) || startSeconds < 0 || startSeconds > 86400) throw new Error('챕터 시작 시간은 초 단위로 입력해 주세요.');
  if (endSeconds !== null && (!Number.isFinite(endSeconds) || endSeconds <= startSeconds || endSeconds > 86400)) {
    throw new Error('챕터 종료 시간은 시작 시간보다 뒤여야 합니다.');
  }
  return {
    id: cleanOptional(value.id, 140) || `chapter:${index + 1}`,
    title: cleanRequired(value.title, '챕터 제목', 200),
    startSeconds,
    endSeconds,
    transcript: cleanOptional(value.transcript, 20000),
  };
}

function normalizeYoutubeUrl(value, type) {
  const input = cleanRequired(value, type === 'channel' ? 'YouTube 채널 주소' : 'YouTube 주소', 500);
  let url;
  try { url = new URL(input); } catch { throw new Error('올바른 YouTube 채널 주소가 필요합니다.'); }
  const host = url.hostname.toLowerCase().replace(/^www\./, '');
  if (!['youtube.com', 'm.youtube.com'].includes(host) || !/^\/(?:@|channel\/|c\/|user\/)/.test(url.pathname)) {
    throw new Error('올바른 YouTube 채널 주소가 필요합니다.');
  }
  url.protocol = 'https:';
  url.hash = '';
  url.search = '';
  return url.toString().replace(/\/$/, '');
}

function normalizeId(value, prefix) {
  const id = String(value || '').trim();
  if (!ID_PATTERN.test(id) || !id.startsWith(`${prefix}:`)) throw new Error(`올바른 ${prefix === 'video' ? '영상' : '채널'} ID가 필요합니다.`);
  if (prefix === 'channel' && channelIdFromUuid(id.slice('channel:'.length)) !== id.toLowerCase()) {
    throw new Error('올바른 채널 ID가 필요합니다.');
  }
  return prefix === 'channel' ? id.toLowerCase() : id;
}

function normalizeLabels(value, name) {
  if (value == null) return [];
  if (!Array.isArray(value) || value.length > 30) throw new Error(`${name}는 30개까지 입력할 수 있습니다.`);
  const result = [...new Set(value.map((item) => cleanRequired(item, name, 80)))];
  if (result.length !== value.length) throw new Error(`${name}는 중복 없이 입력해 주세요.`);
  return result;
}

function normalizeTimestamp(value, name) {
  if (typeof value !== 'string' || value.length > 40
      || !/^[0-9]{4}-[0-9]{2}-[0-9]{2}T(?:[01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9](?:\.[0-9]{1,6})?(?:Z|[+-](?:[01][0-9]|2[0-3]):[0-5][0-9])$/.test(value)
      || !Number.isFinite(Date.parse(value))) throw new Error(`${name}이 올바르지 않습니다.`);
  return value;
}

function cleanRequired(value, name, max) {
  const result = String(value ?? '').normalize('NFKC').trim();
  if (!result) throw new Error(`${name}이 필요합니다.`);
  if (result.length > max) throw new Error(`${name}은 ${max}자 이하여야 합니다.`);
  return result;
}

function cleanOptional(value, max) {
  const result = String(value ?? '').normalize('NFKC').trim();
  if (result.length > max) throw new Error(`${max}자 이하로 입력해 주세요.`);
  return result;
}

function upsertById(items, value) {
  const index = items.findIndex(({ id }) => id === value.id);
  if (index < 0) return [...items, value];
  return items.map((item, itemIndex) => itemIndex === index ? value : item);
}

function assertUnique(items, name) {
  if (new Set(items.map(({ id }) => id)).size !== items.length) throw new Error(`${name} ID는 중복될 수 없습니다.`);
}

function uniqueSorted(values) {
  return [...new Map(values.map((value) => [value.toLocaleLowerCase('en-US'), value])).values()]
    .sort((a, b) => a.localeCompare(b, 'ko', { numeric: true, sensitivity: 'base' }));
}
