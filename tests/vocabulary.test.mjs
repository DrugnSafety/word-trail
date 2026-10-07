import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeWord,
  wordCandidates,
  phraseCandidates,
  makePhraseCandidate,
  makePhraseFromIndexes,
  commitSelection,
  selectedWords,
  registerPractice,
  wordKnowledge,
  resolveWordKnowledge,
  canonicalizeVocabularyRecord
} from '../public/lib/vocabulary.js';
import { compareSentence, makeDictationRecord } from '../public/lib/dictation.js';
import { createStore } from '../public/lib/store.js';

function aiPackage(term = 'goal', overrides = {}) {
  return {
    source: 'openai', model: 'gpt-5.4', term,
    definitionEn: 'An aim.', meaningKo: '목표', exampleEn: 'She reached her goal.', exampleKo: '그녀는 목표를 달성했어요.',
    familyNoteKo: '명사 어형과 관련어를 함께 살펴봐요.',
    meanings: [{ partOfSpeech: 'noun', definitions: [{ definition: 'An aim.', example: 'She reached her goal.' }] }],
    relatedWords: [{ term: 'goals', partOfSpeech: 'noun', relationship: 'inflection', labelKo: '복수형', meaningKo: '여러 목표', exampleEn: 'We set two goals.', exampleKo: '우리는 목표 두 개를 세웠어요.' }],
    ...overrides
  };
}

test('custom phrase selection preserves source order and repeated word positions', () => {
  const phrase = makePhraseFromIndexes('go home go home now', [3, 2, 2]);
  assert.equal(phrase.term, 'go home');
  assert.deepEqual(phrase.sourceIndexes, [2, 3]);
  assert.throws(() => makePhraseFromIndexes('go home now', [0, 2]), /이어진 단어/);
  assert.throws(() => makePhraseFromIndexes('go. Home now', [0, 1]), /문장 부호/);
  assert.throws(() => makePhraseFromIndexes('go home', [1]), /두 개 이상/);
  assert.throws(() => makePhraseFromIndexes('go home', [-1, 0]), /단어 위치/);
});

test('candidates deduplicate canonical source terms and collect occurrence indexes', () => {
  const comparison = compareSentence('Mum can help Mum', 'Mom can help');
  const candidates = wordCandidates('Mum can help Mum', comparison);
  assert.deepEqual(candidates.map(word => [word.key, word.sourceIndexes, word.selected]), [
    ['word:mum', [0, 3], true],
    ['word:can', [1], false],
    ['word:help', [2], false]
  ]);
  assert.equal(candidates[0].currentMistake, true);
  assert.equal(normalizeWord('  MUM  '), 'mum');
});

test('candidates study lemmas while preserving original source spelling and positions', () => {
  const candidates = wordCandidates('Goals excite us. She felt excited by goals.');
  assert.deepEqual(candidates.map(word => [word.key, word.term, word.sourceTerm, word.sourceIndexes]), [
    ['word:goal', 'goal', 'Goals', [0, 7]],
    ['word:excite', 'excite', 'excite', [1, 5]],
    ['word:us', 'us', 'us', [2]],
    ['word:she', 'She', 'She', [3]],
    ['word:feel', 'feel', 'felt', [4]],
    ['word:by', 'by', 'by', [6]]
  ]);
});

test('lemma selection persists canonical study term and original cloze surface', () => {
  const record = makeDictationRecord({
    videoId: 'video-01', sceneId: 'c0001', contentVersion: '1',
    reference: 'Our goals changed because we felt excited.', answer: 'Our goals changed because we felt excited.'
  });
  const saved = commitSelection(record, ['word:goal', 'word:excite'], '2026-10-06T10:00:00Z');
  assert.deepEqual(saved.selectedKeys, ['word:goal', 'word:excite']);
  assert.deepEqual(selectedWords(saved).map(word => ({
    term: word.term, sourceTerm: word.sourceTerm, sourceIndexes: word.sourceIndexes
  })), [
    { term: 'goal', sourceTerm: 'goals', sourceIndexes: [1] },
    { term: 'excite', sourceTerm: 'excited', sourceIndexes: [6] }
  ]);
});

