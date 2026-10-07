import test from 'node:test';
import assert from 'node:assert/strict';

import { AiMeaningError, createAiMeaningService } from '../server/ai-service.mjs';

function memoryStore() {
  let value = null;
  let version = 0;
  return {
    async read() { return { value: structuredClone(value), etag: String(version) }; },
    async compareAndSwap(next, etag) {
      await Promise.resolve();
      if (etag !== String(version)) return false;
      value = structuredClone(next);
      version += 1;
      return true;
    }
  };
}

function success(term = 'Once upon a time', totalTokens = 22) {
  return new Response(JSON.stringify({
    output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify({
      definitionEn: `A phrase used to begin a story about ${term}.`,
      meaningKo: '옛날 옛적에',
      partOfSpeech: 'phrase',
      exampleEn: 'Once upon a time, a rabbit lived here.',
      exampleKo: '옛날 옛적에 토끼 한 마리가 이곳에 살았어요.',
      familyNoteKo: '정해진 어형 변화가 없는 이야기 시작 표현이에요.',
      relatedWords: [
        {
          term: 'long ago', partOfSpeech: 'adverb phrase', relationship: 'related',
          labelKo: '관련 표현', meaningKo: '오래전에',
          exampleEn: 'Long ago, people traveled on foot.', exampleKo: '오래전에 사람들은 걸어서 이동했어요.'
        },
        {
          term: 'happily ever after', partOfSpeech: 'phrase', relationship: 'related',
          labelKo: '이야기 관련 표현', meaningKo: '그 뒤로 오래오래 행복하게',
          exampleEn: 'They lived happily ever after.', exampleKo: '그들은 그 뒤로 오래오래 행복하게 살았어요.'
        }
      ]
    }) }] }],
    usage: { total_tokens: totalTokens }
  }), { status: 200, headers: { 'content-type': 'application/json' } });
}

function makeService(fetchImpl, options = {}) {
  return createAiMeaningService({
    keys: [{ id: 'key-1', key: 'secret-one' }, { id: 'key-2', key: 'secret-two' }],
    store: memoryStore(), fetchImpl, requestTimeoutMs: 25, now: () => new Date('2026-10-06T12:00:00Z'),
    ...options
  });
}

test('uses GPT-5.4 Responses structured output without storage or tools', async () => {
  let request;
  const service = makeService(async (url, init) => { request = { url, init }; return success(); });
  const result = await service.getMeaning({ term: 'Once upon a time', context: 'Once upon a time, there was a bear.' });
  const body = JSON.parse(request.init.body);
  assert.equal(request.url, 'https://api.openai.com/v1/responses');
  assert.equal(body.model, 'gpt-5.4');
  assert.equal(body.store, false);
  assert.deepEqual(body.reasoning, { effort: 'none' });
  assert.deepEqual(body.tools, []);
  assert.equal(body.text.format.type, 'json_schema');
  assert.equal(body.text.format.strict, true);
  assert.deepEqual(body.text.format.schema.required, [
    'definitionEn', 'meaningKo', 'partOfSpeech', 'exampleEn', 'exampleKo', 'familyNoteKo', 'relatedWords'
  ]);
  assert.equal(body.text.format.schema.properties.relatedWords.minItems, 1);
  assert.equal(body.text.format.schema.properties.relatedWords.maxItems, 8);
  assert.equal(result.source, 'openai');
  assert.equal(result.model, 'gpt-5.4');
  assert.equal(result.meaningKo, '옛날 옛적에');
  assert.equal(result.exampleEn, 'Once upon a time, a rabbit lived here.');
  assert.equal(result.exampleKo, '옛날 옛적에 토끼 한 마리가 이곳에 살았어요.');
  assert.equal(result.familyNoteKo, '정해진 어형 변화가 없는 이야기 시작 표현이에요.');
  assert.equal(result.relatedWords.length, 2);
  assert.deepEqual(result.relatedWords[0], {
    term: 'long ago', partOfSpeech: 'adverb phrase', relationship: 'related',
    labelKo: '관련 표현', meaningKo: '오래전에',
    exampleEn: 'Long ago, people traveled on foot.', exampleKo: '오래전에 사람들은 걸어서 이동했어요.'
  });
  assert.deepEqual(result.meanings[0].definitions[0], {
    definition: 'A phrase used to begin a story about Once upon a time.',
    example: 'Once upon a time, a rabbit lived here.'
  });
});

