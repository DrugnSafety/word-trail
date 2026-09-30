import { normalizeWord, wordCandidates } from './vocabulary.js';

const MAX_SENTENCE_LENGTH = 2000;
const MAX_WORD_LENGTH = 100;
const MAX_WORDS = 200;
const WORD_PATTERN = /[\p{L}\p{M}\p{N}]+(?:'[\p{L}\p{M}\p{N}]+)*/gu;

function assertSentenceLength(value, label) {
  const text = String(value ?? '');
  if (text.length > MAX_SENTENCE_LENGTH) {
    throw new RangeError(`${label}은 ${MAX_SENTENCE_LENGTH}자 이하로 입력해 주세요.`);
  }
  return text;
}

function normalizeText(value) {
  return String(value ?? '')
    .normalize('NFKC')
    .replace(/[‘’ʼ]/g, "'")
    .toLocaleLowerCase('en-US');
}

function tokenize(value) {
  return String(value ?? '').normalize('NFKC').replace(/[‘’ʼ]/g, "'").match(WORD_PATTERN) ?? [];
}

function assertTokenBounds(tokens, label) {
  if (tokens.length > MAX_WORDS) {
    throw new RangeError(`${label}은 단어 ${MAX_WORDS}개 이하로 입력해 주세요.`);
  }
  if (tokens.some(token => token.length > MAX_WORD_LENGTH)) {
    throw new RangeError(`${label}의 각 단어는 ${MAX_WORD_LENGTH}자 이하로 입력해 주세요.`);
  }
}

function mistakeKey(kind, term) {
  return `${kind}:${normalizeText(term)}`.slice(0, 200);
}

function mistakeFromOperation(operation) {
  if (operation.kind === 'equal') return null;
  const term = operation.kind === 'extra' ? operation.actual : operation.expected;
  return {
    key: mistakeKey(operation.kind, term),
    term,
    kind: operation.kind,
    typed: operation.actual,
    sourceIndex: operation.sourceIndex,
    studied: false,
    studyAttempts: 0,
    lastAnswer: ''
  };
}

export function compareSentence(reference, answer) {
  const expectedText = assertSentenceLength(reference, '기준 문장');
  const actualText = assertSentenceLength(answer, '입력 문장');
  const expected = tokenize(expectedText);
  const actual = tokenize(actualText);
  assertTokenBounds(expected, '기준 문장');
  assertTokenBounds(actual, '입력 문장');
  const normalizedExpected = expected.map(normalizeText);
  const normalizedActual = actual.map(normalizeText);
  const rows = expected.length + 1;
  const columns = actual.length + 1;
  const distance = Array.from({ length: rows }, () => new Uint16Array(columns));
  const matches = Array.from({ length: rows }, () => new Uint16Array(columns));
  const move = Array.from({ length: rows }, () => new Uint8Array(columns));

  for (let row = 1; row < rows; row += 1) {
    distance[row][0] = row;
    move[row][0] = 2;
  }
  for (let column = 1; column < columns; column += 1) {
    distance[0][column] = column;
    move[0][column] = 3;
  }

  for (let row = 1; row < rows; row += 1) {
    for (let column = 1; column < columns; column += 1) {
      if (normalizedExpected[row - 1] === normalizedActual[column - 1]) {
        distance[row][column] = distance[row - 1][column - 1];
        matches[row][column] = matches[row - 1][column - 1] + 1;
        move[row][column] = 1;
      } else {
        const candidates = [
          { distance: distance[row - 1][column - 1] + 1, matches: matches[row - 1][column - 1], move: 1 },
          { distance: distance[row - 1][column] + 1, matches: matches[row - 1][column], move: 2 },
          { distance: distance[row][column - 1] + 1, matches: matches[row][column - 1], move: 3 }
        ];
        candidates.sort((left, right) => left.distance - right.distance || right.matches - left.matches || left.move - right.move);
        distance[row][column] = candidates[0].distance;
        matches[row][column] = candidates[0].matches;
        move[row][column] = candidates[0].move;
      }
    }
  }

  const reversed = [];
  let row = expected.length;
  let column = actual.length;
  while (row > 0 || column > 0) {
    const direction = move[row][column];
    if (direction === 1 && normalizedExpected[row - 1] === normalizedActual[column - 1]) {
      reversed.push({
        kind: 'equal', expected: expected[row - 1], actual: actual[column - 1], sourceIndex: row - 1
      });
      row -= 1;
      column -= 1;
      continue;
    }
    if (direction === 1) {
      reversed.push({
        kind: 'replace', expected: expected[row - 1], actual: actual[column - 1], sourceIndex: row - 1
      });
      row -= 1;
      column -= 1;
      continue;
    }
    if (direction === 2) {
      reversed.push({ kind: 'missing', expected: expected[row - 1], actual: '', sourceIndex: row - 1 });
      row -= 1;
      continue;
    }
    reversed.push({ kind: 'extra', expected: '', actual: actual[column - 1], sourceIndex: row });
    column -= 1;
  }

  const operations = reversed.reverse();
  const seen = new Set();
  const words = [];
  for (const operation of operations) {
    const word = mistakeFromOperation(operation);
    if (!word || seen.has(word.key)) continue;
    seen.add(word.key);
    words.push(word);
  }

  return {
    correct: operations.every(operation => operation.kind === 'equal'),
    operations,
    words
  };
}

export function mergeMistakeWords(previousWords = [], newWords = []) {
  const merged = [];
  const indexByKey = new Map();

  for (const word of Array.isArray(previousWords) ? previousWords : []) {
    if (!word?.key || indexByKey.has(word.key)) continue;
    indexByKey.set(word.key, merged.length);
    merged.push({ ...word });
  }

  for (const word of Array.isArray(newWords) ? newWords : []) {
    if (!word?.key) continue;
    const index = indexByKey.get(word.key);
    if (index === undefined) {
      indexByKey.set(word.key, merged.length);
      merged.push({ ...word });
      continue;
    }
    const previous = merged[index];
    merged[index] = {
      ...previous,
      ...word,
      studied: false,
      studyAttempts: Number.isInteger(previous.studyAttempts) ? previous.studyAttempts : 0,
      lastAnswer: String(previous.lastAnswer ?? '')
    };
  }

  return merged;
}

export function makeDictationRecord({
  learnerId,
  videoId,
  sceneId,
  contentVersion,
  reference,
  answer,
  previous = null
}) {
  const comparison = compareSentence(reference, answer);
  const currentMistakes = wordCandidates(reference, comparison).filter(word => word.currentMistake);
  const historical = (Array.isArray(previous?.words) ? previous.words : [])
    .filter(word => word?.registeredAt || word?.currentMistake !== true);
  const words = [];
  const byTerm = new Map();
  for (const input of [...historical, ...currentMistakes]) {
    const normalized = normalizeWord(input?.term);
    if (!normalized) continue;
    const existing = byTerm.get(normalized);
    if (existing === undefined) {
      byTerm.set(normalized, words.length);
      words.push({ ...input, key: `word:${normalized}` });
    } else {
      const prior = words[existing];
      words[existing] = {
        ...input, ...prior, key: `word:${normalized}`,
        kind: input.kind, typed: input.typed, sourceIndex: input.sourceIndex,
        sourceIndexes: input.sourceIndexes, currentMistake: input.currentMistake
      };
    }
  }
  if (words.length > MAX_WORDS) throw new RangeError(`저장할 단어는 ${MAX_WORDS}개 이하여야 합니다.`);
  const selectedKeys = currentMistakes.map(word => word.key);
  const selectedSet = new Set(selectedKeys);
  return {
    learnerId: learnerId ?? previous?.learnerId ?? 'default',
    videoId,
    sceneId,
    contentVersion,
    reference: String(reference ?? ''),
    answer: String(answer ?? ''),
    attempts: (Number.isInteger(previous?.attempts) && previous.attempts >= 0 ? previous.attempts : 0) + 1,
    words: words.map(word => ({ ...word, selected: selectedSet.has(word.key) })),
    selectedKeys,
    updatedAt: new Date().toISOString()
  };
}