test('legacy inflected history merges into the lemma without losing completed reading progress', () => {
  const previous = {
    reference: 'Goals help us.',
    selectedKeys: ['word:goals', 'word:goal'],
    words: [
      {
        key: 'word:goals', term: 'Goals', kind: 'manual', typed: '', sourceIndex: 0,
        sourceIndexes: [0], studied: true, studyAttempts: 4, lastAnswer: 'independent', selected: true,
        registeredAt: '2026-09-20T10:00:00.000Z', meaningKo: '목표',
        lastPracticedAt: '2026-09-25T10:00:00.000Z',
        practice: { reading: { attempts: 4, correct: 3, lastPracticedAt: '2026-09-25T10:00:00.000Z' } },
        review: { step: 3, dueAt: '2026-10-09T10:00:00.000Z', lastReviewedDate: '2026-09-25' }
      },
      {
        key: 'word:goal', term: 'goal', sourceTerm: 'goal', kind: 'manual', typed: '', sourceIndex: 4,
        sourceIndexes: [4], studied: false, studyAttempts: 1, lastAnswer: '', selected: true,
        registeredAt: '2026-09-22T10:00:00.000Z',
        practice: { spelling: { attempts: 1, correct: 1, lastPracticedAt: '2026-09-22T10:00:00.000Z' } }
      }
    ]
  };
  const migrated = canonicalizeVocabularyRecord(previous);
  assert.deepEqual(migrated.selectedKeys, ['word:goal']);
  assert.equal(migrated.words.length, 1);
  assert.equal(migrated.words[0].term, 'goal');
  assert.equal(migrated.words[0].studyAttempts, 5);
  assert.equal(migrated.words[0].practice.reading.attempts, 4);
  assert.equal(migrated.words[0].practice.spelling.correct, 1);
  assert.equal(migrated.words[0].review.step, 3);
  assert.equal(migrated.words[0].meaningKo, '목표');
  assert.equal(migrated.words[0].registeredAt, '2026-09-20T10:00:00.000Z');
  assert.deepEqual(migrated.words[0].sourceIndexes, [0, 4]);
});

test('extras never become vocabulary candidates or default selections', () => {
  const comparison = compareSentence('Mum can help', 'Mum can really help today');
  const candidates = wordCandidates('Mum can help', comparison);
  assert.equal(candidates.some(word => ['really', 'today'].includes(normalizeWord(word.term))), false);
  assert.deepEqual(candidates.filter(word => word.selected), []);
});

test('expression candidates find repeated and overlapping contiguous phrase spans', () => {
  const candidates = phraseCandidates('Go go go, then THANK you. Thank you!', [
    { id: 'go-go', term: 'go go', meaningKo: '가자 가자' },
    { id: 'go-go-go', term: 'go go go', meaningKo: '계속 가자' },
    { id: 'thank-you', term: 'thank you', meaningKo: '고마워요' }
  ]);
  assert.deepEqual(candidates.map(candidate => [candidate.key, candidate.sourceIndex, candidate.sourceIndexes]), [
    ['word:go go go', 0, [0, 1, 2]],
    ['word:go go', 0, [0, 1]],
    ['word:thank you', 4, [4, 5, 6, 7]]
  ]);
  assert.deepEqual(candidates[1].occurrenceSpans, [[0, 1]]);
  assert.deepEqual(candidates[2].occurrenceSpans, [[4, 5], [6, 7]]);
  assert.equal(candidates[2].term, 'THANK you');
  assert.equal(candidates[2].label, '고마워요');
});

test('phrase matching normalizes Unicode apostrophes but never crosses sentence punctuation', () => {
  const expressions = [
    { id: 'dont-go', term: "don't go", aliases: ["don’t go"] },
    { id: 'hello-there', term: 'hello there', aliases: [] }
  ];
  const candidates = phraseCandidates('DON’T go. Hello! There 안녕 친구', expressions);
  assert.deepEqual(candidates.map(candidate => candidate.key), ["word:don't go"]);
  assert.equal(candidates[0].term, "DON'T go");

  assert.throws(() => makePhraseCandidate('Hello. There', 0, 1), /문장 부호/);
  assert.throws(() => makePhraseCandidate('one two', 0, 0), /두 개 이상/);
  assert.throws(() => makePhraseCandidate('one two', 1, 2), /이어진 단어 위치/);
  assert.deepEqual(makePhraseCandidate('안녕 친구야, 같이 가자', 0, 1).sourceIndexes, [0, 1]);
});

