import test from 'node:test';
import assert from 'node:assert/strict';
import { createMeaningHandler } from '../api/meaning.js';
import { createUsageHandler } from '../api/ai-usage.js';
import { requestClientId } from '../server/http.mjs';

function response() {
  return { headers: {}, setHeader(name, value) { this.headers[name] = value; }, end(body) { this.body = JSON.parse(body); } };
}
function request(overrides = {}) {
  return { method: 'POST', socket: { remoteAddress: '127.0.0.1' }, headers: { host: 'word-trail-three.vercel.app', origin: 'https://word-trail-three.vercel.app', 'content-type': 'application/json' }, body: { term: 'Once upon a time' }, ...overrides };
}

test('meaning endpoint validates method, origin and bounded JSON before any provider call', async () => {
  let calls = 0;
  const handler = createMeaningHandler(() => { calls++; throw new Error('must not call'); });
  for (const [req, status] of [
    [request({ method: 'GET' }), 405],
    [request({ headers: { host: 'word-trail-three.vercel.app', origin: 'https://evil.example' } }), 403],
    [request({ body: { term: '' } }), 400],
    [request({ body: { term: 'x'.repeat(161) } }), 400],
    [request({ body: { term: 'hello', context: 'x'.repeat(1001) } }), 400],
    [request({ body: { term: 'hello', context: [] } }), 400],
    [request({ body: { term: 12 } }), 400],
    [request({ body: '{' }), 400],
    [request({ body: { term: 'hello', extra: 'x'.repeat(4096) } }), 400],
  ]) {
    const res = response(); await handler(req, res);
    assert.equal(res.statusCode, status);
    assert.equal(res.headers['Cache-Control'], 'no-store');
  }
  assert.equal(calls, 0);
});

test('meaning endpoint returns normalized learning data and hides provider errors', async () => {
  const value = { source: 'openai', model: 'gpt-5.4', term: 'once upon a time', definitionEn: 'A phrase used to begin a story.', meaningKo: '옛날 옛적에' };
  const handler = createMeaningHandler(() => ({ quota: { async admitRequest(id) { assert.match(id, /^[a-f0-9]{64}$/); } }, service: { async getMeaning(input) { assert.equal(input.term, 'Once upon a time'); return value; } } }));
  const res = response(); await handler(request(), res);
  assert.equal(res.statusCode, 200); assert.deepEqual(res.body, value);
  const failure = response();
  await createMeaningHandler(() => { throw new Error('secret provider response'); })(request(), failure);
  assert.equal(failure.statusCode, 503);
  assert.deepEqual(failure.body, { error: 'temporarily_unavailable' });
  const limit = response();
  await createMeaningHandler(() => ({ quota: { async admitRequest() {} }, service: { async getMeaning() { throw Object.assign(new Error('private'), { code: 'daily_limit' }); } } }))(request(), limit);
  assert.equal(limit.statusCode, 429);
});

test('client identity uses trusted platform headers or local socket and limiter fails before generation', async () => {
  const local = requestClientId(request({ headers: { 'x-forwarded-for': '198.51.100.1' } }), { vercel: false });
  assert.equal(local, requestClientId(request(), { vercel: false }));
  assert.notEqual(local, requestClientId(request({ headers: { 'x-vercel-forwarded-for': '198.51.100.1' } }), { vercel: true }));
  assert.throws(() => requestClientId(request(), { vercel: true }), /untrusted/);
  assert.throws(() => requestClientId(request({ headers: { 'x-forwarded-for': '198.51.100.1, 198.51.100.2' } }), { vercel: true }), /untrusted/);
  let calls = 0;
  for (const code of ['rate_limit', 'quota_store_unavailable']) {
    const res = response();
    await createMeaningHandler(() => ({ quota: { async admitRequest() { throw Object.assign(new Error('private'), { code }); } }, service: { async getMeaning() { calls++; } } }))(request(), res);
    assert.equal(res.statusCode, code === 'rate_limit' ? 429 : 503);
  }
  const missing = response();
  await createMeaningHandler(() => { calls++; })(request({ socket: undefined }), missing);
  assert.equal(missing.statusCode, 503);
  assert.equal(calls, 0);
});

test('usage endpoint reads counters without invoking OpenAI and rejects cross-site requests', async () => {
  const value = { day: '2026-10-06', timezone: 'America/New_York', dailyLimit: 1_000_000, keys: [{ id: 'key-1', used: 22, reserved: 0, remaining: 999978, disabled: false }] };
  const handler = createUsageHandler(() => ({ quota: { async usageSummary() { return value; } } }));
  const res = response(); await handler(request({ method: 'GET' }), res);
  assert.deepEqual(res.body, value); assert.equal(res.statusCode, 200);
  const blocked = response(); await handler(request({ method: 'GET', headers: { 'sec-fetch-site': 'cross-site' } }), blocked);
  assert.equal(blocked.statusCode, 403);
});
