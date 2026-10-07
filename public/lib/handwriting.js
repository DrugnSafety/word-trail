export const HANDWRITING_MODES = Object.freeze({
  trace: 'trace',
  copy: 'copy',
  dictation: 'dictation'
});

const MODE_LABELS = Object.freeze({
  trace: '따라쓰기',
  copy: '보고쓰기',
  dictation: '듣고쓰기'
});

export function normalizeHandwritingMode(mode) {
  if (mode === 'tracing') return HANDWRITING_MODES.trace;
  return Object.prototype.hasOwnProperty.call(HANDWRITING_MODES, mode) ? mode : HANDWRITING_MODES.trace;
}

function cleanRecognizedText(value) {
  return String(value ?? '').normalize('NFKC').replace(/[^A-Za-z' -]/g, '').replace(/\s+/g, ' ').trim();
}

function confidenceValue(value) {
  if (value === 'high') return 1;
  if (value === 'medium') return 0.5;
  if (value === 'low') return 0;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function candidateFrom(value, fallbackConfidence = null) {
  if (typeof value === 'string') return { text: cleanRecognizedText(value), confidence: confidenceValue(fallbackConfidence) };
  if (!value || typeof value !== 'object') return null;
  const text = cleanRecognizedText(value.text ?? value.word ?? value.value);
  return { text, confidence: confidenceValue(value.confidence ?? value.score ?? fallbackConfidence) };
}

export function parseHandwritingResult(payload) {
  const source = payload?.result && typeof payload.result === 'object' ? payload.result : payload;
  const primary = candidateFrom(source, source?.confidence);
  const candidates = [];
  const seen = new Set();
  for (const item of [primary, ...(Array.isArray(source?.candidates) ? source.candidates.map(value => candidateFrom(value)) : [])]) {
    if (!item?.text) continue;
    const key = item.text.toLocaleLowerCase('en-US');
    if (seen.has(key)) continue;
    seen.add(key);
    candidates.push(item);
  }
  return { text: primary?.text || '', confidence: primary?.confidence ?? null, candidates };
}

// Only a stable appended suffix is announced automatically. Corrections and replacements
// remain visible, but are not spoken as if the learner had just written new letters.
export function appendedConfirmedLetters(previous, next) {
  const before = cleanRecognizedText(previous);
  const after = cleanRecognizedText(next);
  if (!after || after.length <= before.length || !after.toLocaleLowerCase('en-US').startsWith(before.toLocaleLowerCase('en-US'))) return '';
  return after.slice(before.length).replace(/[^A-Za-z]/g, '');
}

export function createHandwritingRecognizer({
  request,
  minConfidence = 0.85,
  onAccepted = () => {},
  onLetters = () => {},
  onCandidates = () => {},
  onStatus = () => {}
} = {}) {
  if (typeof request !== 'function') throw new TypeError('A handwriting recognition request function is required');
  let revision = 0;
  let controller = null;
  let pending = false;
  let value = '';
  let announcedValue = '';
  let lastImage = '';
  let destroyed = false;
  let inFlight = Promise.resolve();

  function invalidate() {
    revision += 1;
    pending = false;
    if (controller) {
      try { controller.abort(); } catch {}
      controller = null;
    }
  }

  function accept(text, { announce = false, source = 'recognition' } = {}) {
    const next = cleanRecognizedText(text);
    const letters = announce ? appendedConfirmedLetters(announcedValue, next) : '';
    value = next;
    announcedValue = next;
    onAccepted(next, { source });
    if (letters) onLetters(letters);
    onCandidates([]);
    return next;
  }

  function recognize(image) {
    if (destroyed || !image) return false;
    invalidate();
    const currentRevision = revision;
    lastImage = image;
    pending = true;
    onStatus({ type: 'pending', message: '손글씨를 읽고 있어요.' });
    const prior = inFlight;
    const task = (async () => {
      try {
        await prior.catch(() => false);
        if (destroyed || currentRevision !== revision) return false;
        controller = new AbortController();
        const payload = await request(image, controller.signal);
        if (destroyed || currentRevision !== revision) return false;
        pending = false;
        controller = null;
        const result = parseHandwritingResult(payload);
        if (!result.text) throw new Error('empty-recognition');
        if (result.confidence !== null && result.confidence >= minConfidence) {
          accept(result.text, { announce: true });
          onStatus({ type: 'ready', message: `“${result.text}”로 읽었어요.` });
        } else {
          onCandidates(result.candidates);
          onStatus({ type: 'choice', message: '쓴 글씨와 같은 후보를 골라 주세요.' });
        }
        return true;
      } catch (error) {
        if (destroyed || currentRevision !== revision || error?.name === 'AbortError') return false;
        pending = false;
        controller = null;
        onStatus({ type: 'error', message: '손글씨를 읽지 못했어요. 다시 시도하거나 아래에서 직접 고쳐 주세요.' });
        return false;
      }
    })();
    inFlight = task;
    return task;
  }

  function confirm(text) {
    if (destroyed) return '';
    invalidate();
    const accepted = accept(text, { announce: true, source: 'confirmation' });
    if (accepted) onStatus({ type: 'ready', message: `“${accepted}”로 확인했어요.` });
    return accepted;
  }

  function setValue(text) {
    if (destroyed) return '';
    invalidate();
    return accept(text, { announce: false, source: 'manual' });
  }

  function invalidateValue() {
    if (destroyed) return;
    invalidate();
    value = '';
    onAccepted('', { source: 'ink-change' });
    onCandidates([]);
  }

  function reset() {
    invalidate();
    lastImage = '';
    value = '';
    announcedValue = '';
    onCandidates([]);
  }

  function retry() { return lastImage ? recognize(lastImage) : Promise.resolve(false); }
  function destroy() { destroyed = true; invalidate(); lastImage = ''; }

  return {
    recognize,
    confirm,
    setValue,
    invalidateValue,
    reset,
    retry,
    cancel: invalidate,
    destroy,
    getValue: () => value,
    isPending: () => pending
  };
}

function element(tagName, className, text) {
  const node = document.createElement(tagName);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function defaultRequest(endpoint) {
  return async (image, signal) => {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ image, mode: 'word' }),
      signal
    });
    if (!response.ok) throw new Error(`handwriting-http-${response.status}`);
    return response.json();
  };
}

