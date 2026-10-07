import test from 'node:test';
import assert from 'node:assert/strict';
import { createStudyService, StudyServiceError } from '../server/study-service.mjs';
import { createAiMeaningService } from '../server/ai-service.mjs';

function memoryStore() {
  let value = null; let version = 0;
  return {
    async read() { return { value: structuredClone(value), etag: String(version) }; },
    async compareAndSwap(next, etag) {
      if (etag !== String(version)) return false;
      value = structuredClone(next); version += 1; return true;
    }
  };
}

function output(value, totalTokens = 30, status = 200) {
  return new Response(JSON.stringify({ output_text: JSON.stringify(value), usage: { total_tokens: totalTokens } }), { status });
}

const SMALL_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

function word(text = 'rain') {
  const segments = text === 'rain' ? [{ text: 'r', ipa: '/r/' }, { text: 'ai', ipa: '/eɪ/' }, { text: 'n', ipa: '/n/' }] : [{ text, ipa: '/test/' }];
  return { kind: 'word', text, ipa: '/reɪn/', syllables: [text], stressIndex: 0, segments, noteKo: '소리 묶음을 확인해요.' };
}

function sentence(text = "I can't wait to see you.") {
  return {
    kind: 'sentence', text, definitionEn: 'The speaker is very excited about meeting someone.', meaningKo: '너를 빨리 보고 싶어.',
    situationKo: '만남을 기대할 때 사용해요.', patternEn: "can't wait to + verb", patternKo: '어떤 일을 몹시 기대한다는 뜻이에요.',
    chunks: ["I can't wait ", 'to see you.'],
    examples: [{ text: "I can't wait to go.", meaningKo: '빨리 가고 싶어.' }, { text: "I can't wait to try it.", meaningKo: '빨리 해 보고 싶어.' }], topic: 'anticipation'
  };
}

function service(fetchImpl, options = {}) {
  return createStudyService({ keys: [{ id: 'key-1', key: 'secret-one' }, { id: 'key-2', key: 'secret-two' }], store: memoryStore(), fetchImpl,
    now: () => new Date('2026-10-07T12:00:00Z'), requestTimeoutMs: 25, ...options });
}

test('handwriting vision prompt reads actual ink without an expected answer and is never cached', async () => {
  const seen = []; let calls = 0;
  const study = service(async (_url, init) => {
    calls += 1; seen.push(JSON.parse(init.body));
    return output({ text: 'rain', confidence: 'high', candidates: ['ram'] }, 45);
  });
  const image = SMALL_PNG;
  const first = await study.recognizeHandwriting({ image, mode: 'word' });
  const second = await study.recognizeHandwriting({ image, mode: 'word' });
  assert.deepEqual(first, { text: 'rain', confidence: 'high', candidates: ['ram'] });
  assert.deepEqual(second, first); assert.equal(calls, 2);
  const serialized = JSON.stringify(seen[0]);
  assert.match(serialized, /actual ink/i);
  assert.deepEqual(seen[0].input[0].content.filter(item => item.type === 'input_text'), [{ type: 'input_text', text: 'Read the actual ink as a word.' }]);
  assert.equal(seen[0].input[0].content[1].image_url, image);
  assert.equal(seen[0].store, false); assert.equal(seen[0].tools.length, 0);
  assert.equal(seen[0].text.format.strict, true);
});

test('handwriting accepts a blank low-confidence result and rejects corrected or malformed output', async () => {
  const blank = service(async () => output({ text: '', confidence: 'low', candidates: [] }));
  const image = SMALL_PNG;
  assert.deepEqual(await blank.recognizeHandwriting({ image, mode: 'letter' }), { text: '', confidence: 'low', candidates: [] });
  const bad = service(async () => output({ text: 'hello!', confidence: 'high', candidates: [] }));
  await assert.rejects(bad.recognizeHandwriting({ image, mode: 'word' }), error => error instanceof StudyServiceError && error.code === 'invalid_ai_response');
  const extra = service(async () => output({ text: 'hello', confidence: 'high', candidates: [], corrected: true }));
  await assert.rejects(extra.recognizeHandwriting({ image, mode: 'word' }), error => error.code === 'invalid_ai_response');
});

