import { nextReview } from './learning.js';

const WORD_PATTERN = /[\p{L}\p{M}\p{N}]+(?:'[\p{L}\p{M}\p{N}]+)*/gu;
const SENTENCE_PUNCTUATION = /[.!?。！？]/u;
const PRACTICE_MODES = new Set(['spelling', 'cloze', 'meaning', 'audio', 'reading']);
const MAX_COUNTER = 2147483647;
const MAX_TERM_LENGTH = 100;

export function normalizeWord(value) {
  return String(value ?? '').normalize('NFKC').replace(/[‘’ʼ]/g, "'").toLocaleLowerCase('en-US').trim();
}

function sourceWords(reference) {
  return String(reference ?? '').normalize('NFKC').replace(/[‘’ʼ]/g, "'").match(WORD_PATTERN) ?? [];
}

function sourceTokens(reference) {
  const text = String(reference ?? '').normalize('NFKC').replace(/[‘’ʼ]/g, "'");
  return [...text.matchAll(WORD_PATTERN)].map(match => ({
    term: match[0],
    normalized: normalizeWord(match[0]),
    start: match.index,
    end: match.index + match[0].length
  }));
}

function wordKey(term) {
  return `word:${normalizeWord(term)}`;
}

function validDate(now) {
  const date = new Date(now);
  if (!Number.isFinite(date.getTime())) throw new TypeError('올바른 학습 시간이 필요합니다.');
  return date;
}

function canonicalWord(word) {
  const term = String(word?.term ?? '');
  return { ...word, key: wordKey(term), term };
}

function crossesSentencePunctuation(text, left, right) {
  return SENTENCE_PUNCTUATION.test(text.slice(left.end, right.start));
}

function phraseCandidateFromSpan(reference, tokens, startIndex, endIndex, metadata = {}) {
  if (!Number.isSafeInteger(startIndex) || !Number.isSafeInteger(endIndex)
      || startIndex < 0 || endIndex >= tokens.length || endIndex <= startIndex) {
    throw new RangeError('두 개 이상의 이어진 단어 위치가 필요합니다.');
  }
  const text = String(reference ?? '').normalize('NFKC').replace(/[‘’ʼ]/g, "'");
  for (let index = startIndex; index < endIndex; index += 1) {
    if (crossesSentencePunctuation(text, tokens[index], tokens[index + 1])) {
      throw new RangeError('문장 부호를 넘어 표현을 묶을 수 없습니다.');
    }
  }
  const term = tokens.slice(startIndex, endIndex + 1).map(token => token.term).join(' ');
  if (term.length > MAX_TERM_LENGTH) throw new RangeError(`표현은 ${MAX_TERM_LENGTH}자 이하여야 합니다.`);
  const sourceIndexes = Array.from({ length: endIndex - startIndex + 1 }, (_, offset) => startIndex + offset);
  return {
    key: wordKey(term), term, kind: 'manual', typed: '', sourceIndex: startIndex, sourceIndexes,
    studied: false, studyAttempts: 0, lastAnswer: '', selected: false, currentMistake: false,
    ...metadata
  };
}

export function makePhraseCandidate(reference, startIndex, endIndex) {
  return phraseCandidateFromSpan(reference, sourceTokens(reference), startIndex, endIndex);
}

export function phraseCandidates(reference, expressions = []) {
  const tokens = sourceTokens(reference);
  const text = String(reference ?? '').normalize('NFKC').replace(/[‘’ʼ]/g, "'");
  const byKey = new Map();
  for (const expression of Array.isArray(expressions) ? expressions : []) {
    const variants = [expression?.term, ...(Array.isArray(expression?.aliases) ? expression.aliases : [])];
    for (const variant of variants) {
      const phraseTokens = sourceWords(variant).map(normalizeWord);
      const normalizedPhrase = normalizeWord(variant);
      if (phraseTokens.length < 2 || normalizedPhrase.length > MAX_TERM_LENGTH) continue;
      const spans = [];
      for (let start = 0; start + phraseTokens.length <= tokens.length; start += 1) {
        const end = start + phraseTokens.length - 1;
        if (!phraseTokens.every((token, offset) => tokens[start + offset].normalized === token)) continue;
        let crossesPunctuation = false;
        for (let index = start; index < end; index += 1) {
          if (crossesSentencePunctuation(text, tokens[index], tokens[index + 1])) crossesPunctuation = true;
        }
        if (!crossesPunctuation) {
          spans.push([start, end]);
          start = end;
        }
      }
      if (!spans.length) continue;
      const first = spans[0];
      const base = phraseCandidateFromSpan(reference, tokens, first[0], first[1], {
        expressionId: String(expression?.id ?? ''),
        label: String(expression?.meaningKo ?? expression?.term ?? '')
      });
      const sourceIndexes = [...new Set(spans.flatMap(([start, end]) =>
        Array.from({ length: end - start + 1 }, (_, offset) => start + offset)))];
      const existing = byKey.get(base.key);
      if (!existing) {
        byKey.set(base.key, { ...base, sourceIndexes, occurrenceSpans: spans });
      } else {
        existing.sourceIndexes = [...new Set([...existing.sourceIndexes, ...sourceIndexes])].sort((a, b) => a - b);
        existing.occurrenceSpans = [...existing.occurrenceSpans, ...spans]
          .filter((span, index, all) => all.findIndex(item => item[0] === span[0] && item[1] === span[1]) === index)
          .sort((left, right) => left[0] - right[0]);
      }
    }
  }
  return [...byKey.values()].sort((left, right) => left.sourceIndex - right.sourceIndex
    || right.term.split(' ').length - left.term.split(' ').length || left.key.localeCompare(right.key));
}

export function wordCandidates(reference, comparison = {}) {
  const tokens = sourceWords(reference);
  const byKey = new Map();
  for (let index = 0; index < tokens.length; index += 1) {
    const term = tokens[index];
    const key = wordKey(term);
    const existing = byKey.get(key);
    if (existing) existing.sourceIndexes.push(index);
    else byKey.set(key, {
      key, term, kind: 'manual', typed: '', sourceIndex: index, sourceIndexes: [index],
      studied: false, studyAttempts: 0, lastAnswer: '', selected: false, currentMistake: false
    });
  }

  for (const operation of Array.isArray(comparison?.operations) ? comparison.operations : []) {
    if (!['missing', 'replace'].includes(operation?.kind)) continue;
    const key = wordKey(operation.expected);
    const candidate = byKey.get(key);
    if (!candidate) continue;
    candidate.selected = true;
    candidate.currentMistake = true;
    if (candidate.kind === 'manual') {
      candidate.kind = operation.kind;
      candidate.typed = String(operation.actual ?? '');
      candidate.sourceIndex = operation.sourceIndex;
    }
  }
  return [...byKey.values()];
}

function historicalWords(words) {
  return (Array.isArray(words) ? words : []).filter(word => word?.registeredAt || word?.currentMistake !== true);
}

function mergeByTerm(baseWords, additions) {
  const merged = [];
  const indexes = new Map();
  for (const input of [...baseWords, ...additions]) {
    if (!input?.term) continue;
    const word = canonicalWord(input);
    const normalized = normalizeWord(word.term);
    if (!normalized) continue;
    const found = indexes.get(normalized);
    if (found === undefined) {
      indexes.set(normalized, merged.length);
      merged.push(word);
    } else {
      const prior = merged[found];
      merged[found] = {
        ...word,
        ...prior,
        key: word.key,
        sourceIndex: word.sourceIndex,
        sourceIndexes: word.sourceIndexes || prior.sourceIndexes
      };
    }
  }
  if (merged.length > 200) throw new RangeError('저장할 단어는 200개 이하여야 합니다.');
  return merged;
}

function validatedExtraCandidates(reference, extraCandidates) {
  const validated = [];
  for (const input of Array.isArray(extraCandidates) ? extraCandidates : []) {
    if (!input || input.kind !== 'manual' || input.key !== wordKey(input.term)
        || !Array.isArray(input.sourceIndexes) || input.sourceIndexes.length < 2
        || input.sourceIndex !== input.sourceIndexes[0]) continue;
    let candidate;
    try {
      candidate = makePhraseCandidate(reference, input.sourceIndexes[0], input.sourceIndexes.at(-1));
    } catch {
      candidate = null;
    }
    if (candidate && candidate.key === input.key
        && candidate.sourceIndexes.length === input.sourceIndexes.length
        && candidate.sourceIndexes.every((index, offset) => index === input.sourceIndexes[offset])) {
      validated.push({ ...candidate, expressionId: input.expressionId, label: input.label });
      continue;
    }
    const matching = phraseCandidates(reference, [{ id: input.expressionId, term: input.term, aliases: [] }])[0];
    if (matching?.key === input.key
        && matching.sourceIndexes.length === input.sourceIndexes.length
        && matching.sourceIndexes.every((index, offset) => index === input.sourceIndexes[offset])) {
      validated.push({ ...matching, expressionId: input.expressionId, label: input.label });
    }
  }
  return validated;
}

export function commitSelection(record, selectedKeys = [], now = new Date(), extraCandidates = []) {
  const timestamp = validDate(now).toISOString();
  const requested = new Set((Array.isArray(selectedKeys) ? selectedKeys : []).filter(key => typeof key === 'string'));
  const candidates = [...new Map([
    ...wordCandidates(record?.reference, { operations: [] }),
    ...validatedExtraCandidates(record?.reference, extraCandidates)
  ].map(candidate => [candidate.key, candidate])).values()];
  const selectedCandidates = candidates.filter(candidate => requested.has(candidate.key));
  const validKeys = selectedCandidates.map(candidate => candidate.key);
  const history = historicalWords(record?.words);
  const priorByTerm = new Map((Array.isArray(record?.words) ? record.words : []).map(word => [normalizeWord(word.term), word]));
  const registered = selectedCandidates.map(candidate => {
    const prior = priorByTerm.get(normalizeWord(candidate.term));
    const registeredWord = {
      ...candidate,
      ...prior,
      key: candidate.key,
      term: candidate.term,
      kind: prior?.kind || candidate.kind,
      typed: prior?.typed || candidate.typed,
      sourceIndex: candidate.sourceIndex,
      sourceIndexes: candidate.sourceIndexes,
      selected: true,
      currentMistake: false,
      registeredAt: prior?.registeredAt || timestamp
    };
    const { expressionId, label, occurrenceSpans, ...persisted } = registeredWord;
    return persisted;
  });
  const selectedSet = new Set(validKeys);
  const words = mergeByTerm(history, registered).map(word => ({ ...word, selected: selectedSet.has(word.key) }));
  return { ...record, words, selectedKeys: validKeys };
}

export function selectedWords(record) {
  const words = Array.isArray(record?.words) ? record.words : [];
  const byKey = new Map(words.map(word => [wordKey(word.term), word]));
  const seen = new Set();
  return (Array.isArray(record?.selectedKeys) ? record.selectedKeys : []).flatMap(key => {
    const canonical = key.startsWith('word:') ? key : '';
    if (!canonical || seen.has(canonical) || !byKey.has(canonical)) return [];
    seen.add(canonical);
    return [byKey.get(canonical)];
  });
}

export function registerPractice(word, mode, answer, correct, now = new Date()) {
  if (!PRACTICE_MODES.has(mode)) throw new RangeError('지원하지 않는 단어 연습 방식입니다.');
  const timestamp = validDate(now).toISOString();
  const priorMode = word?.practice?.[mode] || {};
  const attempts = Number.isInteger(priorMode.attempts) ? priorMode.attempts : 0;
  const correctCount = Number.isInteger(priorMode.correct) ? priorMode.correct : 0;
  const totalAttempts = Number.isInteger(word?.studyAttempts) ? word.studyAttempts : 0;
  if (attempts >= MAX_COUNTER || totalAttempts >= MAX_COUNTER || (correct && correctCount >= MAX_COUNTER)) {
    throw new RangeError('단어 연습 횟수 한도에 도달했습니다.');
  }
  const updated = {
    ...word,
    studied: Boolean(word?.studied) || Boolean(correct),
    studyAttempts: totalAttempts + 1,
    lastAnswer: String(answer ?? ''),
    lastPracticedAt: timestamp,
    practice: {
      ...(word?.practice || {}),
      [mode]: {
        attempts: attempts + 1,
        correct: correctCount + (correct ? 1 : 0),
        lastPracticedAt: timestamp
      }
    }
  };
  if (mode === 'reading') updated.review = nextReview(word?.review, Boolean(correct), validDate(now));
  return updated;
}

export function wordKnowledge(word, expressions = [], lexicon = []) {
  const normalized = normalizeWord(word?.term);
  const expressionBank = Array.isArray(expressions) ? expressions : [];
  const editorial = expressionBank.find(entry => normalizeWord(entry?.term) === normalized)
    || expressionBank.find(entry => (Array.isArray(entry?.aliases) ? entry.aliases : [])
      .some(alias => normalizeWord(alias) === normalized));
  const offline = (Array.isArray(lexicon) ? lexicon : []).find(entry => normalizeWord(entry?.term) === normalized);
  const parentMeaning = String(word?.meaningKo ?? '').trim();
  const source = parentMeaning ? 'parent' : editorial ? 'editorial' : offline ? 'offline' : 'missing';
  const content = editorial || offline || {};
  return {
    source,
    term: String(word?.term ?? content.term ?? ''),
    ipa: String(content.ipa ?? ''),
    meaningKo: parentMeaning || String(content.meaningKo ?? ''),
    explanationKo: String(content.explanationKo ?? ''),
    dialogues: editorial && Array.isArray(editorial.dialogues) ? editorial.dialogues : []
  };
}
