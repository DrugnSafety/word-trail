import test from 'node:test';
import assert from 'node:assert/strict';
import {
  compareSentence,
  makeDictationRecord,
  mergeMistakeWords
} from '../public/lib/dictation.js';
import { commitSelection, makePhraseCandidate, selectedWords } from '../public/lib/vocabulary.js';

test('sentence comparison ignores case, ordinary punctuation and spacing', () => {
  const result = compareSentence("Mum, let's go!", '  MUM let’s   go. ');
  assert.equal(result.correct, true);
  assert.deepEqual(result.operations.map(({ kind, expected }) => [kind, expected]), [
    ['equal', 'Mum'], ['equal', "let's"], ['equal', 'go']
  ]);
  assert.deepEqual(result.words, []);
});

test('misspelling, omission and insertion align without cascading errors', () => {
  const result = compareSentence('I really like this blue dog', 'I reely like blue tiny dog');
  assert.equal(result.correct, false);
  assert.deepEqual(result.operations, [
    { kind: 'equal', expected: 'I', actual: 'I', sourceIndex: 0 },
    { kind: 'replace', expected: 'really', actual: 'reely', sourceIndex: 1 },
    { kind: 'equal', expected: 'like', actual: 'like', sourceIndex: 2 },
    { kind: 'missing', expected: 'this', actual: '', sourceIndex: 3 },
    { kind: 'equal', expected: 'blue', actual: 'blue', sourceIndex: 4 },
    { kind: 'extra', expected: '', actual: 'tiny', sourceIndex: 5 },
    { kind: 'equal', expected: 'dog', actual: 'dog', sourceIndex: 5 }
  ]);
  assert.deepEqual(result.words.map(word => [word.kind, word.term, word.typed]), [
    ['replace', 'really', 'reely'],
    ['missing', 'this', ''],
    ['extra', 'tiny', 'tiny']
  ]);
});

test('repeated words choose a stable first occurrence and deduplicate study words', () => {
  const missing = compareSentence('go go home', 'go home');
  assert.deepEqual(missing.operations.map(operation => [operation.kind, operation.sourceIndex]), [
    ['missing', 0], ['equal', 1], ['equal', 2]
  ]);

  const repeatedMistakes = compareSentence('go go home', 'no no home');
  assert.equal(repeatedMistakes.words.length, 1);
  assert.equal(repeatedMistakes.words[0].sourceIndex, 0);
  assert.equal(repeatedMistakes.words[0].term, 'go');
});

test('contractions remain one word and apostrophes matter', () => {
  assert.equal(compareSentence("I don't know", 'I dont know').correct, false);
  assert.deepEqual(compareSentence("I don't know", 'I dont know').words.map(word => word.term), ["don't"]);
  assert.equal(compareSentence("I don’t know", "i don't know").correct, true);
});

test('hyphens are word boundaries and do not create beginner spelling errors', () => {
  assert.equal(compareSentence('ice-cream', 'ice cream').correct, true);
  assert.equal(compareSentence('Please re-enter it.', 'please re enter it').correct, true);
});

test('Faceytalk sentence maps replacement, omission and trailing insertion correctly', () => {
  const result = compareSentence(
    'Mum, can we do Faceytalk with Muffin and Socks?',
    'Mom can we do Faceytalk Muffin and Socks today'
  );
  assert.deepEqual(result.words.map(word => [word.kind, word.term, word.typed, word.sourceIndex]), [
    ['replace', 'Mum', 'Mom', 0],
    ['missing', 'with', '', 5],
    ['extra', 'today', 'today', 9]
  ]);
});

test('unicode text remains inert data and empty answers produce missing words', () => {
  const hostile = compareSentence('안녕 <script> Bluey', '안녕 script Bluely');
  assert.deepEqual(hostile.operations.map(operation => operation.kind), ['equal', 'equal', 'replace']);
  assert.equal(hostile.words[0].term, 'Bluey');
  assert.deepEqual(compareSentence('Come here now.', '').words.map(word => word.term), ['Come', 'here', 'now']);
});

test('mistake union preserves studied history and resets a repeated new error', () => {
  const previous = [{
    key: 'replace:really', term: 'really', kind: 'replace', typed: 'realy', sourceIndex: 1,
    studied: true, studyAttempts: 3, lastAnswer: 'really'
  }];
  const newlyWrong = compareSentence('I really agree', 'I reely agree').words;
  const merged = mergeMistakeWords(previous, newlyWrong);
  assert.equal(merged[0].studied, false);
  assert.equal(merged[0].studyAttempts, 3);
  assert.equal(merged[0].lastAnswer, 'really');
  assert.equal(merged[0].typed, 'reely');
});

