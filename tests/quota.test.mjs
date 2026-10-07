import test from 'node:test';
import assert from 'node:assert/strict';

import { createQuotaManager, QuotaStoreError, QuotaUnavailableError } from '../server/quota.mjs';
import { createAiMeaningService } from '../server/ai-service.mjs';

function memoryStore(initialValue = null) {
  let value = structuredClone(initialValue);
  let version = 0;
  let casCalls = 0;
  return {
    async read() {
      return { value: structuredClone(value), etag: String(version) };
    },
    async compareAndSwap(next, etag) {
      casCalls += 1;
      await Promise.resolve();
      if (etag !== String(version)) return false;
      value = structuredClone(next);
      version += 1;
      return true;
    },
    snapshot() { return structuredClone(value); },
    casCalls() { return casCalls; }
  };
}

function validLedger() {
  return {
    version: 1,
    cursor: 0,
    keys: {
      'key-1': {
        disabled: false,
        cooldownUntil: 0,
        days: { '2026-10-06': { used: 22, holds: { 'hold-1': 30 } } }
      }
    },
    cache: {}
  };
}

test('quota rotates keys durably and settles exact token usage', async () => {
  const store = memoryStore();
  const quota = createQuotaManager({ store, keyIds: ['key-1', 'key-2'], dailyLimit: 100, now: () => new Date('2026-10-06T12:00:00Z') });
  const first = await quota.reserve(20);
  const second = await quota.reserve(20);
  assert.equal(first.keyId, 'key-1');
  assert.equal(second.keyId, 'key-2');
  assert.equal(await quota.settle(first, 7), true);
  assert.equal(await quota.settle(second, 11), true);
  assert.deepEqual((await quota.usageSummary()).keys, [
    { id: 'key-1', used: 7, reserved: 0, remaining: 93, disabled: false },
    { id: 'key-2', used: 11, reserved: 0, remaining: 89, disabled: false }
  ]);
});