test('returns genuine inflections, derivations, and semantic relations as one knowledge package', async () => {
  const dragon = new Response(JSON.stringify({
    output_text: JSON.stringify({
      definitionEn: 'A large imaginary creature often shown with wings and fire.',
      meaningKo: '용, 날개가 있고 불을 뿜는 것으로 묘사되는 상상의 동물',
      partOfSpeech: 'noun',
      exampleEn: 'A dragon guarded the treasure.',
      exampleKo: '용 한 마리가 보물을 지켰어요.',
      familyNoteKo: '명사 dragon의 복수형과 실제 파생 형용사, 의미 관련어를 함께 익혀요.',
      relatedWords: [
        {
          term: 'dragons', partOfSpeech: 'plural noun', relationship: 'inflection',
          labelKo: '복수형', meaningKo: '용들',
          exampleEn: 'The story has two dragons.', exampleKo: '그 이야기에는 용 두 마리가 나와요.'
        },
        {
          term: 'draconic', partOfSpeech: 'adjective', relationship: 'derivation',
          labelKo: '파생 형용사', meaningKo: '용의, 용을 닮은',
          exampleEn: 'The gate had a draconic design.', exampleKo: '그 문에는 용을 닮은 무늬가 있었어요.'
        },
        {
          term: 'mythical creature', partOfSpeech: 'noun phrase', relationship: 'related',
          labelKo: '의미 관련어', meaningKo: '신화 속 생물',
          exampleEn: 'A dragon is a mythical creature.', exampleKo: '용은 신화 속 생물이에요.'
        }
      ]
    }),
    usage: { total_tokens: 70 }
  }), { status: 200 });
  const service = makeService(async () => dragon);
  const result = await service.getMeaning({ term: 'dragon' });
  assert.deepEqual(result.relatedWords.map(({ term, relationship }) => ({ term, relationship })), [
    { term: 'dragons', relationship: 'inflection' },
    { term: 'draconic', relationship: 'derivation' },
    { term: 'mythical creature', relationship: 'related' }
  ]);
  assert.equal(result.meanings[0].partOfSpeech, 'noun');
  assert.equal(result.meanings[0].definitions[0].example, 'A dragon guarded the treasure.');
});

test('rejects duplicate or incomplete related-word entries', async () => {
  const base = {
    definitionEn: 'A story opening phrase.', meaningKo: '이야기를 시작하는 표현', partOfSpeech: 'phrase',
    exampleEn: 'Once upon a time, a fox lived here.', exampleKo: '옛날 옛적에 여우 한 마리가 이곳에 살았어요.',
    familyNoteKo: '정해진 어형 변화가 없는 표현이에요.'
  };
  const duplicate = {
    term: 'long ago', partOfSpeech: 'adverb phrase', relationship: 'related', labelKo: '관련 표현',
    meaningKo: '오래전에', exampleEn: 'It happened long ago.', exampleKo: '그 일은 오래전에 일어났어요.'
  };
  const service = makeService(async () => new Response(JSON.stringify({
    output_text: JSON.stringify({ ...base, relatedWords: [duplicate, { ...duplicate, term: 'Long Ago' }] }),
    usage: { total_tokens: 40 }
  }), { status: 200 }));
  await assert.rejects(service.getMeaning({ term: 'once upon a time' }), error => error.code === 'invalid_ai_response');
});

test('rotates keys between uncached requests and records exact usage', async () => {
  const authorization = [];
  const service = makeService(async (_url, init) => { authorization.push(init.headers.authorization); return success(); });
  await service.getMeaning({ term: 'first' });
  await service.getMeaning({ term: 'second' });
  assert.deepEqual(authorization, ['Bearer secret-one', 'Bearer secret-two']);
  assert.deepEqual((await service.usageSummary()).keys.map(({ used }) => used), [22, 22]);
});

test('disables invalid credentials durably and retries another key', async () => {
  const authorization = [];
  const service = makeService(async (_url, init) => {
    authorization.push(init.headers.authorization);
    if (init.headers.authorization === 'Bearer secret-one') return new Response(JSON.stringify({ error: { message: 'invalid' } }), { status: 401 });
    return success();
  });
  await service.getMeaning({ term: 'first' });
  await service.getMeaning({ term: 'second' });
  assert.deepEqual(authorization, ['Bearer secret-one', 'Bearer secret-two', 'Bearer secret-two']);
  const summary = await service.usageSummary();
  assert.equal(summary.keys[0].disabled, true);
  assert.ok(summary.keys[0].reserved > 0);
});

test('429 applies a local cooldown and tries another key', async () => {
  const authorization = [];
  const service = makeService(async (_url, init) => {
    authorization.push(init.headers.authorization);
    if (init.headers.authorization === 'Bearer secret-one') return new Response('{}', { status: 429, headers: { 'retry-after': '60' } });
    return success();
  });
  await service.getMeaning({ term: 'first' });
  await service.getMeaning({ term: 'second' });
  assert.deepEqual(authorization, ['Bearer secret-one', 'Bearer secret-two', 'Bearer secret-two']);
});