test('phrase selection persists only validated source-backed candidates', () => {
  const record = makeDictationRecord({
    videoId: 'video-01', sceneId: 'c0001', contentVersion: '1',
    reference: 'Thank you, and thank you again.', answer: 'Thank you, and thank you again.'
  });
  const [phrase] = phraseCandidates(record.reference, [{ id: 'thank-you', term: 'thank you', meaningKo: '고마워요' }]);
  const fake = { ...phrase, key: 'word:you and', term: 'you and', sourceIndex: 1, sourceIndexes: [1, 4] };
  const saved = commitSelection(record, [phrase.key, fake.key], '2026-09-25T10:00:00Z', [phrase, fake]);
  assert.deepEqual(saved.selectedKeys, ['word:thank you']);
  assert.deepEqual(selectedWords(saved).map(word => [word.term, word.sourceIndexes]), [
    ['Thank you', [0, 1, 3, 4]]
  ]);
  assert.equal(saved.words[0].registeredAt, '2026-09-25T10:00:00.000Z');
  assert.equal(saved.words[0].kind, 'manual');
  assert.equal('expressionId' in saved.words[0], false);
  assert.equal('label' in saved.words[0], false);
  assert.equal('occurrenceSpans' in saved.words[0], false);
});

test('persisted phrase records satisfy the existing guest-store contract', async () => {
  const values = new Map();
  const storage = {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: key => values.delete(key)
  };
  const auth = { storage, config: {}, getSession: async () => null };
  const store = createStore(auth);
  const record = makeDictationRecord({
    videoId: 'video-01', sceneId: 'c0001', contentVersion: '1',
    reference: 'Thank you very much.', answer: 'Thank you very much.'
  });
  const phrase = makePhraseCandidate(record.reference, 0, 1);
  const committed = commitSelection(record, [phrase.key], '2026-09-25T10:00:00Z', [phrase]);
  const saved = await store.saveDictation(committed);
  assert.deepEqual(saved.selectedKeys, ['word:thank you']);
  assert.deepEqual(saved.words[0].sourceIndexes, [0, 1]);
});

test('commit registers only explicit selection and keeps first registration time', () => {
  const attempt = makeDictationRecord({
    videoId: 'video-01', sceneId: 'c0001', contentVersion: '1',
    reference: 'Mum can help Mum', answer: 'Mom can help'
  });
  const first = commitSelection(attempt, ['word:mum', 'word:can'], '2026-09-25T10:00:00Z');
  assert.deepEqual(first.selectedKeys, ['word:mum', 'word:can']);
  assert.deepEqual(selectedWords(first).map(word => word.term), ['Mum', 'can']);
  assert.equal(first.words[0].registeredAt, '2026-09-25T10:00:00.000Z');
  assert.equal(first.words[0].kind, 'replace');
  assert.equal(first.words[0].typed, 'Mom');
  assert.deepEqual(first.words[0].sourceIndexes, [0, 3]);

  const second = commitSelection(first, ['word:mum'], '2026-09-26T10:00:00Z');
  assert.equal(second.words.find(word => word.key === 'word:mum').registeredAt, '2026-09-25T10:00:00.000Z');
  assert.ok(second.words.some(word => word.key === 'word:can'));
  assert.deepEqual(selectedWords(second).map(word => word.key), ['word:mum']);
});

test('correct retry clears defaults but registered history remains available', () => {
  const wrong = makeDictationRecord({
    videoId: 'video-01', sceneId: 'c0001', contentVersion: '1', reference: 'Mum can help', answer: 'Mom can help'
  });
  const committed = commitSelection(wrong, wrong.selectedKeys, '2026-09-25T10:00:00Z');
  const correct = makeDictationRecord({
    videoId: 'video-01', sceneId: 'c0001', contentVersion: '1', reference: 'Mum can help',
    answer: 'Mum can help', previous: committed
  });
  assert.deepEqual(correct.selectedKeys, []);
  assert.equal(correct.words[0].registeredAt, '2026-09-25T10:00:00.000Z');
});