test('handwriting validates mode, mime, base64 and decoded image size before provider access', async () => {
  let calls = 0; const study = service(async () => { calls += 1; return output({ text: 'a', confidence: 'high', candidates: [] }); });
  const oversizedDimensions = Buffer.alloc(24);
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(oversizedDimensions);
  oversizedDimensions.write('IHDR', 12, 'ascii'); oversizedDimensions.writeUInt32BE(4097, 16); oversizedDimensions.writeUInt32BE(20, 20);
  for (const input of [
    { image: 'data:image/gif;base64,AAAA', mode: 'word' },
    { image: 'data:image/png;base64,@@@', mode: 'word' },
    { image: `data:image/png;base64,${Buffer.from('not a png').toString('base64')}`, mode: 'word' },
    { image: `data:image/png;base64,${oversizedDimensions.toString('base64')}`, mode: 'word' },
    { image: `data:image/png;base64,${Buffer.alloc(350 * 1024 + 1).toString('base64')}`, mode: 'word' },
    { image: SMALL_PNG, mode: 'phrase' }
  ]) await assert.rejects(study.recognizeHandwriting(input), error => error.code === 'invalid_input' && error.status === 400);
  assert.equal(calls, 0);
});

test('word and sentence guides preserve source text and validate concatenated units', async () => {
  const study = service(async (_url, init) => {
    const body = JSON.parse(init.body); const supplied = JSON.parse(body.input);
    return output(body.text.format.name === 'word_study_guide' ? word(supplied.text) : sentence(supplied.text));
  });
  assert.deepEqual(await study.getStudyGuide({ kind: 'word', text: 'rain' }), word());
  assert.deepEqual(await study.getStudyGuide({ kind: 'sentence', text: "I can't wait to see you." }), sentence());
  const malformed = service(async () => output({ ...word(), segments: [{ text: 'rayn', ipa: '/reɪn/' }] }));
  await assert.rejects(malformed.getStudyGuide({ kind: 'word', text: 'rain' }), error => error.code === 'invalid_ai_response');
  const rewritten = service(async () => output({ ...sentence(), text: 'I am excited to see you.', chunks: ['I am excited to see you.'] }));
  await assert.rejects(rewritten.getStudyGuide({ kind: 'sentence', text: "I can't wait to see you." }), error => error.code === 'invalid_ai_response');
});

test('study cache is namespaced and persisted while uncached calls rotate shared key IDs', async () => {
  const store = memoryStore(); const auth = [];
  const options = { keys: [{ id: 'key-1', key: 'one' }, { id: 'key-2', key: 'two' }], store, now: () => new Date('2026-10-07T12:00:00Z'),
    fetchImpl: async (_url, init) => { auth.push(init.headers.authorization); const input = JSON.parse(JSON.parse(init.body).input); return output(word(input.text), 31); } };
  const first = createStudyService(options);
  await Promise.all([first.getStudyGuide({ kind: 'word', text: 'rain' }), first.getStudyGuide({ kind: 'word', text: 'rain' })]);
  await first.getStudyGuide({ kind: 'word', text: 'snow' });
  const second = createStudyService(options);
  assert.deepEqual(await second.getStudyGuide({ kind: 'word', text: 'rain' }), word('rain'));
  assert.deepEqual(auth, ['Bearer one', 'Bearer two']);
  assert.deepEqual((await second.usageSummary()).keys.map(item => item.used), [31, 31]);
});

