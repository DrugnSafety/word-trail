let apiPromise;

export function loadYouTubeAPI() {
  if (globalThis.YT?.Player) return Promise.resolve(globalThis.YT);
  if (apiPromise) return apiPromise;
  apiPromise = new Promise((resolve, reject) => {
    const previous = globalThis.onYouTubeIframeAPIReady;
    const script = document.createElement('script');
    let finished = false;
    const finish = error => {
      if (finished) return;
      finished = true;
      clearTimeout(timeout);
      globalThis.onYouTubeIframeAPIReady = previous;
      if (error) { script.remove(); apiPromise = undefined; reject(error); }
      else resolve(globalThis.YT);
    };
    const timeout = setTimeout(() => finish(new Error('YouTube 연결 시간이 초과됐어요. 연결을 확인하고 다시 눌러 주세요.')), 15000);
    globalThis.onYouTubeIframeAPIReady = () => {
      try { previous?.(); } finally { finish(); }
    };
    script.src = 'https://www.youtube.com/iframe_api';
    script.async = true;
    script.onerror = () => finish(new Error('YouTube에 연결할 수 없어요. 원본 링크나 읽기 자료를 사용할 수 있어요.'));
    document.head.append(script);
  });
  return apiPromise;
}

// The UI may offer fine-grained learning speeds. YouTube still decides which
// values the current video can actually use through getAvailablePlaybackRates().
const PLAYBACK_RATES = Object.freeze([0.5, 0.6, 0.7, 0.75, 0.8, 0.9, 1, 1.1, 1.2]);