test('practice tracks each mode independently and reading updates delayed review only', () => {
  const base = {
    key: 'word:mum', term: 'Mum', kind: 'manual', typed: '', sourceIndex: 0,
    studied: false, studyAttempts: 0, lastAnswer: ''
  };
  const spelling = registerPractice(base, 'spelling', 'mum', true, '2026-09-25T12:00:00Z');
  assert.deepEqual(spelling.practice.spelling, {
    attempts: 1, correct: 1, lastPracticedAt: '2026-09-25T12:00:00.000Z'
  });
  assert.equal(spelling.review, undefined);
  const reading = registerPractice(spelling, 'reading', 'independent', true, '2026-09-25T13:00:00Z');
  assert.equal(reading.studyAttempts, 2);
  assert.equal(reading.practice.reading.correct, 1);
  assert.equal(reading.review.dueAt, '2026-09-26T13:00:00.000Z');
  const helped = registerPractice(reading, 'reading', 'helped', false, '2026-09-26T14:00:00Z');
  assert.equal(helped.practice.reading.attempts, 2);
  assert.equal(helped.practice.reading.correct, 1);
  assert.equal(helped.review.step, 0);

  const incorrect = registerPractice(base, 'audio', 'mom', false, '2026-09-25T12:00:00Z');
  assert.equal(incorrect.studied, false);
  assert.equal(incorrect.practice.audio.attempts, 1);
});

test('knowledge uses parent meaning, then exact editorial content, then offline lexicon', () => {
  const expressions = [{
    term: 'Mum', ipa: '/mʌm/', meaningKo: '엄마', explanationKo: '가족 호칭', dialogues: [{ titleKo: '대화' }]
  }];
  const lexicon = [{ term: 'help', ipa: '/help/', meaningKo: '돕다', explanationKo: '도움을 주다' }];
  assert.equal(wordKnowledge({ term: 'Mum', meaningKo: '우리 엄마' }, expressions, []).source, 'parent');
  assert.equal(wordKnowledge({ term: 'mum' }, expressions, []).dialogues.length, 1);
  assert.deepEqual(wordKnowledge({ term: 'help' }, [], lexicon), {
    source: 'offline', term: 'help', ipa: '/help/', meaningKo: '돕다', explanationKo: '도움을 주다', dialogues: []
  });
  assert.equal(wordKnowledge({ term: 'unknown' }, [], []).source, 'missing');
});

test('knowledge resolves an expression alias without overriding an exact expression', () => {
  const expressions = [
    { term: 'do not go', aliases: ["don't go"], meaningKo: '가지 마' },
    { term: "don't go", aliases: [], meaningKo: '정확한 표현' }
  ];
  assert.equal(wordKnowledge({ term: "DON’T GO" }, expressions, []).meaningKo, '정확한 표현');
  assert.equal(wordKnowledge({ term: 'cannot wait' }, [
    { term: "can't wait", aliases: ['cannot wait'], meaningKo: '정말 기대돼' }
  ], []).meaningKo, '정말 기대돼');
});

test('knowledge enrichment presents English definition and retains Korean fallback', async () => {
  const dictionary = { lookup: async term => ({
    term, phonetic: '/ɡoʊl/', definitionEn: 'An aim or desired result.',
    meanings: [{ partOfSpeech: 'noun', definitions: [{ definition: 'An aim or desired result.', example: '' }] }]
  }) };
  const result = await resolveWordKnowledge(
    { term: 'goal' }, [], [{ term: 'goal', meaningKo: '목표', explanationKo: '이루고 싶은 것' }], { dictionary }
  );
  assert.equal(result.definitionEn, 'An aim or desired result.');
  assert.equal(result.meaningKo, '목표');
  assert.equal(result.ipa, '/ɡoʊl/');
  assert.equal(result.englishStatus, 'ready');
  assert.equal(result.koreanStatus, 'ready');
});

test('knowledge enrichment handles remote failure and supports a Korean provider fallback', async () => {
  const unavailable = await resolveWordKnowledge({ term: 'goal' }, [], [], {
    dictionary: { lookup: async () => { throw new Error('offline'); } },
    lookupKorean: async () => ({ meaningKo: '목표' })
  });
  assert.equal(unavailable.definitionEn, '');
  assert.equal(unavailable.englishStatus, 'unavailable');
  assert.equal(unavailable.meaningKo, '목표');
  assert.equal(unavailable.koreanStatus, 'ready');
});

