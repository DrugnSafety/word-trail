import test from 'node:test';
import assert from 'node:assert/strict';
import { createBlobLedgerStore } from '../server/blob-store.mjs';

const token = 'vercel_blob_rw_teststore_fake';
test('private ledger reads origin-fresh data and requires an ETag', async () => {
  const store = createBlobLedgerStore({ token, fetchImpl: async (url, options) => {
    assert.equal(new URL(url).searchParams.get('cache'), '0');
    assert.equal(new URL(url).host, 'teststore.private.blob.vercel-storage.com');
    assert.equal(options.cache, 'no-store');
    assert.equal(options.headers.Authorization, `Bearer ${token}`);
    assert.equal(options.headers['accept-encoding'], 'identity');
    return new Response('{"used":22}', { headers: { etag: '"v1"' } });
  } });
  assert.deepEqual(await store.read(), { value: { used: 22 }, etag: '"v1"' });
  const absent = createBlobLedgerStore({ token, fetchImpl: async () => new Response('', { status: 404 }) });
  assert.deepEqual(await absent.read(), { value: null, etag: null });
  const unversioned = createBlobLedgerStore({ token, fetchImpl: async () => new Response('{}') });
  await assert.rejects(() => unversioned.read(), /no version/);
  const weak = createBlobLedgerStore({ token, fetchImpl: async () => new Response('{}', { headers: { etag: 'W/"v1"' } }) });
  await assert.rejects(() => weak.read(), /no version/);
});

test('ledger uses create-only initialization and exact-version writes; conflicts cannot overwrite', async () => {
  const requests = [];
  const store = createBlobLedgerStore({ token, fetchImpl: async (url, options) => {
    requests.push(options);
    if (options.headers['x-if-match'] === '"stale"') return new Response('{}', { status: 412 });
    return Response.json({ pathname: 'word-trail/ai-ledger-v1.json', etag: '"v2"' });
  } });
  assert.equal(await store.compareAndSwap({ used: 22 }, null), true);
  assert.equal(requests[0].headers['x-allow-overwrite'], '0');
  assert.equal('x-if-match' in requests[0].headers, false);
  assert.equal(await store.compareAndSwap({ used: 23 }, '"v1"'), true);
  assert.equal(requests[1].headers['x-if-match'], '"v1"');
  assert.equal(requests[1].headers['x-allow-overwrite'], '1');
  assert.equal(await store.compareAndSwap({ used: 99 }, '"stale"'), false);
});

test('unavailable storage fails closed and errors never echo credentials or provider bodies', async () => {
  const store = createBlobLedgerStore({ token, fetchImpl: async () => Response.json({ error: { message: token } }, { status: 403 }) });
  await assert.rejects(() => store.read(), /could not be read/);
  await assert.rejects(() => store.compareAndSwap({}, '"v1"'), /could not be updated/);
  assert.throws(() => createBlobLedgerStore({ token: '' }), /not configured/);
});