export function createPlayer(element, onStatus = () => {}, options = {}) {
  let player;
  let initializing;
  let ready = false;
  let destroyed = false;
  let videoId;
  let start = 0;
  let end = 1;
  let prepared = 'none';
  let looping = true;
  let requestedRate = 1;
  let actualRate = 1;
  let awaitingRate = null;
  let ratesResolved = false;
  let monitor;
  let replay;
  let pendingBoundaryPauses = 0;
  let rangeFinished = false;
  let loadSequence = 0;
  let playIntent = 0;
  const clock = options.clock || globalThis;
  const apiLoader = options.loadAPI || loadYouTubeAPI;
  const notify = (type, message, details = {}) => { if (!destroyed) onStatus({ type, message, ...details }); };
  function clearMonitor() { if (monitor) clock.clearInterval(monitor); monitor = undefined; }
  function clearReplay() { if (replay) clock.clearTimeout(replay); replay = undefined; }
  function reportedRates() {
    const reported = ready ? player?.getAvailablePlaybackRates?.() : null;
    const values = Array.isArray(reported) ? reported.map(Number).filter(value => PLAYBACK_RATES.includes(value)) : [];
    return [...new Set(values)].sort((a, b) => a - b);
  }
  function availableRates() {
    if (!ratesResolved) return [...PLAYBACK_RATES];
    const values = reportedRates();
    return values.length ? values : [1];
  }
  function notifyRate(message = '') { notify('rate', message, { rate: requestedRate, actualRate, availableRates: availableRates() }); }
  function applyRate() {
    if (!ready || !player) return true;
    if (!ratesResolved) return true;
    const available = availableRates();
    if (!available.includes(requestedRate)) {
      requestedRate = available.includes(1) ? 1 : available[0];
      awaitingRate = requestedRate;
      player.setPlaybackRate?.(requestedRate);
      notifyRate(`이 영상에서는 선택한 속도를 지원하지 않아 ${requestedRate}배속으로 재생해요.`);
      return false;
    }
    if (actualRate !== requestedRate) {
      awaitingRate = requestedRate;
      player.setPlaybackRate?.(requestedRate);
    }
    notifyRate();
    return true;
  }
  function rangeRequest() { return { videoId, startSeconds: start, endSeconds: end }; }
  function finishRange({ alreadyEnded = false } = {}) {
    if (rangeFinished || replay || destroyed) return;
    rangeFinished = true;
    clearMonitor();
    if (!alreadyEnded) {
      pendingBoundaryPauses += 1;
      player?.pauseVideo();
    }
    if (!looping) {
      notify('range-ended', '선택한 구간을 다 들었어요.', { videoId, start, end });
      return;
    }
    notify('info', '잠깐 쉬고 같은 구간을 다시 들어요.');
    const intent = playIntent;
    replay = clock.setTimeout(() => {
      replay = undefined;
      if (!destroyed && looping && intent === playIntent) {
        rangeFinished = false;
        player.seekTo(start, true);
        player.playVideo();
      }
    }, 1000);
  }
  function onStateChange(event) {
    if (destroyed) return;
    if (event.data === 1) {
      clearMonitor();
      prepared = 'loaded';
      ratesResolved = true;
      clearReplay();
      applyRate();
      notify('playing', '선택한 구간을 듣고 있어요.');
      monitor = clock.setInterval(() => {
        if (player.getCurrentTime() >= end) finishRange();
      }, 100);
    } else if (event.data === 0) {
      clearMonitor();
      finishRange({ alreadyEnded: true });
    }
    else if (event.data === 2) {
      if (pendingBoundaryPauses > 0) pendingBoundaryPauses -= 1;
      else { clearMonitor(); clearReplay(); notify('paused', '일시 정지했어요.'); }
    } else if (event.data === 5) {
      prepared = 'cued';
      ratesResolved = true;
      applyRate();
    }
  }
  async function initialize() {
    if (initializing) return initializing;
    if (ready && player) return;
    initializing = (async () => {
      const YT = await apiLoader();
      if (destroyed) throw new Error('Player closed');
      await new Promise((resolve, reject) => {
        const child = document.createElement('div');
        element.replaceChildren(child);
        let settled = false;
        const timeout = clock.setTimeout(() => {
          if (!settled) { settled = true; player?.destroy(); player = undefined; reject(new Error('영상 플레이어가 응답하지 않아요. 원본 링크를 이용하거나 다시 시도해 주세요.')); }
        }, 18000);
        player = new YT.Player(child, {
          host: 'https://www.youtube-nocookie.com',
          width: '100%', height: '100%',
          playerVars: { autoplay: 0, controls: 1, playsinline: 1, rel: 0, origin: globalThis.location?.origin },
          events: {
            onReady: () => {
              if (settled) return;
              settled = true; ready = true; clock.clearTimeout(timeout);
              if (destroyed) { player?.destroy(); reject(new Error('Player closed')); return; }
              const iframe = player.getIframe?.();
              if (iframe) {
                iframe.title = 'YouTube 영어 학습 영상';
                const permissions = new Set((iframe.getAttribute?.('allow') || '').split(';').map(value => value.trim()).filter(Boolean));
                ['autoplay', 'encrypted-media', 'picture-in-picture'].forEach(value => permissions.add(value));
                iframe.setAttribute?.('allow', [...permissions].join('; '));
              }
              notify('ready', '영상 준비 완료', { availableRates: availableRates() }); resolve();
            },
            onStateChange,
            onPlaybackRateChange: event => {
              const actual = Number(event.data);
              if (PLAYBACK_RATES.includes(actual)) {
                actualRate = actual;
                if (awaitingRate === actual) awaitingRate = null;
                else if (awaitingRate === null) requestedRate = actual;
              }
              notifyRate();
            },
            onAutoplayBlocked: () => notify('autoplay-blocked', '브라우저가 자동 재생을 막았어요. 영상 안의 재생 버튼을 한 번 눌러 주세요.'),
            onError: event => {
              clearMonitor(); clearReplay();
              const message = [101, 150].includes(event.data) ? '이 영상은 외부 재생을 허용하지 않아요. 원본 링크를 이용해 주세요.' : `영상을 재생할 수 없어요 (YouTube ${event.data}). 영상 안의 재생 버튼이나 원본 링크를 이용해 주세요.`;
              notify('error', message);
              if (!settled) { settled = true; clock.clearTimeout(timeout); player?.destroy(); player = undefined; reject(new Error(message)); }
            }
          }
        });
      });
    })();
    try { await initializing; } finally { initializing = undefined; }
  }
  return {
    async load(id, from, to, loadOptions = {}) {
      if (!/^[\w-]{11}$/.test(id) || !Number.isFinite(from) || !Number.isFinite(to) || from < 0 || to <= from) throw new Error('영상 구간이 올바르지 않아요.');
      if (destroyed) throw new Error('Player closed');
      const sequence = ++loadSequence;
      const shouldPlay = loadOptions.play === true;
      if (Object.hasOwn(loadOptions, 'loop')) looping = Boolean(loadOptions.loop);
      const intent = ++playIntent;
      clearMonitor(); clearReplay();
      videoId = id; start = from; end = to; prepared = 'none'; ratesResolved = false; awaitingRate = null; actualRate = null; rangeFinished = false;
      try { await initialize(); } catch (error) { notify('error', error.message); throw error; }
      if (destroyed || sequence !== loadSequence) return false;
      if (shouldPlay && intent === playIntent) {
        prepared = 'loaded'; player.loadVideoById(rangeRequest());
      } else {
        prepared = 'cued'; player.cueVideoById(rangeRequest());
      }
      return shouldPlay && intent === playIntent;
    },
    play(playOptions = {}) {
      if (!ready || !player || !videoId || destroyed) { notify('info', '먼저 영상 재생을 눌러 주세요.'); return false; }
      ++playIntent;
      clearReplay();
      rangeFinished = false;
      const current = Number(player.getCurrentTime?.()) || 0;
      if (playOptions.restart === true || prepared === 'cued' || current < start || current >= end) {
        prepared = 'loaded'; player.loadVideoById(rangeRequest());
      } else player.playVideo();
      return true;
    },
    pause() { ++playIntent; clearReplay(); clearMonitor(); rangeFinished = false; player?.pauseVideo?.(); },
    setLoop(enabled) { looping = Boolean(enabled); if (!looping) clearReplay(); },
    setRate(value) {
      const requested = Number(value);
      if (!PLAYBACK_RATES.includes(requested)) return false;
      requestedRate = requested;
      return applyRate();
    },
    getRate() { return requestedRate; },
    getAvailableRates() { return availableRates(); },
    destroy() { destroyed = true; ++loadSequence; ++playIntent; clearReplay(); clearMonitor(); pendingBoundaryPauses = 0; player?.destroy(); player = undefined; ready = false; }
  };
}
