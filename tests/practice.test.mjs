import test from 'node:test';
import assert from 'node:assert/strict';
import { PRACTICE_ORDER, nextPractice, phraseRange } from '../public/lib/practice.js';
import { sentenceWordRanges } from '../public/app.js';

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
  assert.deepEqual(nextPractice('audio', 0, [{}], () => false), { mode: 'reading', index: 0 });
  assert.deepEqual(nextPractice('reading', 0, [{}]), { complete: true });
  assert.deepEqual(nextPractice('reading', 0, []), { complete: true });
});

test('phrase export uses the complete first occurrence instead of only its first word', () => {
  const source = 'Thank you, and thank you again.';
  const range = phraseRange(sentenceWordRanges(source), { term: 'thank you', sourceIndexes: [0, 1, 3, 4] });
  assert.equal(source.slice(range.start, range.end), 'Thank you');
});
