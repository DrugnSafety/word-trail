const SENTENCE_STEPS = Object.freeze(['listen', 'meaning', 'chunks', 'cloze', 'order', 'recall', 'review']);
const STEP_LABELS = Object.freeze({
  listen: '듣기', meaning: '뜻', chunks: '묶어 읽기', cloze: '빈칸', order: '순서', recall: '혼자 말하기', review: '복습'
});
const WORD_PATTERN = /[\p{L}\p{M}\p{N}]+(?:[’'ʼ][\p{L}\p{M}\p{N}]+)*/gu;
const TOKEN_PATTERN = /[\p{L}\p{M}\p{N}]+(?:[’'ʼ][\p{L}\p{M}\p{N}]+)*|[^\s]/gu;
const CONTENT_STOP_WORDS = new Set([
  'a', 'an', 'and', 'as', 'at', 'be', 'but', 'by', "can't", 'can', 'could', "couldn't", "didn't", 'do', "don't", 'for',
  'from', 'i', 'in', 'is', "isn't", 'it', 'of', 'on', 'or', 'the', 'to', 'we', "won't", 'would', "wouldn't", 'you'
]);
const MAX_CARD_TEXT_LENGTH = 500;
const MAX_REFERENCE_LENGTH = 2000;

function text(value) { return String(value ?? ''); }
function normalized(value) {
  return text(value).normalize('NFKC').replace(/[‘’ʼ]/g, "'").toLocaleLowerCase('en-US').trim();
}

function fnv1a(value) {
  let hash = 0x811c9dc5;
  for (const character of text(value)) {
    hash ^= character.codePointAt(0);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function trimRange(source, start, end) {
  while (start < end && /\s/u.test(source[start])) start += 1;
  while (end > start && /\s/u.test(source[end - 1])) end -= 1;
  return start < end ? { start, end, text: source.slice(start, end) } : null;
}

function fallbackSentenceRanges(source) {
  const ranges = [];
  let start = 0;
  for (let index = 0; index < source.length; index += 1) {
    if (!/[.!?]/u.test(source[index])) continue;
    let punctuationEnd = index + 1;
    while (punctuationEnd < source.length && /[.!?]/u.test(source[punctuationEnd])) punctuationEnd += 1;
    let end = punctuationEnd;
    while (end < source.length && /[”’"')\]}]/u.test(source[end])) end += 1;
    if (end < source.length && !/\s/u.test(source[end])) continue;
    const prefix = source.slice(start, punctuationEnd);
    if (/\b(?:mr|mrs|ms|dr|prof|st|vs|etc)\.$/iu.test(prefix) || /(?:\b[\p{L}]\.){2,}$/iu.test(prefix)) continue;
    const range = trimRange(source, start, end);
    if (range) ranges.push(range);
    start = end;
    index = end - 1;
  }
  const tail = trimRange(source, start, source.length);
  if (tail) ranges.push(tail);
  return ranges;
}

export function sentenceRanges(value, Segmenter = globalThis.Intl?.Segmenter) {
  const source = text(value);
  if (!source.trim()) return [];
  if (typeof Segmenter !== 'function') return fallbackSentenceRanges(source);
  try {
    const segmenter = new Segmenter('en', { granularity: 'sentence' });
    const ranges = [];
    for (const item of segmenter.segment(source)) {
      const range = trimRange(source, item.index, item.index + item.segment.length);
      if (!range) continue;
      const previous = ranges.at(-1);
      if (previous && /^(?:[\p{L}]\.){2,}$/iu.test(previous.text)) {
        previous.end = range.end;
        previous.text = source.slice(previous.start, previous.end);
      } else ranges.push(range);
    }
    return ranges.length ? ranges : fallbackSentenceRanges(source);
  } catch {
    return fallbackSentenceRanges(source);
  }
}

export function cardExpressionId({ start, end, text: sentenceText, sceneId, contentVersion }) {
  const safeStart = Math.max(0, Number.parseInt(start, 10) || 0);
  const safeEnd = Math.max(safeStart, Number.parseInt(end, 10) || safeStart);
  const hash = fnv1a([contentVersion, sceneId, safeStart, safeEnd, sentenceText].join('\u0000'));
  return `sentence-${safeStart}-${safeEnd}-${hash}`;
}

export function cardCandidates(video, scene) {
  if (!video?.id || !scene?.id || scene.selectable === false) return [];
  const reference = text(scene.sentenceText);
  if (reference.length > MAX_REFERENCE_LENGTH) return [];
  const ranges = sentenceRanges(reference);
  return ranges.filter(range => range.text.length <= MAX_CARD_TEXT_LENGTH).map((range) => {
    const identity = {
      start: range.start, end: range.end, text: range.text, sceneId: scene.id, contentVersion: video.contentVersion
    };
    const expressionId = cardExpressionId(identity);
    const partialSource = ranges.length > 1 || range.start !== 0 || range.end !== reference.length;
    return Object.freeze({
      kind: 'sentence', id: `${video.id}:${scene.id}:${expressionId}`, expressionId,
      videoId: video.id, sceneId: scene.id, contentVersion: text(video.contentVersion),
      chapterId: text(scene.chapterId), text: range.text, start: range.start, end: range.end,
      reference, sourceLabel: partialSource ? '원본 대화 듣기' : '원본 문장 듣기', partialSource
    });
  });
}

export function cardProgressKey(card) {
  return [card?.videoId, card?.sceneId, card?.expressionId, card?.contentVersion].map(text).join('\u0000');
}

export function sentenceCloze(value) {
  const source = text(value);
  const words = [...source.matchAll(WORD_PATTERN)].map(match => ({ text: match[0], start: match.index, end: match.index + match[0].length }));
  if (!words.length) return null;
  const choices = words.filter(word => !CONTENT_STOP_WORDS.has(normalized(word.text)) && word.text.length > 2);
  const target = (choices.length ? choices : words).reduce((best, word) => word.text.length > best.text.length ? word : best);
  return { before: source.slice(0, target.start), answer: target.text, after: source.slice(target.end), start: target.start, end: target.end };
}

function shuffledIndexes(length, seed) {
  const indexes = Array.from({ length }, (_, index) => index);
  let value = Number.parseInt(fnv1a(seed), 16) || 1;
  for (let index = indexes.length - 1; index > 0; index -= 1) {
    value = (Math.imul(value, 1664525) + 1013904223) >>> 0;
    const swap = value % (index + 1);
    [indexes[index], indexes[swap]] = [indexes[swap], indexes[index]];
  }
  if (length > 1 && indexes.every((item, index) => item === index)) [indexes[0], indexes[1]] = [indexes[1], indexes[0]];
  return indexes;
}

export function sentenceOrder(value) {
  const source = text(value).trim();
  const tokens = source.match(TOKEN_PATTERN) ?? [];
  const choices = shuffledIndexes(tokens.length, source).map(index => ({ id: index, text: tokens[index] }));
  return { tokens, choices };
}

export function orderIsCorrect(selected, expected) {
  const actualTokens = Array.isArray(selected) ? selected.map(item => typeof item === 'object' ? item.text : item) : [];
  const expectedTokens = Array.isArray(expected) ? expected : sentenceOrder(expected).tokens;
  return actualTokens.length === expectedTokens.length
    && actualTokens.every((item, index) => normalized(item) === normalized(expectedTokens[index]));
}

export function sentenceHeadingText(cardText, step, englishVisible = false) {
  if (['cloze', 'order', 'recall'].includes(step)) return '문장을 완성해 보세요';
  if (step === 'listen' && !englishVisible) return '영어 문장을 먼저 들어 보세요';
  return text(cardText);
}

export function canReview(progress, now = new Date()) {
  const dueAt = progress?.review?.dueAt;
  return Boolean(dueAt) && Number.isFinite(new Date(dueAt).getTime()) && new Date(dueAt).getTime() <= new Date(now).getTime();
}

export function filterCards(cards, options = {}) {
  const query = normalized(options.query);
  const topic = normalized(options.topic);
  const chapterId = text(options.chapterId);
  const progressByKey = options.progressByKey instanceof Map ? options.progressByKey : new Map();
  const now = options.now || new Date();
  return (Array.isArray(cards) ? cards : []).filter((card) => {
    const progress = progressByKey.get(cardProgressKey(card));
    const guide = options.guidesById instanceof Map ? options.guidesById.get(card.id) : null;
    if (query && !normalized(`${card.text} ${guide?.meaningKo || ''} ${guide?.situationKo || ''}`).includes(query)) return false;
    if (topic && topic !== 'all' && normalized(guide?.topic) !== topic) return false;
    if (chapterId && chapterId !== 'all' && card.chapterId !== chapterId) return false;
    if (options.savedOnly && !progress) return false;
    if (options.dueOnly && !canReview(progress, now)) return false;
    return true;
  });
}

function element(tag, className, value) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (value != null) node.textContent = text(value);
  return node;
}

function action(label, className, handler) {
  const button = element('button', className, label);
  button.type = 'button';
  button.addEventListener('click', handler);
  return button;
}

export function renderSentenceCard({
  host, card, guide = null, guideStatus = 'idle', saved = false, listeningMode = false,
  onSave = () => {}, onSource = () => {}, onSpeak = () => {}, onReview = () => {}, onClose = null,
  onStepChange = () => {}, onRetryGuide = null
}) {
  if (!host?.replaceChildren || !card?.text) throw new TypeError('문장 카드를 표시할 위치와 문장이 필요합니다.');
  let currentGuide = guide;
  let currentGuideStatus = guideStatus;
  let currentStep = 'listen';
  let englishVisible = !listeningMode;
  let meaningVisible = false;
  let usedHelp = false;
  let isSaved = Boolean(saved);
  let savePending = false;
  let saveError = '';
  let reviewPending = false;
  let reviewSaved = false;
  let reviewError = '';
  let reviewChoice = null;
  let retryPending = false;
  let destroyed = false;
  let selectedOrder = [];
  let clozeDraft = '';
  let clozeFeedback = null;
  let orderFeedback = null;

  async function retryGuide() {
    if (retryPending || typeof onRetryGuide !== 'function') return;
    retryPending = true;
    currentGuideStatus = 'loading';
    draw();
    try {
      const result = await onRetryGuide(card);
      if (destroyed) return;
      if (result && typeof result === 'object') currentGuide = result;
      currentGuideStatus = result === false ? 'error' : (currentGuide ? 'ready' : 'loading');
    } catch {
      if (!destroyed) currentGuideStatus = 'error';
    } finally {
      retryPending = false;
      if (!destroyed) draw();
    }
  }

  async function saveCard() {
    if (savePending || isSaved) return;
    savePending = true;
    saveError = '';
    draw();
    try {
      const result = await onSave(card);
      if (destroyed) return;
      if (result === false) throw new Error('save rejected');
      isSaved = true;
    } catch {
      if (!destroyed) saveError = '저장하지 못했어요. 다시 눌러 주세요.';
    } finally {
      savePending = false;
      if (!destroyed) draw();
    }
  }

  async function saveReview(independent) {
    if (reviewPending || reviewSaved) return;
    const effectiveIndependent = Boolean(independent && !usedHelp);
    reviewPending = true;
    reviewError = '';
    draw();
    try {
      const result = await onReview(effectiveIndependent, { usedHelp });
      if (destroyed) return;
      if (result === false) throw new Error('review rejected');
      reviewSaved = true;
      reviewChoice = effectiveIndependent ? 'independent' : 'helped';
    } catch {
      if (!destroyed) reviewError = '복습 기록을 저장하지 못했어요. 다시 눌러 주세요.';
    } finally {
      reviewPending = false;
      if (!destroyed) draw();
    }
  }

  function guideBlock() {
    const block = element('div', 'sentence-guide');
    if (currentGuideStatus === 'loading') { block.append(element('p', 'sentence-guide-status', '문장 뜻과 활용을 준비하고 있어요…')); return block; }
    if (currentGuideStatus === 'error') {
      block.append(element('p', 'sentence-guide-status error', '문장 설명을 불러오지 못했어요. 원문 듣기와 연습은 계속할 수 있어요.'));
      if (typeof onRetryGuide === 'function') {
        const retry = action(retryPending ? '다시 불러오는 중…' : '설명 다시 불러오기', 'secondary-button', retryGuide);
        retry.disabled = retryPending; block.append(retry);
      }
      return block;
    }
    if (!currentGuide) { block.append(element('p', 'sentence-guide-status', '뜻 보기를 누르면 영어 뜻, 한국어 뜻, 활용 표현을 확인할 수 있어요.')); return block; }
    if (currentGuide.definitionEn) block.append(element('p', 'sentence-definition-en', currentGuide.definitionEn));
    if (currentGuide.meaningKo) block.append(element('p', 'sentence-meaning-ko', currentGuide.meaningKo));
    if (currentGuide.situationKo) block.append(element('p', 'sentence-situation', `이럴 때 써요 · ${currentGuide.situationKo}`));
    return block;
  }

  function renderStep(body) {
    if (currentStep === 'listen') {
      body.append(element('p', 'sentence-instruction', '먼저 화면을 보지 않고 원본 대화를 들어 보세요.'));
      const actions = element('div', 'sentence-card-actions');
      actions.append(action(card.sourceLabel, 'primary-button', () => onSource(card)), action('기기 음성 듣기', 'secondary-button', () => onSpeak(card.text)));
      if (!englishVisible) actions.append(action('문장 보기', 'text-button', () => { englishVisible = true; draw(); }));
      body.append(actions);
      return;
    }
    if (currentStep === 'meaning') {
      if (!meaningVisible) body.append(action('뜻 보기', 'primary-button', () => { meaningVisible = true; draw(); }));
      if (meaningVisible) body.append(guideBlock());
      return;
    }
    if (currentStep === 'chunks') {
      const chunks = Array.isArray(currentGuide?.chunks) && currentGuide.chunks.length ? currentGuide.chunks : [card.text];
      const list = element('div', 'sentence-chunks');
      chunks.forEach(chunk => list.append(action(chunk, 'sentence-chunk', () => onSpeak(chunk))));
      body.append(element('p', 'sentence-instruction', '뜻 덩어리를 눌러 듣고, 마지막에는 문장 전체를 이어서 말해 보세요.'), list,
        action('문장 전체 듣기', 'secondary-button', () => onSpeak(card.text)));
      return;
    }
    if (currentStep === 'cloze') {
      const cloze = sentenceCloze(card.text);
      if (!cloze) { body.append(element('p', 'sentence-guide-status', '빈칸 문제를 만들 수 없는 문장이에요.')); return; }
      const form = element('form', 'sentence-cloze');
      const prompt = element('p', 'sentence-cloze-prompt');
      prompt.append(document.createTextNode(cloze.before), element('span', 'sentence-blank', '_____'), document.createTextNode(cloze.after));
      const input = element('input', 'sentence-answer'); input.type = 'text'; input.autocomplete = 'off'; input.spellcheck = false; input.value = clozeDraft;
      const feedback = element('p', 'answer-feedback'); feedback.setAttribute('role', 'status');
      input.addEventListener('input', () => { clozeDraft = input.value; clozeFeedback = null; });
      form.addEventListener('submit', event => {
        event.preventDefault();
        const correct = normalized(input.value) === normalized(cloze.answer);
        clozeDraft = input.value;
        clozeFeedback = { correct, message: correct ? '맞았어요. 문장 전체를 이어서 읽어 보세요.' : '다시 듣고 빈칸에 들어갈 말을 적어 보세요.' };
        feedback.textContent = clozeFeedback.message;
        feedback.className = `answer-feedback ${correct ? 'correct' : 'incorrect'}`;
      });
      if (clozeFeedback) {
        feedback.textContent = clozeFeedback.message;
        feedback.className = `answer-feedback ${clozeFeedback.correct ? 'correct' : 'incorrect'}`;
      }
      const submit = element('button', 'primary-button', '확인'); submit.type = 'submit';
      form.append(prompt, input, submit, feedback); body.append(form);
      return;
    }
    if (currentStep === 'order') {
      const exercise = sentenceOrder(card.text);
      const chosen = element('div', 'sentence-order-chosen');
      selectedOrder.forEach(item => chosen.append(action(item.text, 'sentence-token selected', () => { selectedOrder = selectedOrder.filter(token => token.id !== item.id); orderFeedback = null; draw(); })));
      const choices = element('div', 'sentence-order-choices');
      exercise.choices.filter(item => !selectedOrder.some(token => token.id === item.id)).forEach(item => {
        choices.append(action(item.text, 'sentence-token', () => { selectedOrder = [...selectedOrder, item]; orderFeedback = null; draw(); }));
      });
      const feedback = element('p', 'answer-feedback'); feedback.setAttribute('role', 'status');
      const check = action('순서 확인', 'primary-button', () => {
        const correct = orderIsCorrect(selectedOrder, exercise.tokens);
        orderFeedback = { correct, message: correct ? '문장 순서가 맞아요.' : '단어를 눌러 원래 문장 순서로 놓아 보세요.' };
        feedback.textContent = orderFeedback.message;
        feedback.className = `answer-feedback ${correct ? 'correct' : 'incorrect'}`;
      });
      if (orderFeedback) {
        feedback.textContent = orderFeedback.message;
        feedback.className = `answer-feedback ${orderFeedback.correct ? 'correct' : 'incorrect'}`;
      }
      const reset = action('다시 놓기', 'secondary-button', () => { selectedOrder = []; orderFeedback = null; draw(); });
      body.append(element('p', 'sentence-instruction', '단어를 눌러 문장을 완성하세요.'), chosen, choices, check, reset, feedback);
      return;
    }
    if (currentStep === 'recall') {
      body.append(element('p', 'sentence-instruction', currentGuide?.meaningKo || '장면을 떠올리며 영어 문장을 혼자 말해 보세요.'));
      if (usedHelp) body.append(element('p', 'sentence-helped-note', card.text));
      else {
        const hint = action('문장 힌트 보기', 'secondary-button', () => { usedHelp = true; draw(); });
        hint.disabled = reviewPending || reviewSaved; body.append(hint);
      }
      const actions = element('div', 'sentence-card-actions');
      const independent = action(reviewPending ? '저장 중…' : '혼자 말했어요', 'primary-button', () => saveReview(true));
      const helped = action(reviewPending ? '저장 중…' : '도움받았어요', 'secondary-button', () => saveReview(false));
      independent.disabled = usedHelp || reviewPending || reviewSaved;
      helped.disabled = reviewPending || reviewSaved;
      actions.append(independent, helped);
      body.append(actions);
      if (reviewSaved) {
        const status = element('p', 'sentence-review-status correct', reviewChoice === 'independent' ? '혼자 말한 복습 기록을 저장했어요.' : '도움받은 복습 기록을 저장했어요.');
        status.setAttribute('role', 'status'); body.append(status);
      } else if (reviewError) {
        const status = element('p', 'sentence-review-status error', reviewError);
        status.setAttribute('role', 'status'); body.append(status);
      }
      return;
    }
    body.append(guideBlock());
    if (currentGuide?.patternEn) {
      const pattern = element('div', 'sentence-pattern');
      pattern.append(element('strong', '', currentGuide.patternEn));
      if (currentGuide.patternKo) pattern.append(element('p', '', currentGuide.patternKo));
      body.append(pattern);
    }
    if (Array.isArray(currentGuide?.examples) && currentGuide.examples.length) {
      const examples = element('div', 'sentence-examples');
      currentGuide.examples.forEach(example => {
        const item = element('button', 'sentence-example'); item.type = 'button';
        item.append(element('span', '', example.text), element('small', '', example.meaningKo));
        item.addEventListener('click', () => onSpeak(example.text)); examples.append(item);
      });
      body.append(examples);
    }
  }

  function draw() {
    if (destroyed) return;
    const article = element('article', 'sentence-card');
    const toolbar = element('div', 'sentence-card-toolbar');
    const save = action(isSaved ? '저장됨' : (savePending ? '저장 중…' : '문장 저장'), 'sentence-save', saveCard);
    save.disabled = isSaved || savePending;
    save.setAttribute('aria-pressed', String(isSaved));
    toolbar.append(element('span', 'sentence-card-kicker', currentGuide?.topic || '영상 문장'), save);
    if (onClose) toolbar.append(action('닫기', 'sentence-close', onClose));
    const heading = element('h2', 'sentence-card-text', sentenceHeadingText(card.text, currentStep, englishVisible));
    const steps = element('nav', 'sentence-card-steps'); steps.setAttribute('aria-label', '문장 학습 순서');
    SENTENCE_STEPS.forEach(step => {
      const button = action(STEP_LABELS[step], step === currentStep ? 'active' : '', () => {
        if (step === currentStep) return;
        const previousStep = currentStep; currentStep = step; onStepChange(step, previousStep); draw();
      });
      button.setAttribute('aria-current', step === currentStep ? 'step' : 'false'); steps.append(button);
    });
    const body = element('section', 'sentence-card-body'); renderStep(body);
    article.append(toolbar);
    if (saveError) { const status = element('p', 'sentence-save-status error', saveError); status.setAttribute('role', 'status'); article.append(status); }
    article.append(heading, steps, body); host.replaceChildren(article);
  }

  draw();
  return {
    destroy() { destroyed = true; host.replaceChildren(); },
    updateGuide(nextGuide, nextStatus = nextGuide ? 'ready' : currentGuideStatus) {
      currentGuide = nextGuide; currentGuideStatus = nextStatus;
      if (currentStep !== 'cloze' || !host.contains?.(document.activeElement)) draw();
    },
    updateSaved(nextSaved) { isSaved = Boolean(nextSaved); saveError = ''; draw(); },
    showStep(step) {
      if (SENTENCE_STEPS.includes(step) && step !== currentStep) {
        const previousStep = currentStep; currentStep = step; onStepChange(step, previousStep); draw();
      }
    },
    getState() { return { step: currentStep, usedHelp, saved: isSaved, savePending, reviewPending, reviewSaved, clozeDraft }; }
  };
}

export { SENTENCE_STEPS };
