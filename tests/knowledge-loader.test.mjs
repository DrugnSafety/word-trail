import test from 'node:test';
import assert from 'node:assert/strict';
import { createKnowledgeLoader } from '../public/lib/knowledge-loader.js';
const tick = () => new Promise(resolve => setImmediate(resolve));
const ready = term => ({ term, englishStatus: 'ready', relatedWords: [{ term: `${term}s` }] });

test('next word starts before navigation; prefetch and visible requests share one call', async () => {
  const calls = []; const releases = [];
  const loader = createKnowledgeLoader({ resolve: word => new Promise(resolve => { calls.push(word.term); releases.push(() => resolve(ready(word.term))); }) });
  loader.prefetch([{ term: 'dragon' }, { term: 'garden' }, { term: 'story' }]);
  const current = loader.load({ term: 'dragon' });
  await tick();
  assert.deepEqual(calls, ['dragon', 'garden']);
  releases[0](); await current; await tick();
  assert.deepEqual(calls, ['dragon', 'garden', 'story']);
  releases[1](); releases[2](); await tick();
  assert.equal((await loader.load({ term: 'garden' })).term, 'garden');
  assert.equal(calls.length, 3);
});

test('account clear aborts and discards late work and queued words', async () => {
  const cache = new Map(); const releases = []; const signals = [];
  const loader = createKnowledgeLoader({ cache, concurrency: 1, resolve: (word, { signal }) => new Promise(resolve => { signals.push(signal); releases.push(() => resolve(ready(word.term))); }) });
  const old = loader.load({ term: 'old' });
  const queued = loader.load({ term: 'queued' });
  const oldRejected = assert.rejects(old, { name: 'AbortError' });
  const queuedRejected = assert.rejects(queued, { name: 'AbortError' });
  await tick(); loader.clear();
  assert.equal(signals[0].aborted, true);
  const fresh = loader.load({ term: 'fresh' });
  await tick(); releases[0](); releases[1]();
  await Promise.all([oldRejected, queuedRejected, fresh]);
  assert.deepEqual([...cache.keys()], ['fresh']);
});

test('failures and incomplete packages remain retryable', async () => {
  let calls = 0;
  const loader = createKnowledgeLoader({ resolve: async () => { calls++; return { englishStatus: 'ready', relatedWords: [] }; } });
  await loader.load({ term: 'dragon' }); await tick();
  await loader.load({ term: 'dragon' });
  assert.equal(calls, 2);
});

test('same-term records share neutral content without caching a record-specific meaning', async () => {
  const inputs = []; const cache = new Map();
  const loader = createKnowledgeLoader({ cache, resolve: async word => {
    inputs.push(word);
    return { ...ready(word.term), meaningKo: word.meaningKo || '공통 사전 뜻' };
  } });
  const first = loader.load({ term: 'dragon', meaningKo: '첫 기록 뜻' });
  const second = loader.load({ term: 'dragon', meaningKo: '둘째 기록 뜻' });
  assert.equal(first, second);
  assert.equal((await first).meaningKo, '공통 사전 뜻');
  assert.equal((await second).meaningKo, '공통 사전 뜻');
  assert.deepEqual(inputs, [{ term: 'dragon' }]);
  assert.equal(cache.get('dragon').meaningKo, '공통 사전 뜻');
});