test('persistent cache and process single-flight avoid duplicate provider calls', async () => {
  const store = memoryStore();
  let calls = 0;
  const fetchImpl = async () => { calls += 1; await new Promise(resolve => setTimeout(resolve, 5)); return success(); };
  const options = { keys: [{ id: 'key-1', key: 'secret' }], store, fetchImpl, now: () => new Date('2026-10-06T12:00:00Z') };
  const firstService = createAiMeaningService(options);
  const [left, right] = await Promise.all([
    firstService.getMeaning({ term: 'same phrase', context: 'same context' }),
    firstService.getMeaning({ term: 'same phrase', context: 'same context' })
  ]);
  const secondService = createAiMeaningService(options);
  const persisted = await secondService.getMeaning({ term: 'same phrase', context: 'same context' });
  assert.equal(calls, 1);
  assert.deepEqual(left, right);
  assert.deepEqual(left, persisted);
});

test('timeouts retain conservative holds and return only a safe error', async () => {
  const service = makeService((_url, init) => new Promise((_resolve, reject) => {
    init.signal.addEventListener('abort', () => reject(Object.assign(new Error('secret-one'), { name: 'AbortError' })));
  }), { requestTimeoutMs: 5 });
  await assert.rejects(service.getMeaning({ term: 'timeout' }), error => {
    assert.equal(error instanceof AiMeaningError, true);
    assert.equal(error.code, 'ai_timeout');
    assert.doesNotMatch(error.message, /secret|key-/i);
    return true;
  });
  const usage = (await service.usageSummary()).keys;
  assert.ok(usage[0].reserved > 0);
  assert.equal(usage[1].reserved, 0);
});

test('the request timeout also covers a stalled response body', async () => {
  const service = makeService(async (_url, init) => ({
    ok: true, status: 200, headers: new Headers(),
    json: () => new Promise((_resolve, reject) => {
      init.signal.addEventListener('abort', () => reject(Object.assign(new Error('stalled body'), { name: 'AbortError' })));
    })
  }), { requestTimeoutMs: 5 });
  await assert.rejects(service.getMeaning({ term: 'stalled body' }), error => error.code === 'ai_timeout');
  const usage = (await service.usageSummary()).keys;
  assert.ok(usage[0].reserved > 0);
  assert.equal(usage[1].reserved, 0);
});

test('malformed provider output is rejected after exact usage is settled', async () => {
  let calls = 0;
  const service = makeService(async () => { calls++; return new Response(JSON.stringify({ output_text: '{"definitionEn":""}', usage: { total_tokens: 9 } }), { status: 200 }); });
  await assert.rejects(service.getMeaning({ term: 'bad output' }), error => error.code === 'invalid_ai_response');
  assert.deepEqual((await service.usageSummary()).keys.map(({ used, reserved }) => ({ used, reserved })), [
    { used: 9, reserved: 0 }, { used: 0, reserved: 0 }
  ]);
  assert.equal(calls, 1);
});

test('provider failure stops after one call; known usage settles and unknown usage stays reserved', async () => {
  let calls = 0;
  const service = makeService(async () => {
    calls += 1;
    if (calls === 1) return new Response(JSON.stringify({ usage: { total_tokens: 13 } }), { status: 500 });
    return new Response('{}', { status: 500 });
  });
  await assert.rejects(service.getMeaning({ term: 'provider error' }), error => error.code === 'ai_unavailable');
  const [known, unknown] = (await service.usageSummary()).keys;
  assert.deepEqual({ used: known.used, reserved: known.reserved }, { used: 13, reserved: 0 });
  assert.equal(calls, 1);
  await assert.rejects(service.getMeaning({ term: 'another provider error' }), error => error.code === 'ai_unavailable');
  const unknownAfter = (await service.usageSummary()).keys[1];
  assert.equal(unknown.used, 0);
  assert.equal(unknown.reserved, 0);
  assert.ok(unknownAfter.reserved > 0);
});

test('input limits reject before network access', async () => {
  let calls = 0;
  const service = makeService(async () => { calls += 1; return success(); });
  await assert.rejects(service.getMeaning({ term: 'x'.repeat(161) }), error => error.code === 'invalid_input' && error.status === 400);
  await assert.rejects(service.getMeaning({ term: 'ok', context: 'x'.repeat(1001) }), error => error.code === 'invalid_input');
  assert.equal(calls, 0);
});

test('daily token budget stops provider access with a distinct safe code', async () => {
  let calls = 0;
  const service = createAiMeaningService({
    keys: [{ id: 'key-1', key: 'secret' }], store: memoryStore(),
    fetchImpl: async () => { calls += 1; return success('term', 60); },
    dailyLimit: 20_000, now: () => new Date('2026-10-06T12:00:00Z')
  });
  await service.seedUsage('key-1', 19_000);
  await assert.rejects(service.getMeaning({ term: 'budget limited' }), error => {
    assert.equal(error.code, 'daily_limit');
    assert.doesNotMatch(error.message, /key-1|secret/i);
    return true;
  });
  assert.equal(calls, 0);
});