test('knowledge enrichment uses GPT-5.4 for a phrase and its Korean meaning before translation', async () => {
  let translations = 0;
  const result = await resolveWordKnowledge({ term: 'Once upon a time' }, [], [], {
    dictionary: { lookup: async () => null },
    lookupAiMeaning: async term => aiPackage(term, {
      definitionEn: 'A phrase used to begin a story.', meaningKo: '옛날 옛적에',
      exampleEn: 'Once upon a time, a fox lived here.', exampleKo: '옛날 옛적에 여우 한 마리가 이곳에 살았어요.',
      familyNoteKo: '이야기 시작 표현을 함께 살펴봐요.',
      meanings: [{ partOfSpeech: 'phrase', definitions: [{ definition: 'A phrase used to begin a story.', example: 'Once upon a time, a fox lived here.' }] }],
      relatedWords: [{ term: 'long ago', partOfSpeech: 'phrase', relationship: 'related', labelKo: '관련 표현', meaningKo: '오래전에', exampleEn: 'Long ago, people lived here.', exampleKo: '오래전에 사람들이 이곳에 살았어요.' }]
    }),
    lookupKorean: async () => { translations += 1; return { meaningKo: '번역' }; }
  });
  assert.equal(result.definitionEn, 'A phrase used to begin a story.');
  assert.equal(result.meaningKo, '옛날 옛적에');
  assert.equal(result.englishSource, 'openai');
  assert.equal(result.englishModel, 'gpt-5.4');
  assert.equal(result.koreanSource, 'openai');
  assert.equal(result.koreanLabelKo, '');
  assert.equal(result.exampleKo, '옛날 옛적에 여우 한 마리가 이곳에 살았어요.');
  assert.equal(result.relatedWords[0].term, 'long ago');
  assert.equal(translations, 0);
});

test('knowledge enrichment requests one AI package first while preserving parent Korean wording', async () => {
  let aiCalls = 0;
  const result = await resolveWordKnowledge({ term: 'goal', meaningKo: '부모가 적은 목표' }, [], [], {
    dictionary: { lookup: async term => ({
      source: 'dictionaryapi', term, phonetic: '/ɡoʊl/', definitionEn: 'An aim.',
      meanings: [{ partOfSpeech: 'noun', definitions: [{ definition: 'An aim.', example: '' }] }]
    }) },
    lookupAiMeaning: async term => { aiCalls += 1; return aiPackage(term); }
  });
  assert.equal(aiCalls, 1);
  assert.equal(result.meaningKo, '부모가 적은 목표');
  assert.equal(result.koreanSource, 'parent');
  assert.equal(result.englishSource, 'openai');
  assert.equal(result.relatedWords[0].relationship, 'inflection');
});

test('knowledge enrichment retries through AI after dictionary missing and falls back to translation after AI failure', async () => {
  let aiCalls = 0;
  const result = await resolveWordKnowledge({ term: 'goal' }, [], [], {
    dictionary: { lookup: async () => null },
    lookupAiMeaning: async () => { aiCalls += 1; throw new Error('temporarily unavailable'); },
    lookupKorean: async () => ({ meaningKo: '목표', source: 'mymemory-translation' })
  });
  assert.equal(aiCalls, 1);
  assert.equal(result.englishStatus, 'unavailable');
  assert.equal(result.meaningKo, '목표');
  assert.equal(result.koreanSource, 'mymemory-translation');
});

test('knowledge enrichment does not return a late provider result after cancellation', async () => {
  let release;
  const controller = new AbortController();
  const pending = resolveWordKnowledge({ term: 'goal' }, [], [], {
    dictionary: { lookup: async () => null },
    lookupAiMeaning: async () => new Promise(resolve => { release = () => resolve(aiPackage()); })
  }, { signal: controller.signal });
  await new Promise(resolve => setImmediate(resolve));
  controller.abort();
  release();
  await assert.rejects(pending, error => error.name === 'AbortError');
});
