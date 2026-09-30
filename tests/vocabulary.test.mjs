import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeWord,
  wordCandidates,
  phraseCandidates,
  makePhraseCandidate,
  commitSelection,
  selectedWords,
  registerPractice,
  wordKnowledge
} from '../public/lib/vocabulary.js';
import { compareSentence, makeDictationRecord } from '../public/lib/dictation.js';
import { createStore } from '../public/lib/store.js';

test('candidates deduplicate canonical source terms and collect occurrence indexes', () => {
  const comparison = compareSentence('Mum can help Mum', 'Mom can help');
  const candidates = wordCandidates('Mum can help Mum', comparison);
  assert.deepEqual(candidates.map(word => [word.key, word.sourceIndexes, word.selected]), [
    ['word:mum', [0, 3], true],
    ['word:can', [1], false],
    ['word:help', [2], false]
  ]);
  assert.equal(candidates[0].currentMistake, true);
  assert.equal(normalizeWord('  MUM  '), 'mum');
});

test('extras never become vocabulary candidates or default selections', () => {
  const comparison = compareSentence('Mum can help', 'Mum can really help today');
  const candidates = wordCandidates('Mum can help', comparison);
  assert.equal(candidates.some(word => ['really', 'today'].includes(normalizeWord(word.term))), false);
  assert.deepEqual(candidates.filter(word => word.selected), []);
});

test('expression candidates find repeated and overlapping contiguous phrase spans', () => {
  const candidates = phraseCandidates('Go go go, then THANK you. Thank you!', [
    { id: 'go-go', term: 'go go', meaningKo: '가자 가자' },
    { id: 'go-go-go', term: 'go go go', meaningKo: '계속 가자' },
    { id: 'thank-you', term: 'thank you', meaningKo: '고마워요' }
  ]);
  assert.deepEqual(candidates.map(candidate => [candidate.key, candidate.sourceIndex, candidate.sourceIndexes]), [
    ['word:go go go', 0, [0, 1, 2]],
    ['word:go go', 0, [0, 1]],
    ['word:thank you', 4, [4, 5, 6, 7]]
  ]);
  assert.deepEqual(candidates[1].occurrenceSpans, [[0, 1]]);
  assert.deepEqual(candidates[2].occurrenceSpans, [[4, 5], [6, 7]]);
  assert.equal(candidates[2].term, 'THANK you');
  assert.equal(candidates[2].label, '고마워요');
});

test('phrase matching normalizes Unicode apostrophes but never crosses sentence punctuation', () => {
  const expressions = [
    { id: 'dont-go', term: "don't go", aliases: ["don’t go"] },
    { id: 'hello-there', term: 'hello there', aliases: [] }
  ];
  const candidates = phraseCandidates('DON’T go. Hello! There 안녕 친구', expressions);
  assert.deepEqual(candidates.map(candidate => candidate.key), ["word:don't go"]);
  assert.equal(candidates[0].term, "DON'T go");

  assert.throws(() => makePhraseCandidate('Hello. There', 0, 1), /문장 부호/);
  assert.throws(() => makePhraseCandidate('one two', 0, 0), /두 개 이상/);
  assert.throws(() => makePhraseCandidate('one two', 1, 2), /이어진 단어 위치/);
  assert.deepEqual(makePhraseCandidate('안녕 친구야, 같이 가자', 0, 1).sourceIndexes, [0, 1]);
});

test('phrase selection persists only validated source-backed candidates', () => {
  const record = makeDictationRecord({
    videoId: 'video-01', sceneId: 'c0001', contentVersion: '1',
    reference: 'Thank you, and thank you again.', answer: 'Thank you, and thank you again.'
  });
  const [phrase] = phraseCandidates(record.reference, [{ id: 'thank-you', term: 'thank you', meaningKo: '고마워요' }]);
  const fake = { ...phrase, key: 'word:you and', term: 'you and', sourceIndex: 1, sourceIndexes: [1, 4] };
  const saved = commitSelection(record, [phrase.key, fake.key], '2026-09-25T10:00:00Z', [phrase, fake]);
  assert.deepEqual(saved.selectedKeys, ['word:thank you']);
  assert.deepEqual(selectedWords(saved).map(word => [word.term, word.sourceIndexes]), [
    ['Thank you', [0, 1, 3, 4]]
  ]);
  assert.equal(saved.words[0].registeredAt, '2026-09-25T10:00:00.000Z');
  assert.equal(saved.words[0].kind, 'manual');
  assert.equal('expressionId' in saved.words[0], false);
  assert.equal('label' in saved.words[0], false);
  assert.equal('occurrenceSpans' in saved.words[0], false);
});

test('persisted phrase records satisfy the existing guest-store contract', async () => {
  const values = new Map();
  const storage = {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: key => values.delete(key)
  };
  const auth = { storage, config: {}, getSession: async () => null };
  const store = createStore(auth);
  const record = makeDictationRecord({
    videoId: 'video-01', sceneId: 'c0001', contentVersion: '1',
    reference: 'Thank you very much.', answer: 'Thank you very much.'
  });
  const phrase = makePhraseCandidate(record.reference, 0, 1);
  const committed = commitSelection(record, [phrase.key], '2026-09-25T10:00:00Z', [phrase]);
  const saved = await store.saveDictation(committed);
  assert.deepEqual(saved.selectedKeys, ['word:thank you']);
  assert.deepEqual(saved.words[0].sourceIndexes, [0, 1]);
});