test('quota enforces used plus concurrent holds under CAS contention', async () => {
  const store = memoryStore();
  const quota = createQuotaManager({ store, keyIds: ['only'], dailyLimit: 100, now: () => new Date('2026-10-06T12:00:00Z') });
  const results = await Promise.allSettled([quota.reserve(60), quota.reserve(60)]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(results.filter(result => result.reason instanceof QuotaUnavailableError).length, 1);
  assert.equal((await quota.usageSummary()).keys[0].reserved, 60);
});

test('quota resets capacity by configured local calendar day', async () => {
  let instant = new Date('2026-10-07T03:59:00Z');
  const store = memoryStore();
  const quota = createQuotaManager({
    store, keyIds: ['only'], dailyLimit: 100, timezone: 'America/New_York', now: () => instant
  });
  const beforeMidnight = await quota.reserve(100);
  await quota.settle(beforeMidnight, 100);
  await assert.rejects(quota.reserve(1), QuotaUnavailableError);
  instant = new Date('2026-10-07T04:01:00Z');
  assert.equal((await quota.reserve(100)).day, '2026-10-07');
});

test('disabled keys stay excluded while cooldowns expire', async () => {
  let instant = new Date('2026-10-06T12:00:00Z');
  const quota = createQuotaManager({ store: memoryStore(), keyIds: ['bad', 'busy', 'good'], dailyLimit: 100, now: () => instant, cooldownMs: 1_000 });
  const bad = await quota.reserve(10);
  await quota.disable(bad);
  const busy = await quota.reserve(10);
  await quota.cooldown(busy);
  assert.equal((await quota.reserve(10)).keyId, 'good');
  instant = new Date('2026-10-06T12:00:02Z');
  assert.equal((await quota.reserve(10, { excludeKeyIds: ['good'] })).keyId, 'busy');
});

test('unknown outcomes retain holds and exact seed usage is additive', async () => {
  const quota = createQuotaManager({ store: memoryStore(), keyIds: ['key-1'], dailyLimit: 100, now: () => new Date('2026-10-06T12:00:00Z') });
  await quota.seedUsage('key-1', 22);
  await quota.reserve(30);
  assert.deepEqual((await quota.usageSummary()).keys[0], {
    id: 'key-1', used: 22, reserved: 30, remaining: 48, disabled: false
  });
});

test('an impossible provider total fails closed and disables the key', async () => {
  const quota = createQuotaManager({ store: memoryStore(), keyIds: ['key-1'], dailyLimit: 100, now: () => new Date('2026-10-06T12:00:00Z') });
  const reservation = await quota.reserve(20);
  assert.equal(await quota.settle(reservation, 21), false);
  assert.deepEqual((await quota.usageSummary()).keys[0], {
    id: 'key-1', used: 0, reserved: 20, remaining: 80, disabled: true
  });
  await assert.rejects(quota.reserve(1), QuotaUnavailableError);
});

test('persistent cache is bounded and returns clones', async () => {
  let tick = 0;
  const quota = createQuotaManager({ store: memoryStore(), keyIds: ['key-1'], cacheLimit: 2, now: () => new Date(++tick) });
  await quota.putCached('a', { value: 1 });
  await quota.putCached('b', { value: 2 });
  await quota.putCached('c', { value: 3 });
  assert.equal(await quota.getCached('a'), null);
  const cached = await quota.getCached('c');
  cached.value = 99;
  assert.deepEqual(await quota.getCached('c'), { value: 3 });
});

test('repeated CAS conflicts fail closed', async () => {
  const store = { async read() { return { value: null, etag: 'same' }; }, async compareAndSwap() { return false; } };
  const quota = createQuotaManager({ store, keyIds: ['key-1'], maxRetries: 2 });
  await assert.rejects(quota.reserve(1), QuotaStoreError);
});

test('existing malformed ledgers fail closed without CAS or provider access', async () => {
  const corruptions = [
    undefined,
    {},
    { ...validLedger(), version: 2 },
    { version: 2, cursor: 0, keys: validLedger().keys, cache: {} },
    { ...validLedger(), cursor: -1 },
    { ...validLedger(), cursor: '0' },
    { ...validLedger(), keys: [] },
    { ...validLedger(), keys: {} },
    { ...validLedger(), keys: { 'key-1': { disabled: false, cooldownUntil: 0 } } },
    { ...validLedger(), keys: { 'key-1': { disabled: 'false', cooldownUntil: 0, days: {} } } },
    { ...validLedger(), keys: { 'key-1': { disabled: false, cooldownUntil: -1, days: {} } } },
    { ...validLedger(), keys: { 'key-1': { disabled: false, cooldownUntil: 0, days: [] } } },
    { ...validLedger(), keys: { 'key-1': { disabled: false, cooldownUntil: 0, days: { yesterday: { used: 22, holds: {} } } } } },
    { ...validLedger(), keys: { 'key-1': { disabled: false, cooldownUntil: 0, days: { '2026-10-06': { used: '22', holds: {} } } } } },
    { ...validLedger(), keys: { 'key-1': { disabled: false, cooldownUntil: 0, days: { '2026-10-06': { used: 22, holds: [] } } } } },
    { ...validLedger(), keys: { 'key-1': { disabled: false, cooldownUntil: 0, days: { '2026-10-06': { used: 22, holds: { 'hold-1': 0 } } } } } },
    { ...validLedger(), keys: { 'key-1': { disabled: false, cooldownUntil: 0, days: { '2026-10-06': { used: Number.MAX_SAFE_INTEGER, holds: { 'hold-1': 1 } } } } } },
    { ...validLedger(), cache: null },
    { ...validLedger(), clients: null },
    { ...validLedger(), clients: [] },
    { ...validLedger(), clients: { 'bad client': { minute: [], days: {}, touchedAt: 0 } } },
    { ...validLedger(), clients: { client: { minute: 'now', days: {}, touchedAt: 0 } } },
    { ...validLedger(), clients: { client: { minute: [-1], days: {}, touchedAt: 0 } } },
    { ...validLedger(), clients: { client: { minute: [], days: { yesterday: 1 }, touchedAt: 0 } } },
    { ...validLedger(), clients: { client: { minute: [], days: { '2026-10-06': '1' }, touchedAt: 0 } } },
    { ...validLedger(), clients: { client: { minute: [], days: {}, touchedAt: -1 } } }
  ];

  for (const value of corruptions) {
    let casCalls = 0;
    let providerCalls = 0;
    const store = {
      async read() { return { value, etag: 'existing' }; },
      async compareAndSwap() { casCalls += 1; return true; }
    };
    const service = createAiMeaningService({
      keys: [{ id: 'key-1', key: 'test-secret' }], store,
      fetchImpl: async () => { providerCalls += 1; throw new Error('must not run'); },
      now: () => new Date('2026-10-06T12:00:00Z')
    });
    await assert.rejects(service.getMeaning({ term: 'test' }), error => error.code === 'ai_unavailable');
    assert.equal(providerCalls, 0);
    assert.equal(casCalls, 0);
  }
});

test('valid ledgers preserve removed keys, old counters, and outstanding holds', async () => {
  const initial = validLedger();
  initial.keys['retired-key'] = {
    disabled: true,
    cooldownUntil: 0,
    days: { '2025-01-01': { used: 999_000, holds: { 'old-hold': 900 } } }
  };
  const store = memoryStore(initial);
  const quota = createQuotaManager({
    store, keyIds: ['key-1'], dailyLimit: 1_000_000,
    now: () => new Date('2026-10-06T12:00:00Z')
  });
  await quota.seedUsage('key-1', 7);
  const stored = store.snapshot();
  assert.deepEqual(stored.keys['retired-key'], initial.keys['retired-key']);
  assert.equal(stored.keys['key-1'].days['2026-10-06'].used, 29);
  assert.equal(stored.keys['key-1'].days['2026-10-06'].holds['hold-1'], 30);
});

test('an existing ledger cannot silently initialize a newly configured or deleted key', async () => {
  const store = memoryStore(validLedger());
  const quota = createQuotaManager({ store, keyIds: ['key-1', 'key-2'] });
  await assert.rejects(quota.reserve(1), QuotaStoreError);
  assert.deepEqual(store.snapshot(), validLedger());
  assert.equal(store.casCalls(), 0);
});

test('malformed store snapshots fail before CAS', async () => {
  for (const snapshot of [null, {}, { value: null }, { value: null, etag: 3 }]) {
    let casCalls = 0;
    const quota = createQuotaManager({
      store: {
        async read() { return snapshot; },
        async compareAndSwap() { casCalls += 1; return true; }
      },
      keyIds: ['key-1']
    });
    await assert.rejects(quota.reserve(1), QuotaStoreError);
    assert.equal(casCalls, 0);
  }
});

test('admitRequest migrates a valid legacy ledger and preserves quota state', async () => {
  const initial = validLedger();
  const store = memoryStore(initial);
  const quota = createQuotaManager({
    store, keyIds: ['key-1'], now: () => new Date('2026-10-06T12:00:00Z')
  });
  assert.equal(await quota.admitRequest('client-a1'), true);
  const stored = store.snapshot();
  assert.deepEqual(stored.keys, initial.keys);
  assert.deepEqual(stored.clients['client-a1'], {
    minute: [new Date('2026-10-06T12:00:00Z').getTime()],
    days: { '2026-10-06': 1 },
    touchedAt: new Date('2026-10-06T12:00:00Z').getTime()
  });
});

test('admitRequest enforces the rolling minute limit without writing rejected requests', async () => {
  let instant = new Date('2026-10-06T12:00:00Z');
  const store = memoryStore();
  const quota = createQuotaManager({
    store, keyIds: ['key-1'], requestMinuteLimit: 3, now: () => instant
  });
  assert.equal(await quota.admitRequest('client-a1'), true);
  assert.equal(await quota.admitRequest('client-a1'), true);
  assert.equal(await quota.admitRequest('client-a1'), true);
  const beforeReject = store.casCalls();
  await assert.rejects(quota.admitRequest('client-a1'), error => error instanceof QuotaUnavailableError && error.code === 'rate_limit');
  assert.equal(store.casCalls(), beforeReject);
  instant = new Date('2026-10-06T12:01:00.001Z');
  assert.equal(await quota.admitRequest('client-a1'), true);
});

test('admitRequest enforces the per-client daily limit', async () => {
  let instant = new Date('2026-10-06T12:00:00Z');
  const store = memoryStore();
  const quota = createQuotaManager({
    store, keyIds: ['key-1'], requestMinuteLimit: 1, requestDailyLimit: 3, now: () => instant
  });
  for (let index = 0; index < 3; index += 1) {
    assert.equal(await quota.admitRequest('client-a1'), true);
    instant = new Date(instant.getTime() + 60_001);
  }
  await assert.rejects(quota.admitRequest('client-a1'), error => error.code === 'rate_limit');
  instant = new Date('2026-10-07T04:00:01Z');
  assert.equal(await quota.admitRequest('client-a1'), true);
});

test('concurrent admission cannot exceed the rolling limit across CAS retries', async () => {
  const quota = createQuotaManager({
    store: memoryStore(), keyIds: ['key-1'], maxRetries: 64,
    now: () => new Date('2026-10-06T12:00:00Z')
  });
  const results = await Promise.allSettled(Array.from({ length: 31 }, () => quota.admitRequest('client-a1')));
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 30);
  assert.equal(results.filter(result => result.status === 'rejected' && result.reason?.code === 'rate_limit').length, 1);
});

test('client storage remains bounded and only expired clients are pruned', async () => {
  let instant = new Date('2026-10-06T12:00:00Z');
  const store = memoryStore();
  const quota = createQuotaManager({ store, keyIds: ['key-1'], clientLimit: 2, now: () => instant });
  await quota.admitRequest('client-a1');
  await quota.admitRequest('client-b2');
  await assert.rejects(quota.admitRequest('client-c3'), error => error.code === 'rate_limit');
  assert.deepEqual(Object.keys(store.snapshot().clients).sort(), ['client-a1', 'client-b2']);
  instant = new Date('2026-10-07T12:00:00Z');
  assert.equal(await quota.admitRequest('client-c3'), true);
  assert.deepEqual(Object.keys(store.snapshot().clients), ['client-c3']);
});