test('meaning and study services share one durable key cursor and daily counters', async () => {
  const store = memoryStore(); const auth = [];
  const keys = [{ id: 'key-1', key: 'one' }, { id: 'key-2', key: 'two' }];
  const common = { keys, store, now: () => new Date('2026-10-07T12:00:00Z') };
  const meaning = createAiMeaningService({ ...common, fetchImpl: async (_url, init) => {
    auth.push(init.headers.authorization);
    return output({
      definitionEn: 'Water that falls from clouds.', meaningKo: '비', partOfSpeech: 'noun',
      exampleEn: 'The rain stopped.', exampleKo: '비가 그쳤어요.', familyNoteKo: '명사와 동사로 쓰여요.',
      relatedWords: [{ term: 'rainy', partOfSpeech: 'adjective', relationship: 'derivation', labelKo: '파생 형용사', meaningKo: '비가 오는', exampleEn: 'It is rainy today.', exampleKo: '오늘은 비가 와요.' }]
    }, 17);
  } });
  const study = createStudyService({ ...common, fetchImpl: async (_url, init) => { auth.push(init.headers.authorization); return output(word(), 31); } });
  await meaning.getMeaning({ term: 'rain' });
  await study.getStudyGuide({ kind: 'word', text: 'rain' });
  assert.deepEqual(auth, ['Bearer one', 'Bearer two']);
  assert.deepEqual((await study.usageSummary()).keys.map(item => item.used), [17, 31]);
});

test('unknown usage retains a conservative hold and daily budget failure is safe', async () => {
  const timed = service((_url, init) => new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => reject(Object.assign(new Error('private'), { name: 'AbortError' })))), { requestTimeoutMs: 5 });
  const image = SMALL_PNG;
  await assert.rejects(timed.recognizeHandwriting({ image, mode: 'word' }), error => error.code === 'ai_timeout' && !/secret/i.test(error.message));
  assert.equal((await timed.usageSummary()).keys[0].reserved, 32_768);

  const limited = service(async () => output({ text: 'a', confidence: 'high', candidates: [] }, 10), { dailyLimit: 32_768 });
  await limited.recognizeHandwriting({ image, mode: 'letter' });
  await limited.recognizeHandwriting({ image, mode: 'letter' });
  await assert.rejects(limited.recognizeHandwriting({ image, mode: 'letter' }), error => error.code === 'daily_limit');
});

test('explicit credential rejection clears its hold before disabling and rotating', async () => {
  const auth = [];
  const study = service(async (_url, init) => {
    auth.push(init.headers.authorization);
    if (init.headers.authorization === 'Bearer secret-one') return new Response('{}', { status: 401 });
    return output(word(), 20);
  });
  assert.deepEqual(await study.getStudyGuide({ kind: 'word', text: 'rain' }), word());
  assert.deepEqual(auth, ['Bearer secret-one', 'Bearer secret-two']);
  const [rejected, accepted] = (await study.usageSummary()).keys;
  assert.deepEqual({ used: rejected.used, reserved: rejected.reserved, disabled: rejected.disabled }, { used: 0, reserved: 0, disabled: true });
  assert.deepEqual({ used: accepted.used, reserved: accepted.reserved }, { used: 20, reserved: 0 });
});

test('explicit rate-limit rejections clear both holds while preserving cooldown rotation', async () => {
  const study = service(async () => new Response('{}', { status: 429, headers: { 'retry-after': '60' } }));
  await assert.rejects(study.getStudyGuide({ kind: 'word', text: 'rain' }), error => error.code === 'ai_busy');
  assert.deepEqual((await study.usageSummary()).keys.map(({ used, reserved, disabled }) => ({ used, reserved, disabled })), [
    { used: 0, reserved: 0, disabled: false }, { used: 0, reserved: 0, disabled: false }
  ]);
});

test('study input limits reject before provider access', async () => {
  let calls = 0; const study = service(async () => { calls += 1; return output(word()); });
  for (const input of [
    { kind: 'word', text: 'x'.repeat(161) }, { kind: 'word', text: 'rain!' },
    { kind: 'sentence', text: 'x'.repeat(501) }, { kind: 'sentence', text: 'Hello.', context: 'x'.repeat(1001) },
    { kind: 'paragraph', text: 'Hello.' }
  ]) await assert.rejects(study.getStudyGuide(input), error => error.code === 'invalid_input');
  assert.equal(calls, 0);
});