export function createHandwritingInput({
  host,
  expected = '',
  mode = HANDWRITING_MODES.trace,
  endpoint = '/api/handwriting',
  debounceMs = 850,
  minConfidence = 0.85,
  request,
  onChange = () => {},
  onLetters = () => {},
  onComplete = () => {},
  onModeChange = () => {},
  onActivity = () => {},
  onCancelSpeech = null,
  onStatus = () => {},
  ResizeObserver: ResizeObserverImpl = globalThis.ResizeObserver,
  setTimeout: setTimer = globalThis.setTimeout,
  clearTimeout: clearTimer = globalThis.clearTimeout
} = {}) {
  if (!host || typeof host.append !== 'function') throw new TypeError('A handwriting host element is required');

  let currentMode = normalizeHandwritingMode(mode);
  let destroyed = false;
  let recognitionTimer = null;
  let drawing = null;
  let penPointer = null;
  let canvasWidth = 0;
  let canvasHeight = 0;
  const strokes = [];
  const root = element('section', 'handwriting-input');
  root.setAttribute('aria-label', '손글씨 철자쓰기');

  const modeTabs = element('div', 'handwriting-modes');
  modeTabs.setAttribute('role', 'group');
  modeTabs.setAttribute('aria-label', '손글씨 연습 방법');
  const modeButtons = new Map();
  for (const key of Object.values(HANDWRITING_MODES)) {
    const button = element('button', 'handwriting-mode', MODE_LABELS[key]);
    button.type = 'button';
    button.dataset.mode = key;
    modeTabs.append(button);
    modeButtons.set(key, button);
  }

  const target = element('div', 'handwriting-target');
  const canvasWrap = element('div', 'handwriting-canvas-wrap');
  const guide = element('div', 'handwriting-guide');
  guide.setAttribute('aria-hidden', 'true');
  const canvas = element('canvas', 'handwriting-canvas');
  canvas.setAttribute('aria-label', '영어 단어를 손으로 쓰는 곳');
  canvasWrap.append(guide, canvas);

  const actions = element('div', 'handwriting-actions');
  const undoButton = element('button', '', '한 획 되돌리기');
  const clearButton = element('button', '', '지우기');
  const retryButton = element('button', '', '다시 읽기');
  for (const button of [undoButton, clearButton, retryButton]) button.type = 'button';
  actions.append(undoButton, clearButton, retryButton);

  const resultLabel = element('label', 'handwriting-result-label', '읽은 단어');
  const resultInput = element('input', 'handwriting-result');
  resultInput.type = 'text';
  resultInput.autocomplete = 'off';
  resultInput.spellcheck = false;
  resultInput.inputMode = 'text';
  resultLabel.append(resultInput);
  const candidates = element('div', 'handwriting-candidates');
  candidates.setAttribute('aria-label', '손글씨 인식 후보');
  const status = element('p', 'handwriting-status', '손가락이나 펜으로 써 보세요.');
  status.setAttribute('aria-live', 'polite');
  const completeButton = element('button', 'handwriting-complete', '다 썼어요');
  completeButton.type = 'button';

  root.append(modeTabs, target, canvasWrap, actions, resultLabel, candidates, status, completeButton);
  host.append(root);

  function activity(reason) {
    onActivity(reason);
    if (typeof onCancelSpeech === 'function' && onCancelSpeech !== onActivity) onCancelSpeech(reason);
  }

  function emitStatus(event) {
    status.dataset.type = event.type || 'info';
    status.textContent = event.message || '';
    retryButton.hidden = event.type !== 'error';
    onStatus(event);
  }

  function showCandidates(items) {
    candidates.replaceChildren();
    for (const item of items.slice(0, 5)) {
      const button = element('button', 'handwriting-candidate', item.text);
      button.type = 'button';
      button.addEventListener('click', () => recognizer.confirm(item.text));
      candidates.append(button);
    }
  }

  const recognizer = createHandwritingRecognizer({
    request: request || defaultRequest(endpoint),
    minConfidence,
    onAccepted(text) {
      resultInput.value = text;
      onChange(text);
    },
    onLetters,
    onCandidates: showCandidates,
    onStatus: emitStatus
  });

  const context = canvas.getContext('2d', { alpha: false });
  if (!context) {
    root.remove();
    throw new Error('Canvas drawing is not supported');
  }

  function updateModeDisplay() {
    for (const [key, button] of modeButtons) button.setAttribute('aria-pressed', String(key === currentMode));
    const revealTarget = currentMode !== HANDWRITING_MODES.dictation;
    target.hidden = !revealTarget;
    target.textContent = revealTarget ? `쓸 단어: ${expected}` : '소리를 듣고 써 보세요.';
    guide.textContent = currentMode === HANDWRITING_MODES.trace ? expected : '';
    guide.hidden = currentMode !== HANDWRITING_MODES.trace;
  }

  function configureContext() {
    const ratio = Math.max(1, globalThis.devicePixelRatio || 1);
    const rect = canvas.getBoundingClientRect();
    canvasWidth = Math.max(1, rect.width || canvasWrap.clientWidth || 640);
    canvasHeight = Math.max(1, rect.height || 260);
    canvas.width = Math.round(canvasWidth * ratio);
    canvas.height = Math.round(canvasHeight * ratio);
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.lineCap = 'round';
    context.lineJoin = 'round';
    context.lineWidth = 6;
    context.strokeStyle = '#183153';
    context.fillStyle = '#fff';
  }

  function redraw() {
    context.save();
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.fillStyle = '#fff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.restore();
    for (const stroke of strokes) {
      if (!stroke.length) continue;
      context.beginPath();
      context.moveTo(stroke[0].x, stroke[0].y);
      for (let index = 1; index < stroke.length; index += 1) context.lineTo(stroke[index].x, stroke[index].y);
      if (stroke.length === 1) context.lineTo(stroke[0].x + 0.01, stroke[0].y + 0.01);
      context.stroke();
    }
  }

  function resize() { configureContext(); redraw(); }
  resize();
  const resizeObserver = ResizeObserverImpl ? new ResizeObserverImpl(resize) : null;
  resizeObserver?.observe(canvasWrap);

  function point(event) {
    const rect = canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  function clearRecognitionTimer() {
    if (recognitionTimer === null) return;
    clearTimer(recognitionTimer);
    recognitionTimer = null;
  }

  function exportInk() {
    if (!strokes.length) return '';
    const scale = Math.min(1, 1024 / canvasWidth);
    const output = document.createElement('canvas');
    output.width = Math.max(1, Math.round(canvasWidth * scale));
    output.height = Math.max(1, Math.round(canvasHeight * scale));
    const outputContext = output.getContext('2d', { alpha: false });
    outputContext.fillStyle = '#fff';
    outputContext.fillRect(0, 0, output.width, output.height);
    outputContext.drawImage(canvas, 0, 0, canvas.width, canvas.height, 0, 0, output.width, output.height);
    return output.toDataURL('image/png');
  }

  function scheduleRecognition() {
    clearRecognitionTimer();
    recognitionTimer = setTimer(() => {
      recognitionTimer = null;
      const image = exportInk();
      if (image) recognizer.recognize(image);
    }, Math.max(0, Number(debounceMs) || 850));
  }

  function startStroke(event) {
    if (destroyed || event.button > 0) return;
    if (event.pointerType === 'touch' && penPointer !== null) return;
    if (event.pointerType === 'pen') penPointer = event.pointerId;
    activity('stroke');
    clearRecognitionTimer();
    recognizer.invalidateValue();
    drawing = { pointerId: event.pointerId, points: [point(event)] };
    strokes.push(drawing.points);
    canvas.setPointerCapture?.(event.pointerId);
    event.preventDefault();
  }

  function moveStroke(event) {
    if (!drawing || drawing.pointerId !== event.pointerId) return;
    const next = point(event);
    drawing.points.push(next);
    const previous = drawing.points.at(-2);
    context.beginPath();
    context.moveTo(previous.x, previous.y);
    context.lineTo(next.x, next.y);
    context.stroke();
    event.preventDefault();
  }

  function endStroke(event) {
    if (!drawing || drawing.pointerId !== event.pointerId) return;
    if (drawing.points.length === 1) redraw();
    drawing = null;
    if (penPointer === event.pointerId) penPointer = null;
    try { canvas.releasePointerCapture?.(event.pointerId); } catch {}
    scheduleRecognition();
    event.preventDefault();
  }

  function clear({ notifyActivity = true } = {}) {
    if (notifyActivity) activity('clear');
    clearRecognitionTimer();
    recognizer.reset();
    strokes.length = 0;
    resultInput.value = '';
    onChange('');
    redraw();
    emitStatus({ type: 'ready', message: '새로 쓸 수 있어요.' });
  }

  function undo() {
    if (!strokes.length) return;
    activity('undo');
    clearRecognitionTimer();
    recognizer.invalidateValue();
    strokes.pop();
    redraw();
    if (strokes.length) scheduleRecognition();
    else clear({ notifyActivity: false });
  }

  function setMode(nextMode) {
    const normalized = normalizeHandwritingMode(nextMode);
    if (normalized === currentMode) return;
    activity('mode');
    currentMode = normalized;
    clear({ notifyActivity: false });
    updateModeDisplay();
    emitStatus({ type: 'mode', mode: currentMode, message: `${MODE_LABELS[currentMode]}로 바꿨어요.` });
    onModeChange(currentMode);
  }

  for (const [key, button] of modeButtons) button.addEventListener('click', () => setMode(key));
  canvas.addEventListener('pointerdown', startStroke);
  canvas.addEventListener('pointermove', moveStroke);
  canvas.addEventListener('pointerup', endStroke);
  canvas.addEventListener('pointercancel', endStroke);
  undoButton.addEventListener('click', undo);
  clearButton.addEventListener('click', clear);
  retryButton.addEventListener('click', () => recognizer.retry());
  resultInput.addEventListener('input', () => {
    activity('manual');
    recognizer.setValue(resultInput.value);
  });
  completeButton.addEventListener('click', () => {
    if (recognizer.isPending() || recognitionTimer !== null) {
      emitStatus({ type: 'pending', message: '손글씨를 읽는 중이에요. 읽기가 끝나면 다 썼어요를 다시 눌러 주세요.' });
      return;
    }
    const text = recognizer.getValue();
    if (!text) {
      emitStatus({ type: 'error', message: '단어를 쓰거나 아래 입력칸에서 고쳐 주세요.' });
      return;
    }
    onComplete(text);
  });

  retryButton.hidden = true;
  updateModeDisplay();

  function destroy() {
    if (destroyed) return;
    destroyed = true;
    clearRecognitionTimer();
    recognizer.destroy();
    resizeObserver?.disconnect();
    root.remove();
  }

  return {
    destroy,
    cancel() { clearRecognitionTimer(); recognizer.cancel(); },
    clear,
    undo,
    retry: () => recognizer.retry(),
    setMode,
    getValue: () => recognizer.getValue(),
    getState: () => ({ mode: currentMode, value: recognizer.getValue(), pending: recognizer.isPending(), strokeCount: strokes.length })
  };
}
