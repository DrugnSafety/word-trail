import assert from 'node:assert/strict';
import test from 'node:test';

import { createAiMeaningLookup, createEnglishDictionary, createKoreanGlossLookup, lemmatizeEnglish } from '../public/lib/lexicon.js';

function aiPackage(term = 'goal', overrides = {}) {
  return {
    source: 'openai', model: 'gpt-5.4', term,
    definitionEn: 'An aim.', meaningKo: '목표', exampleEn: 'She reached her goal.', exampleKo: '그녀는 목표를 달성했어요.',
    familyNoteKo: '명사 어형과 뜻이 가까운 말을 함께 살펴봐요.',
    meanings: [{ partOfSpeech: 'noun', definitions: [{ definition: 'An aim.', example: 'She reached her goal.' }] }],
    relatedWords: [{ term: 'goals', partOfSpeech: 'noun', relationship: 'inflection', labelKo: '복수형', meaningKo: '여러 목표', exampleEn: 'We set two goals.', exampleKo: '우리는 목표 두 개를 세웠어요.' }],
    ...overrides
  };
}

test('lemmatization resolves requested forms while protecting ambiguous words', () => {
  assert.equal(lemmatizeEnglish('goals'), 'goal');
  assert.equal(lemmatizeEnglish('EXCITED'), 'excite');
  assert.equal(lemmatizeEnglish('went'), 'go');
  assert.equal(lemmatizeEnglish('stories'), 'story');
  assert.equal(lemmatizeEnglish('boxes'), 'box');
  for (const term of ['axes', 'us', 'news', 'this', 'physics']) {
    assert.equal(lemmatizeEnglish(term), term);
  }
  assert.equal(lemmatizeEnglish('take turns'), 'take turns');
  assert.equal(lemmatizeEnglish('always'), 'always');
  assert.equal(lemmatizeEnglish('various'), 'various');
  assert.equal(lemmatizeEnglish('delicious'), 'delicious');
  assert.equal(lemmatizeEnglish('means'), 'mean');
  assert.equal(lemmatizeEnglish('studied'), 'study');
  assert.equal(lemmatizeEnglish('stopped'), 'stop');
  assert.equal(lemmatizeEnglish('helped'), 'help');
  assert.equal(lemmatizeEnglish('liked'), 'like');
  assert.equal(lemmatizeEnglish('smiled'), 'smile');
  assert.equal(lemmatizeEnglish('using'), 'use');
  assert.equal(lemmatizeEnglish('dancing'), 'dance');
  assert.equal(lemmatizeEnglish('invented'), 'invented', 'unknown bases stay unchanged');
});

test('curated word-family forms take precedence over suffix rules', () => {
  const families = [
    { id: 'phone', terms: ['phone', 'phones', 'phoning'] },
    { id: 'help', terms: ['help', 'helped', 'helpful'] },
    { id: 'quick', terms: ['quick', 'quickly'] }
  ];
  assert.equal(lemmatizeEnglish('phones', families), 'phone');
  assert.equal(lemmatizeEnglish('phoning', families), 'phone');
  assert.equal(lemmatizeEnglish('helped', families), 'help');
  assert.equal(lemmatizeEnglish('helpful', families), 'helpful');
  assert.equal(lemmatizeEnglish('quickly', families), 'quickly');
});

test('dictionary lookup sanitizes payload and caches successful results', async () => {
  let calls = 0;
  const dictionary = createEnglishDictionary({
    fetchImpl: async (url) => {
      calls += 1;
      assert.match(url, /entries\/en\/goal$/);
      return new Response(JSON.stringify([{
        phonetic: '/ɡoʊl/',
        meanings: [{ partOfSpeech: 'noun', definitions: [
          { definition: 'An aim or desired result.', example: 'Her goal is to read.' },
          { definition: 'An aim or desired result.' }
        ] }]
      }]), { status: 200, headers: { 'content-type': 'application/json' } });
    }
  });
  const first = await dictionary.lookup('goal');
  const second = await dictionary.lookup('goal');
  assert.equal(calls, 1);
  assert.equal(first, second);
  assert.deepEqual(first, {
    source: 'dictionaryapi', term: 'goal', phonetic: '/ɡoʊl/',
    definitionEn: 'An aim or desired result.',
    meanings: [{ partOfSpeech: 'noun', definitions: [
      { definition: 'An aim or desired result.', example: 'Her goal is to read.' }
    ] }]
  });
});