test('each submission resets current selection while registered and legacy history survive', () => {
  const first = makeDictationRecord({
    learnerId: 'learner-1',
    videoId: 'video-01', sceneId: 's001', contentVersion: '1',
    reference: 'Mum can help', answer: 'Mom can help'
  });
  assert.deepEqual(first.selectedKeys, ['word:mum']);
  const corrected = makeDictationRecord({
    videoId: 'video-01', sceneId: 's001', contentVersion: '1',
    reference: 'Mum can help', answer: 'Mum can help', previous: first
  });
  assert.equal(corrected.attempts, 2);
  assert.deepEqual(corrected.selectedKeys, []);
  assert.deepEqual(corrected.words, []);
  assert.equal(corrected.learnerId, 'learner-1');
  assert.match(corrected.updatedAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(makeDictationRecord({
    videoId: 'video-01', sceneId: 's001', contentVersion: '1', reference: 'Hi', answer: 'Hi'
  }).learnerId, 'default');

  const legacy = makeDictationRecord({
    videoId: 'video-01', sceneId: 's001', contentVersion: '1',
    reference: 'Mum can help', answer: 'Mum can help',
    previous: { attempts: 1, words: [{
      key: 'replace:mum', term: 'Mum', kind: 'replace', typed: 'Mom', sourceIndex: 0,
      studied: true, studyAttempts: 2, lastAnswer: 'Mum'
    }] }
  });
  assert.equal(legacy.words[0].key, 'word:mum');
  assert.deepEqual(legacy.selectedKeys, []);
});

test('correct retry preserves registered phrase history without selecting it as a past error', () => {
  const wrong = makeDictationRecord({
    learnerId: 'learner-1', videoId: 'video-01', sceneId: 's001', contentVersion: '1',
    reference: 'Mum can help us now', answer: 'Mom can help us now'
  });
  const phrase = makePhraseCandidate(wrong.reference, 1, 2);
  const committed = commitSelection(wrong, [phrase.key], '2026-09-25T10:00:00Z', [phrase]);
  assert.deepEqual(selectedWords(committed).map(word => word.term), ['can help']);

  const correct = makeDictationRecord({
    videoId: 'video-01', sceneId: 's001', contentVersion: '1',
    reference: 'Mum can help us now', answer: 'Mum can help us now', previous: committed
  });
  assert.deepEqual(correct.selectedKeys, []);
  assert.equal(correct.words.length, 1);
  assert.equal(correct.words[0].key, 'word:can help');
  assert.equal(correct.words[0].registeredAt, '2026-09-25T10:00:00.000Z');
  assert.deepEqual(correct.words[0].sourceIndexes, [1, 2]);
  assert.equal(correct.words[0].selected, false);
});

test('sentence length is bounded', () => {
  assert.throws(() => compareSentence('a'.repeat(2001), ''), /기준 문장은 2000자 이하/);
  assert.throws(() => compareSentence('', 'a'.repeat(2001)), /입력 문장은 2000자 이하/);
  assert.throws(() => compareSentence('a'.repeat(101), ''), /기준 문장의 각 단어는 100자 이하/);
  assert.throws(() => compareSentence('ok', Array(201).fill('x').join(' ')), /입력 문장은 단어 200개 이하/);
});

test('dictation applies supplied family inflections and preserves the mistaken source form', () => {
  const record = makeDictationRecord({
    videoId: 'video-01', sceneId: 's001', contentVersion: '1',
    reference: 'She phoned Mum', answer: 'She Mum',
    families: [{ id: 'phone', terms: ['phone', 'phones', 'phoned', 'phoning'] }]
  });
  assert.deepEqual(record.selectedKeys, ['word:phone']);
  assert.equal(record.words[0].term, 'phone');
  assert.equal(record.words[0].sourceTerm, 'phoned');
  assert.deepEqual(record.words[0].sourceIndexes, [1]);
});

test('dictation reload canonicalizes legacy lemma history and retains reading completion', () => {
  const previous = makeDictationRecord({
    videoId: 'video-01', sceneId: 's001', contentVersion: '1',
    reference: 'Goals matter', answer: '',
  });
  previous.words[0] = {
    ...previous.words[0], key: 'word:goals', term: 'Goals', studied: true, studyAttempts: 4,
    registeredAt: '2026-09-20T10:00:00.000Z',
    practice: { reading: { attempts: 4, correct: 4, lastPracticedAt: '2026-09-25T10:00:00.000Z' } },
    review: { step: 3, dueAt: '2026-10-09T10:00:00.000Z', lastReviewedDate: '2026-09-25' }
  };
  previous.selectedKeys = ['word:goals'];
  const reloaded = makeDictationRecord({
    videoId: 'video-01', sceneId: 's001', contentVersion: '1',
    reference: 'Goals matter', answer: 'Goals matter', previous
  });
  assert.equal(reloaded.words[0].key, 'word:goal');
  assert.equal(reloaded.words[0].studyAttempts, 4);
  assert.equal(reloaded.words[0].practice.reading.correct, 4);
  assert.equal(reloaded.words[0].review.step, 3);
});
