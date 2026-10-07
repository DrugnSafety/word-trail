import test from 'node:test';
import assert from 'node:assert/strict';
import { createHandwritingHandler } from '../api/handwriting.js';
import { createStudyGuideHandler } from '../api/study-guide.js';

function response() { return { headers: {}, setHeader(name, value) { this.headers[name] = value; }, end(value) { this.body = JSON.parse(value); } }; }
function request(body, overrides = {}) {
  return { method: 'POST', socket: { remoteAddress: '127.0.0.1' }, headers: { host: 'word-trail.example', origin: 'https://word-trail.example', 'content-type': 'application/json' }, body, ...overrides };
}

test('handwriting HTTP endpoint enforces same-site, 512KB body, shape and client admission', async () => {
  const image = `data:image/png;base64,${Buffer.from('ink').toString('base64')}`; let calls = 0;
  const handler = createHandwritingHandler(() => ({ quota: { async admitRequest(id) { assert.match(id, /^[a-f0-9]{64}$/); } }, studyService: { async recognizeHandwriting(input) { calls += 1; assert.equal(input.image, image); return { text: 'a', confidence: 'high', candidates: [] }; } } }));
  const ok = response(); await handler(request({ image, mode: 'letter' }), ok); assert.equal(ok.statusCode, 200); assert.equal(calls, 1);
  for (const req of [
    request({ image, mode: 'letter' }, { method: 'GET' }),
    request({ image, mode: 'letter' }, { headers: { host: 'word-trail.example', origin: 'https://evil.example', 'content-type': 'application/json' } }),
    request({ image, mode: 'letter', expected: 'a' }), request({ image, mode: 'phrase' }),
    request({ image: 'x'.repeat(512 * 1024), mode: 'word' })
  ]) { const res = response(); await handler(req, res); assert.notEqual(res.statusCode, 200); }
  assert.equal(calls, 1);
});

test('study guide HTTP endpoint validates input and sanitizes provider and quota errors', async () => {
  const value = { kind: 'word', text: 'rain' };
  const handler = createStudyGuideHandler(() => ({ quota: { async admitRequest() {} }, studyService: { async getStudyGuide(input) { assert.equal(input.text, 'rain'); return value; } } }));
  const ok = response(); await handler(request({ kind: 'word', text: 'rain' }), ok); assert.deepEqual(ok.body, value);
  for (const body of [{ kind: 'word', text: '' }, { kind: 'sentence', text: 'x'.repeat(501) }, { kind: 'word', text: 'rain', extra: true }]) {
    const res = response(); await handler(request(body), res); assert.equal(res.statusCode, 400);
  }
  const privateFailure = response();
  await createStudyGuideHandler(() => { throw new Error('secret provider message'); })(request({ kind: 'word', text: 'rain' }), privateFailure);
  assert.equal(privateFailure.statusCode, 503); assert.deepEqual(privateFailure.body, { error: 'temporarily_unavailable' });
  const limited = response();
  await createStudyGuideHandler(() => ({ quota: { async admitRequest() { throw Object.assign(new Error('private'), { code: 'rate_limit' }); } } }))(request({ kind: 'word', text: 'rain' }), limited);
  assert.equal(limited.statusCode, 429); assert.equal(limited.headers['Retry-After'], '60');
});