test('Korean fallback translates the English definition and caches labelled output', async () => {
  let calls = 0;
  const lookup = createKoreanGlossLookup({ fetchImpl: async url => {
    calls += 1;
    const parsed = new URL(url);
    assert.equal(parsed.searchParams.get('q'), 'An aim or desired result.');
    assert.equal(parsed.searchParams.get('langpair'), 'en|ko');
    return new Response(JSON.stringify({
      responseStatus: 200, quotaFinished: false,
      responseData: { translatedText: '목표로 삼거나 원하는 결과.' }
    }), { status: 200 });
  } });
  const first = await lookup('goal', { definitionEn: 'An aim or desired result.' });
  const second = await lookup('goal', { definitionEn: 'An aim or desired result.' });
  assert.equal(calls, 1);
  assert.deepEqual(first, {
    meaningKo: '목표로 삼거나 원하는 결과.', source: 'mymemory-translation',
    translatedFrom: 'definition', labelKo: '자동 번역'
  });
  assert.equal(second, first);
});

test('Korean fallback retries transient errors instead of caching a false missing result', async () => {
  let calls = 0;
  const lookup = createKoreanGlossLookup({ fetchImpl: async () => {
    calls += 1;
    if (calls === 1) throw new Error('offline');
    return new Response(JSON.stringify({
      responseStatus: 200, quotaFinished: false, responseData: { translatedText: '목표' }
    }), { status: 200 });
  } });
  await assert.rejects(lookup('goal', { definitionEn: 'An aim.' }), /offline/);
  assert.equal((await lookup('goal', { definitionEn: 'An aim.' })).meaningKo, '목표');
  assert.equal(calls, 2);
});

test('Korean fallback rejects quota payloads as retryable service failures', async () => {
  let calls = 0;
  const lookup = createKoreanGlossLookup({ fetchImpl: async () => {
    calls += 1;
    return new Response(JSON.stringify({
      responseStatus: 200, quotaFinished: true,
      responseData: { translatedText: 'MYMEMORY WARNING: YOU USED ALL AVAILABLE FREE TRANSLATIONS' }
    }), { status: 200 });
  } });
  await assert.rejects(lookup('goal', { definitionEn: 'An aim.' }), /temporarily unavailable/);
  await assert.rejects(lookup('goal', { definitionEn: 'An aim.' }), /temporarily unavailable/);
  assert.equal(calls, 2);
});

test('Korean fallback caches only a confirmed empty translation', async () => {
  let calls = 0;
  const lookup = createKoreanGlossLookup({ fetchImpl: async () => {
    calls += 1;
    return new Response(JSON.stringify({
      responseStatus: 200, quotaFinished: false, responseData: { translatedText: 'An aim.' }
    }), { status: 200 });
  } });
  assert.equal(await lookup('goal', { definitionEn: 'An aim.' }), null);
  assert.equal(await lookup('goal', { definitionEn: 'An aim.' }), null);
  assert.equal(calls, 1);
});

test('Korean fallback propagates caller cancellation without caching it', async () => {
  let calls = 0;
  const lookup = createKoreanGlossLookup({ fetchImpl: async (_url, { signal }) => {
    calls += 1;
    await new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
  } });
  const controller = new AbortController();
  const pending = lookup('goal', { definitionEn: 'An aim.', signal: controller.signal });
  controller.abort(new DOMException('cancelled', 'AbortError'));
  await assert.rejects(pending, error => error.name === 'AbortError');
  assert.equal(calls, 1);
});

