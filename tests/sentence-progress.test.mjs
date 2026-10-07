import test from 'node:test';
import assert from 'node:assert/strict';
import { makeSentenceProgress, sentenceCardFromProgress } from '../public/app.js';
import { cardCandidates } from '../public/lib/sentence-cards.js';
import { createStore } from '../public/lib/store.js';

const video = { id: 'video-01', contentVersion: '2026.10.06-1' };
const scene = { id: 'c0001', sentenceText: 'Can we play? I can go.', selectable: true };
const card = cardCandidates(video, scene)[0];
const now = new Date('2026-10-07T12:00:00.000Z');
const storage = () => { const values = new Map(); return { getItem: key => values.get(key) || null, setItem: (key, value) => values.set(key, value) }; };

test('saved sentence has its own progress identity and source offsets without completed reading', () => {
  const record = makeSentenceProgress(card, null, { now, topic: '제안하기' });
  assert.equal(record.reading.result, null); assert.equal(record.review.dueAt, null);
  assert.equal(record.sentenceCard.topic, '제안하기');
  const restored = sentenceCardFromProgress(record);
  assert.equal(restored.text, 'Can we play?'); assert.equal(restored.reference, scene.sentenceText);
  assert.equal(restored.expressionId, card.expressionId);
  assert.equal(sentenceCardFromProgress({ ...record, kind: 'word' }), null);
  assert.equal(sentenceCardFromProgress({ ...record, sentenceCard: { ...record.sentenceCard, text: 'A rewritten sentence.' } }), null);
});

test('sentence review schedule advances independently and saving again preserves due date', () => {
  const saved = makeSentenceProgress(card, null, { now });
  const reviewed = makeSentenceProgress(card, saved, { now, independent: true });
  assert.equal(reviewed.review.dueAt, '2026-10-08T12:00:00.000Z');
  assert.equal(reviewed.reading.result, 'independent');
  assert.deepEqual(makeSentenceProgress(card, reviewed, { now }).review, reviewed.review);
  const helped = makeSentenceProgress(card, reviewed, { now: new Date('2026-10-08T13:00:00Z'), independent: false });
  assert.equal(helped.reading.result, 'helped'); assert.equal(helped.review.step, 0);
});

test('sentence and vocabulary progress coexist through guest CAS storage and reload', async () => {
  const memory = storage(), auth = { getSession: async () => null, storage: memory };
  const store = createStore(auth);
  const one = await store.saveProgress(makeSentenceProgress(card, null, { now }), null, 'guest');
  const otherCard = cardCandidates(video, scene)[1];
  await store.saveProgress(makeSentenceProgress(otherCard, null, { now }), null, 'guest');
  await assert.rejects(store.saveProgress(makeSentenceProgress(card, one, { now, independent: false }), null, 'guest'), /변경/);
  const reviewed = await store.saveProgress(makeSentenceProgress(card, one, { now, independent: false }), one.updatedAt, 'guest');
  const loaded = await createStore(auth).load('guest');
  assert.equal(loaded.progress.length, 2);
  assert.equal(sentenceCardFromProgress(loaded.progress.find(item => item.expressionId === reviewed.expressionId)).text, card.text);
});

test('UTF-16 source offsets survive emoji before a sentence and reject malformed metadata', async () => {
  const source = { ...scene, sentenceText: '😀 Hello! Can we play?' };
  const selected = cardCandidates(video, source).find(item => item.text === 'Can we play?');
  assert.equal(selected.start, source.sentenceText.indexOf('Can we play?'));
  const record = makeSentenceProgress(selected, null, { now });
  const store = createStore({ getSession: async () => null, storage: storage() });
  await store.saveProgress(record, null, 'guest');
  assert.equal(sentenceCardFromProgress((await store.load('guest')).progress[0]).text, selected.text);
  for (const sentenceCard of [
    { ...record.sentenceCard, start: String(record.sentenceCard.start) },
    { ...record.sentenceCard, text: 'A different sentence.' },
    { ...record.sentenceCard, reference: 'x'.repeat(2001) }
  ]) await assert.rejects(store.saveProgress({ ...record, sentenceCard }, null, 'guest'), /원본/);
});
