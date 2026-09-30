import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { isWordTrailRunning, startServer, serverErrorMessage } from '../scripts/serve.mjs';

class FakeServer extends EventEmitter {
  constructor(error = null) { super(); this.error = error; }
  listen(port, host) {
    this.bound = { port, host };
    queueMicrotask(() => this.emit(this.error ? 'error' : 'listening', this.error));
  }
}

test('starting the local app waits for a loopback listener and preserves the localhost origin', async () => {
  const server = new FakeServer();
  const result = await startServer({ port: 4173, server, checkExisting: () => assert.fail('unexpected probe') });
  assert.deepEqual(server.bound, { port: 4173, host: '127.0.0.1' });
  assert.equal(result.url, 'http://localhost:4173');
  assert.equal(result.reused, false);
  assert.equal(result.server, server);
});

test('launching twice reuses a verified Word Trail without choosing a new port or stopping a process', async () => {
  const server = new FakeServer(Object.assign(new Error('busy'), { code: 'EADDRINUSE' }));
  const probes = [];
  const result = await startServer({ port: 4173, server, checkExisting: async port => { probes.push(port); return true; } });
  assert.deepEqual(probes, [4173]);
  assert.equal(result.url, 'http://localhost:4173');
  assert.equal(result.reused, true);
  assert.equal(result.server, null);
});

test('an unrelated service occupying the port is not treated as a running Word Trail', async () => {
  const error = Object.assign(new Error('busy'), { code: 'EADDRINUSE' });
  await assert.rejects(startServer({ port: 4173, server: new FakeServer(error), checkExisting: async () => false }), error);
  assert.match(serverErrorMessage(error, 4173), /4173.*사용 중/);
});

test('permission errors and invalid ports are handled without probing another service', async () => {
  const error = Object.assign(new Error('restricted'), { code: 'EPERM' });
  await assert.rejects(startServer({ port: 4173, server: new FakeServer(error), checkExisting: () => assert.fail('unexpected probe') }), error);
  assert.match(serverErrorMessage(error, 4173), /권한/);
  for (const port of [0, -1, 65536, NaN, 1.5]) {
    const server = new FakeServer();
    await assert.rejects(startServer({ port, server }), /포트/);
    assert.equal(server.bound, undefined);
  }
});

function probeResponse({ status = 200, body = '', failure = null } = {}) {
  const request = new EventEmitter();
  request.destroy = () => { request.destroyed = true; };
  const get = (options, callback) => {
    request.options = options;
    queueMicrotask(() => {
      if (failure) { request.emit(failure, new Error('unavailable')); return; }
      const response = new EventEmitter();
      response.statusCode = status;
      response.resume = () => {};
      callback(response);
      response.emit('data', Buffer.from(body));
      response.emit('end');
    });
    return request;
  };
  return { get, request };
}

test('existing-app probe recognizes the current HTML, including an older running server', async () => {
  const body = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
  const { get, request } = probeResponse({ body });
  assert.equal(await isWordTrailRunning(4173, { get }), true);
  assert.equal(request.options.hostname, '127.0.0.1');
  assert.equal(request.options.port, 4173);
  assert.ok(request.options.timeout > 0 && request.options.timeout <= 2000);
});

test('existing-app probe rejects different HTML, error responses, timeouts, and connection errors', async () => {
  for (const options of [{ body: '<title>Another app</title>' }, { status: 404 }, { failure: 'timeout' }, { failure: 'error' }]) {
    const { get, request } = probeResponse(options);
    assert.equal(await isWordTrailRunning(4173, { get }), false);
    if (options.failure === 'timeout') assert.equal(request.destroyed, true);
  }
});

test('existing-app probe stops reading a response larger than the expected page', async () => {
  const { get, request } = probeResponse({ body: 'x'.repeat(1024 * 1024) });
  assert.equal(await isWordTrailRunning(4173, { get }), false);
  assert.equal(request.destroyed, true);
});

test('existing-app probe has a deadline even if a service never finishes its response', async () => {
  const request = new EventEmitter();
  request.destroy = () => { request.destroyed = true; };
  assert.equal(await isWordTrailRunning(4173, { get: () => request }), false);
  assert.equal(request.destroyed, true);
});

test('CLI rejects invalid ports with a readable error instead of an unhandled stack trace', () => {
  const result = spawnSync(process.execPath, [fileURLToPath(new URL('../scripts/serve.mjs', import.meta.url))], {
    env: { ...process.env, PORT: 'not-a-port' }, encoding: 'utf8'
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /포트/);
  assert.doesNotMatch(result.stderr, /Unhandled|node:events|\n\s+at /);
});