test('dictionary caches confirmed missing words but retries transient failures', async () => {
  let calls = 0;
  const dictionary = createEnglishDictionary({
    fetchImpl: async () => {
      calls += 1;
      if (calls === 1) return new Response('', { status: 503 });
      return new Response('', { status: 404 });
    }
  });
  await assert.rejects(dictionary.lookup('unfindable'), /503/);
  assert.equal(await dictionary.lookup('unfindable'), null);
  assert.equal(await dictionary.lookup('unfindable'), null);
  assert.equal(calls, 2);
});

test('dictionary forwards cancellation and does not poison the cache', async () => {
  let calls = 0;
  const dictionary = createEnglishDictionary({
    timeoutMs: 1000,
    fetchImpl: async (_url, { signal }) => {
      calls += 1;
      if (calls === 2) return new Response('[]', { status: 200 });
      await new Promise((resolve, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason), { once: true });
      });
    }
  });
  const controller = new AbortController();
  const pending = dictionary.lookup('goal', { signal: controller.signal });
  controller.abort(new DOMException('cancelled', 'AbortError'));
  await assert.rejects(pending, error => error.name === 'AbortError');
  assert.equal(await dictionary.lookup('goal'), null);
  assert.equal(calls, 2);
});

test('AI meaning lookup posts a normalized term and caches only a valid success', async () => {
  let calls = 0;
  const lookup = createAiMeaningLookup({ fetchImpl: async (url, options) => {
    calls += 1;
    assert.equal(url, '/api/meaning');
    assert.equal(options.method, 'POST');
    assert.deepEqual(JSON.parse(options.body), { term: 'once upon a time' });
    return new Response(JSON.stringify(aiPackage('once upon a time', {
      definitionEn: 'A phrase used to begin a story.', meaningKo: '옛날 옛적에',
      exampleEn: 'Once upon a time, a fox lived here.', exampleKo: '옛날 옛적에 여우 한 마리가 이곳에 살았어요.',
      familyNoteKo: '이야기를 시작할 때 쓰는 관련 표현을 함께 살펴봐요.',
      meanings: [{ partOfSpeech: 'phrase', definitions: [{ definition: 'A phrase used to begin a story.', example: 'Once upon a time, a fox lived here.' }] }],
      relatedWords: [{ term: 'long ago', partOfSpeech: 'phrase', relationship: 'related', labelKo: '관련 표현', meaningKo: '오래전에', exampleEn: 'Long ago, people lived here.', exampleKo: '오래전에 사람들이 이곳에 살았어요.' }]
    })), { status: 200 });
  } });
  const first = await lookup(' Once   Upon a Time ');
  assert.equal((await lookup('once upon a time')), first);
  assert.equal(calls, 1);
  assert.equal(first.meaningKo, '옛날 옛적에');
  assert.equal(first.source, 'openai');
});

test('AI meaning lookup retries missing, failed, and invalid responses', async () => {
  const responses = [
    new Response('', { status: 404 }),
    new Response('', { status: 503 }),
    new Response(JSON.stringify({ source: 'openai', model: 'gpt-5.4', term: 'goal' }), { status: 200 }),
    new Response(JSON.stringify(aiPackage()), { status: 200 })
  ];
  let calls = 0;
  const lookup = createAiMeaningLookup({ fetchImpl: async () => responses[calls++] });
  assert.equal(await lookup('goal'), null);
  await assert.rejects(lookup('goal'), /503/);
  await assert.rejects(lookup('goal'), /invalid/);
  assert.equal((await lookup('goal')).meaningKo, '목표');
  assert.equal(calls, 4);
});

test('AI meaning lookup rejects a late response after caller cancellation', async () => {
  let release;
  const lookup = createAiMeaningLookup({ fetchImpl: async () => {
    await new Promise(resolve => { release = resolve; });
    return new Response(JSON.stringify(aiPackage()), { status: 200 });
  } });
  const controller = new AbortController();
  const pending = lookup('goal', { signal: controller.signal });
  await new Promise(resolve => setImmediate(resolve));
  controller.abort(new DOMException('cancelled', 'AbortError'));
  release();
  await assert.rejects(pending, error => error.name === 'AbortError');
});
