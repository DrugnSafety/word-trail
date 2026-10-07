import test from 'node:test';
import assert from 'node:assert/strict';
import { createStudyGuideLookup } from '../public/lib/study-guide.js';

const result = input => ({ ok: true, json: async () => ({ kind: input.kind, text: input.text }) });

test('study lookups share prefetch and current requests and retain exact source case', async () => {
  const requests = [];
  const lookup = createStudyGuideLookup({ fetchImpl: async (_, options) => { const input = JSON.parse(options.body); requests.push(input); return result(input); } });
  lookup.prefetch([{ kind: 'sentence', text: 'I can play.', context: 'I can play. Can you?' }]);
  const a = lookup.load('sentence', 'I can play.', 'I can play. Can you?');
  const b = lookup.load('sentence', 'I can play.', 'I can play. Can you?');
  assert.equal(a, b); await a;
  await lookup.load('sentence', 'I can play.', 'I can play. Can you?');
  assert.equal(requests.length, 1);
  await lookup.load('sentence', 'I can play.', 'Another context.');
  assert.equal(requests.length, 2);
});

test('guide failures and mismatched source responses remain retryable', async () => {
  let count = 0;
  const lookup = createStudyGuideLookup({ fetchImpl: async (_, options) => {
    if (++count === 1) return { ok: false, status: 503 };
    if (count === 2) return result({ kind: 'word', text: 'incorrect' });
    return result(JSON.parse(options.body));
  } });
  await assert.rejects(lookup.load('word', 'rain'), /불러오지/);
  await assert.rejects(lookup.load('word', 'rain'), /일치/);
  assert.equal((await lookup.load('word', 'rain')).text, 'rain');
  assert.equal(count, 3);
});

test('account change aborts active and queued work and stale completion cannot poison new cache', async () => {
  let finish;
  const signals = [];
  const lookup = createStudyGuideLookup({ concurrency: 1, fetchImpl: (_, options) => {
    signals.push(options.signal);
    return new Promise(resolve => { finish = () => resolve(result(JSON.parse(options.body))); });
  } });
  const a = lookup.load('word', 'rain'); const b = lookup.load('word', 'goal');
  const rejectedA = assert.rejects(a, { name: 'AbortError' }); const rejectedB = assert.rejects(b, { name: 'AbortError' });
  await Promise.resolve(); const oldFinish = finish;
  lookup.clear(); oldFinish(); await Promise.all([rejectedA, rejectedB]);
  assert.equal(signals[0].aborted, true);
  const c = lookup.load('word', 'rain'); await Promise.resolve(); finish();
  assert.equal((await c).text, 'rain'); assert.equal(signals.length, 2);
});