test('commit registers only explicit selection and keeps first registration time', () => {
  const attempt = makeDictationRecord({
    videoId: 'video-01', sceneId: 'c0001', contentVersion: '1',
    reference: 'Mum can help Mum', answer: 'Mom can help'
  });
  const first = commitSelection(attempt, ['word:mum', 'word:can'], '2026-09-25T10:00:00Z');
  assert.deepEqual(first.selectedKeys, ['word:mum', 'word:can']);
  assert.deepEqual(selectedWords(first).map(word => word.term), ['Mum', 'can']);
  assert.equal(first.words[0].registeredAt, '2026-09-25T10:00:00.000Z');
  assert.equal(first.words[0].kind, 'replace');
  assert.equal(first.words[0].typed, 'Mom');
  assert.deepEqual(first.words[0].sourceIndexes, [0, 3]);

  const second = commitSelection(first, ['word:mum'], '2026-09-26T10:00:00Z');
  assert.equal(second.words.find(word => word.key === 'word:mum').registeredAt, '2026-09-25T10:00:00.000Z');
  assert.ok(second.words.some(word => word.key === 'word:can'));
  assert.deepEqual(selectedWords(second).map(word => word.key), ['word:mum']);
});

test('correct retry clears defaults but registered history remains available', () => {
  const wrong = makeDictationRecord({
    videoId: 'video-01', sceneId: 'c0001', contentVersion: '1', reference: 'Mum can help', answer: 'Mom can help'
  });
  const committed = commitSelection(wrong, wrong.selectedKeys, '2026-09-25T10:00:00Z');
  const correct = makeDictationRecord({
    videoId: 'video-01', sceneId: 'c0001', contentVersion: '1', reference: 'Mum can help',
    answer: 'Mum can help', previous: committed
  });
  assert.deepEqual(correct.selectedKeys, []);
  assert.equal(correct.words[0].registeredAt, '2026-09-25T10:00:00.000Z');
});

test('practice tracks each mode independently and reading updates delayed review only', () => {
  const base = {
    key: 'word:mum', term: 'Mum', kind: 'manual', typed: '', sourceIndex: 0,
    studied: false, studyAttempts: 0, lastAnswer: ''
  };
  const spelling = registerPractice(base, 'spelling', 'mum', true, '2026-09-25T12:00:00Z');
  assert.deepEqual(spelling.practice.spelling, {
    attempts: 1, correct: 1, lastPracticedAt: '2026-09-25T12:00:00.000Z'
  });
  assert.equal(spelling.review, undefined);
  const reading = registerPractice(spelling, 'reading', 'independent', true, '2026-09-25T13:00:00Z');
  assert.equal(reading.studyAttempts, 2);
  assert.equal(reading.practice.reading.correct, 1);
  assert.equal(reading.review.dueAt, '2026-09-26T13:00:00.000Z');
  const helped = registerPractice(reading, 'reading', 'helped', false, '2026-09-26T14:00:00Z');
  assert.equal(helped.practice.reading.attempts, 2);
  assert.equal(helped.practice.reading.correct, 1);
  assert.equal(helped.review.step, 0);

  const incorrect = registerPractice(base, 'audio', 'mom', false, '2026-09-25T12:00:00Z');
  assert.equal(incorrect.studied, false);
  assert.equal(incorrect.practice.audio.attempts, 1);
});

test('knowledge uses parent meaning, then exact editorial content, then offline lexicon', () => {
  const expressions = [{
    term: 'Mum', ipa: '/mʌm/', meaningKo: '엄마', explanationKo: '가족 호칭', dialogues: [{ titleKo: '대화' }]
  }];
  const lexicon = [{ term: 'help', ipa: '/help/', meaningKo: '돕다', explanationKo: '도움을 주다' }];
  assert.equal(wordKnowledge({ term: 'Mum', meaningKo: '우리 엄마' }, expressions, []).source, 'parent');
  assert.equal(wordKnowledge({ term: 'mum' }, expressions, []).dialogues.length, 1);
  assert.deepEqual(wordKnowledge({ term: 'help' }, [], lexicon), {
    source: 'offline', term: 'help', ipa: '/help/', meaningKo: '돕다', explanationKo: '도움을 주다', dialogues: []
  });
  assert.equal(wordKnowledge({ term: 'unknown' }, [], []).source, 'missing');
});

test('knowledge resolves an expression alias without overriding an exact expression', () => {
  const expressions = [
    { term: 'do not go', aliases: ["don't go"], meaningKo: '가지 마' },
    { term: "don't go", aliases: [], meaningKo: '정확한 표현' }
  ];
  assert.equal(wordKnowledge({ term: "DON’T GO" }, expressions, []).meaningKo, '정확한 표현');
  assert.equal(wordKnowledge({ term: 'cannot wait' }, [
    { term: "can't wait", aliases: ['cannot wait'], meaningKo: '정말 기대돼' }
  ], []).meaningKo, '정말 기대돼');
});
