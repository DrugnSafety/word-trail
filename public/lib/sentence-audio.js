import { createPlayer } from './player.js';

function sourceVideoId(url = '') {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.port) return '';
    const host = parsed.hostname.toLowerCase();
    let id = '';
    if (host === 'youtu.be') {
      const parts = parsed.pathname.split('/').filter(Boolean);
      if (parts.length !== 1) return '';
      [id] = parts;
    } else if (host === 'youtube.com' || host === 'www.youtube.com') {
      if (parsed.pathname !== '/watch' || parsed.searchParams.getAll('v').length !== 1) return '';
      id = parsed.searchParams.get('v');
    }
    return /^[\w-]{11}$/.test(id || '') ? id : '';
  } catch {
    return '';
  }
}

export function findSentenceClip(record, video) {
  if (typeof record?.videoId !== 'string' || !record.videoId.trim()
    || typeof record.sceneId !== 'string' || !record.sceneId.trim()
    || typeof record.contentVersion !== 'string' || !record.contentVersion.trim()
    || typeof record.reference !== 'string' || !record.reference.trim()
    || typeof video?.id !== 'string' || !video.id.trim()
    || typeof video.contentVersion !== 'string' || !video.contentVersion.trim()) return null;
  if (!record || !video || record.videoId !== video.id || record.contentVersion !== video.contentVersion) return null;
  const scene = (video.scenes || []).find(item => item?.id === record.sceneId);
  if (!scene?.selectable || String(scene.sentenceText) !== String(record.reference)) return null;
  const videoId = sourceVideoId(video.sourceUrl);
  const start = Number(scene.start);
  const end = Number(scene.end);
  if (!videoId || !Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start) return null;
  return { videoId, start, end };
}

export function createSentencePlayback({
  element,
  loadVideo,
  onStatus = () => {},
  rate = 1,
  playerFactory = createPlayer
} = {}) {
  if (!element || typeof loadVideo !== 'function' || typeof playerFactory !== 'function') {
    throw new TypeError('문장 영상 플레이어 설정이 올바르지 않아요.');
  }
  let player = null;
  let prepared = false;
  let active = false;
  let operation = 0;
  let playIntent = 0;
  let closed = false;
  let activityRevision = 0;
  let lastActivityType = '';

  const notify = event => {
    if (closed || !event) return;
    if (event.type === 'playing') { active = true; activityRevision += 1; lastActivityType = event.type; }
    if (['paused', 'autoplay-blocked', 'error'].includes(event.type)) { active = false; activityRevision += 1; lastActivityType = event.type; }
    onStatus(event);
  };

  function discardPlayer() {
    const previous = player;
    player = null;
    prepared = false;
    active = false;
    previous?.destroy?.();
  }

  async function prepare(record, { autoplay = true } = {}) {
    if (closed) return false;
    const currentOperation = ++operation;
    const autoplayIntent = autoplay ? ++playIntent : null;
    discardPlayer();
    active = Boolean(autoplay);
    if (autoplay) notify({ type: 'info', message: '문장 영상을 준비하고 있어요.' });
    if (!record?.videoId) {
      active = false;
      notify({ type: 'info', message: '이 문장의 원본 영상 정보를 찾지 못했어요.' });
      return false;
    }

    let video;
    try {
      video = await loadVideo(record.videoId);
    } catch (error) {
      if (currentOperation !== operation || closed) return false;
      active = false;
      notify({ type: 'error', message: `문장 영상을 불러오지 못했어요: ${error?.message || '연결을 확인해 주세요.'}` });
      return false;
    }
    if (currentOperation !== operation || closed) return false;

    const clip = findSentenceClip(record, video);
    if (!clip) {
      active = false;
      notify({ type: 'info', message: '현재 자료 버전과 정확히 일치하는 문장 영상 구간이 없어요.' });
      return false;
    }

    let instance;
    try {
      instance = playerFactory(element, event => {
        if (player === instance && currentOperation === operation) notify(event);
      });
      player = instance;
      instance.setLoop(true);
      instance.setRate(rate);
      const shouldPlay = autoplay && autoplayIntent === playIntent;
      const revisionBeforeLoad = activityRevision;
      const started = await instance.load(clip.videoId, clip.start, clip.end, { play: shouldPlay });
      if (closed || currentOperation !== operation || player !== instance) {
        instance.destroy?.();
        return false;
      }
      prepared = true;
      if (activityRevision === revisionBeforeLoad) active = shouldPlay && started !== false;
      else if (lastActivityType === 'error') {
        prepared = false;
        player = null;
        instance.destroy?.();
        return false;
      }
      return true;
    } catch (error) {
      if (currentOperation !== operation || closed || (instance && player !== instance)) return false;
      active = false;
      if (player === instance) { player = null; instance?.destroy?.(); }
      notify({ type: 'error', message: `문장 영상을 재생하지 못했어요: ${error?.message || '다시 눌러 주세요.'}` });
      return false;
    }
  }

  function play() {
    if (closed || !player || !prepared) {
      notify({ type: 'info', message: '문장 영상이 준비된 뒤 다시 눌러 주세요.' });
      return false;
    }
    ++playIntent;
    player.setLoop(true);
    const revisionBeforePlay = activityRevision;
    const started = player.play({ restart: true });
    if (activityRevision === revisionBeforePlay) {
      active = started !== false;
      if (active) notify({ type: 'info', message: '문장 구간 재생을 시작하고 있어요.' });
    }
    return active;
  }

  function pause() {
    ++playIntent;
    const wasActive = active;
    active = false;
    if (player) player.pause?.();
    else if (wasActive) notify({ type: 'paused', message: '문장 반복 재생을 멈췄어요.' });
  }

  function destroy() {
    if (closed) return;
    closed = true;
    ++operation;
    ++playIntent;
    discardPlayer();
  }

  return { prepare, play, pause, destroy, isActive: () => active };
}
