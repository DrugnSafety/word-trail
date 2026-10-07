import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SENTENCE_STEPS, sentenceRanges, cardCandidates, cardExpressionId, cardProgressKey,
  sentenceCloze, sentenceOrder, orderIsCorrect, sentenceHeadingText, canReview, filterCards
} from '../public/lib/sentence-cards.js';

const video = { id: 'video-1', contentVersion: '2026.10.07-1' };

test('sentence candidates preserve exact source substrings and full dialogue reference', () => {
  const reference = '  “Wait for me!”  I can’t wait to see you.\nP.S. Come home soon.  ';
  const cards = cardCandidates(video, { id: 'c0001', chapterId: 'chapter-1', selectable: true, sentenceText: reference });
  assert.deepEqual(cards.map(card => card.text), ['“Wait for me!”', 'I can’t wait to see you.', 'P.S. Come home soon.']);
  for (const card of cards) {
    assert.equal(reference.slice(card.start, card.end), card.text);
    assert.equal(card.reference, reference);
    assert.equal(card.sourceLabel, '원본 대화 듣기');
    assert.equal(card.partialSource, true);
    assert.match(card.expressionId, /^sentence-\d+-\d+-[a-f0-9]{8}$/);
    assert.ok(card.expressionId.length <= 80);
  }
});

test('fallback splitter respects closing quotes, contractions and P.S. abbreviation', () => {
  const source = `He said, "I won't." P.S. Don't rewrite me. Last one`;
  assert.deepEqual(sentenceRanges(source, null).map(item => item.text), [
    `He said, "I won't."`, `P.S. Don't rewrite me.`, 'Last one'
  ]);
});

test('candidate identity changes with source boundaries or content version', () => {
  const base = { start: 0, end: 6, text: 'Hello.', sceneId: 'c0001', contentVersion: 'v1' };
  const first = cardExpressionId(base);
  assert.equal(first, cardExpressionId({ ...base }));
  assert.notEqual(first, cardExpressionId({ ...base, contentVersion: 'v2' }));
  assert.notEqual(first, cardExpressionId({ ...base, start: 1 }));
  assert.doesNotMatch(first, /[:\u0000]/);
  const card = cardCandidates(video, { id: 'c0001', sentenceText: 'Hello.', selectable: true })[0];
  assert.equal(cardProgressKey(card), [video.id, 'c0001', card.expressionId, video.contentVersion].join('\u0000'));
});

test('nonselectable and empty scenes do not create cards', () => {
  assert.deepEqual(cardCandidates(video, { id: 'c0001', selectable: false, sentenceText: 'Hidden.' }), []);
  assert.deepEqual(cardCandidates(video, { id: 'c0001', selectable: true, sentenceText: '   ' }), []);
  assert.deepEqual(cardCandidates({}, { id: 'c0001', sentenceText: 'Missing video.' }), []);
  assert.deepEqual(cardCandidates(video, { id: 'c0001', selectable: true, sentenceText: `${'word '.repeat(101)}end.` }), []);
});

test('source persistence boundary accepts 2000 characters and rejects 2001 without rewriting', () => {
  const reference = [
    `${'A'.repeat(499)}.`, `${'B'.repeat(498)}.`, `${'C'.repeat(498)}.`, `${'D'.repeat(498)}.`
  ].join(' ');
  assert.equal(reference.length, 2000);
  const accepted = cardCandidates(video, { id: 'c0004', selectable: true, sentenceText: reference });
  assert.equal(accepted.length, 4);
  assert.ok(accepted.every(card => card.reference === reference));
  assert.deepEqual(cardCandidates(video, { id: 'c0004', selectable: true, sentenceText: `${reference} ` }), []);
});

test('cloze deterministically removes one content word without rewriting punctuation', () => {
  const result = sentenceCloze("I can't wait to see you!");
  assert.deepEqual(result, { before: "I can't ", answer: 'wait', after: ' to see you!', start: 8, end: 12 });
  assert.equal(result.before + result.answer + result.after, "I can't wait to see you!");
  assert.equal(sentenceCloze('...'), null);
});

test('word order has stable shuffled choices and checks punctuation and contractions', () => {
  const exercise = sentenceOrder("I can't wait!");
  assert.deepEqual(exercise.tokens, ['I', "can't", 'wait', '!']);
  assert.deepEqual(sentenceOrder("I can't wait!").choices, exercise.choices);
  assert.notDeepEqual(exercise.choices.map(item => item.id), [0, 1, 2, 3]);
  assert.equal(orderIsCorrect(exercise.tokens, exercise.tokens), true);
  assert.equal(orderIsCorrect(['I', 'wait', "can't", '!'], exercise.tokens), false);
});

test('filters use saved progress, chapter, topic, query and due date independently', () => {
  const cards = [
    ...cardCandidates(video, { id: 'c0001', chapterId: 'one', sentenceText: 'Hello there.', selectable: true }),
    ...cardCandidates(video, { id: 'c0002', chapterId: 'two', sentenceText: 'See you soon.', selectable: true })
  ];
  const progressByKey = new Map([[cardProgressKey(cards[0]), { review: { dueAt: '2026-10-06T00:00:00Z' } }]]);
  const guidesById = new Map([
    [cards[0].id, { topic: 'Greeting', meaningKo: '안녕' }],
    [cards[1].id, { topic: 'Farewell', meaningKo: '곧 만나' }]
  ]);
  assert.deepEqual(filterCards(cards, { query: '곧 만나', guidesById }), [cards[1]]);
  assert.deepEqual(filterCards(cards, { topic: 'greeting', guidesById }), [cards[0]]);
  assert.deepEqual(filterCards(cards, { chapterId: 'two' }), [cards[1]]);
  assert.deepEqual(filterCards(cards, { savedOnly: true, progressByKey }), [cards[0]]);
  assert.deepEqual(filterCards(cards, { dueOnly: true, progressByKey, now: new Date('2026-10-07T00:00:00Z') }), [cards[0]]);
  assert.equal(canReview(progressByKey.get(cardProgressKey(cards[0])), new Date('2026-10-05T00:00:00Z')), false);
});

test('study order keeps recall after scaffolded exercises and before review', () => {
  assert.deepEqual(SENTENCE_STEPS, ['listen', 'meaning', 'chunks', 'cloze', 'order', 'recall', 'review']);
});

test('card heading hides only unrevealed listening and answer-bearing quiz steps', () => {
  const sentence = "I can't wait to see you.";
  assert.equal(sentenceHeadingText(sentence, 'listen', false), '영어 문장을 먼저 들어 보세요');
  assert.equal(sentenceHeadingText(sentence, 'listen', true), sentence);
  assert.equal(sentenceHeadingText(sentence, 'meaning', false), sentence);
  assert.equal(sentenceHeadingText(sentence, 'chunks', false), sentence);
  assert.equal(sentenceHeadingText(sentence, 'review', false), sentence);
  for (const step of ['cloze', 'order', 'recall']) {
    assert.equal(sentenceHeadingText(sentence, step, true), '문장을 완성해 보세요');
    assert.doesNotMatch(sentenceHeadingText(sentence, step, true), /can't wait/);
  }
});

test('dangerous source text remains inert data for DOM textContent rendering', () => {
  const source = '<img src=x onerror=alert(1)> Really?';
  const cards = cardCandidates(video, { id: 'c0003', sentenceText: source, selectable: true });
  assert.equal(cards[0].text, '<img src=x onerror=alert(1)> Really?');
  assert.equal(cards[0].reference, source);
});
