import test from 'node:test';
import assert from 'node:assert/strict';
import { PRACTICE_ORDER, nextPractice, phraseRange } from '../public/lib/practice.js';
import { sentenceWordRanges, sourceClozeAnswer } from '../public/app.js';

test('guided practice progresses through all modes then the next word and completion', () => {
  const words = [{ term: 'please' }, { term: 'thank you' }];
  let current = { mode: PRACTICE_ORDER[0], index: 0 };
  const visited = [];
  while (!current.complete) {
    visited.push(`${current.index}:${current.mode}`);
    current = nextPractice(current.mode, current.index, words);
  }
  assert.deepEqual(visited, words.flatMap((_, index) => PRACTICE_ORDER.map(mode => `${index}:${mode}`)));
});

test('missing meaning skips only meaning quiz and never skips independent reading', () => {
  assert.deepEqual(nextPractice('spelling', 0, [{}]), { mode: 'audio', index: 0 });
  assert.deepEqual(nextPractice('audio', 0, [{}]), { mode: 'cloze', index: 0 });
  assert.deepEqual(nextPractice('cloze', 0, [{}], () => false), { mode: 'family', index: 0 });
  assert.deepEqual(nextPractice('family', 0, [{}]), { mode: 'reading', index: 0 });
  assert.deepEqual(nextPractice('reading', 0, [{}]), { complete: true });
  assert.deepEqual(nextPractice('reading', 0, []), { complete: true });
});

test('phrase export uses the complete first occurrence instead of only its first word', () => {
  const source = 'Thank you, and thank you again.';
  const range = phraseRange(sentenceWordRanges(source), { term: 'thank you', sourceIndexes: [0, 1, 3, 4] });
  assert.equal(source.slice(range.start, range.end), 'Thank you');
});

test('cloze preserves the original form while spelling practice uses the headword', () => {
  assert.equal(sourceClozeAnswer('These goals excite me.', { term: 'goal', sourceIndexes: [1] }), 'goals');
  assert.equal(sourceClozeAnswer('I was excited.', { term: 'excite', sourceIndexes: [2] }), 'excited');
  assert.equal(sourceClozeAnswer('He took off.', { term: 'took off', sourceIndexes: [1, 2] }), 'took off');
});
