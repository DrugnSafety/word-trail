import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../', import.meta.url);
const sourceUrl = new URL('content/vocabulary.json', root);
const publicUrl = new URL('public/data/vocabulary.json', root);
const transcriptUrl = new URL('resource/Bluey_Season3_Scripts/txt_1_shadowing/01_Faceytalk.txt', root);
const WORD_PATTERN = /[\p{L}\p{M}\p{N}]+(?:[’'][\p{L}\p{M}\p{N}]+)*/gu;

function normalize(value) {
  return String(value ?? '').normalize('NFKC').replace(/[‘’ʼ]/g, "'").toLocaleLowerCase('en-US').trim();
}

async function loadJson(url) {
  return JSON.parse(await readFile(url, 'utf8'));
}

test('Faceytalk offline vocabulary is complete, unique, and safe to render as text', async () => {
  const vocabulary = await loadJson(sourceUrl);
  assert.equal(vocabulary.length, 271);

  const seen = new Set();
  for (const entry of vocabulary) {
    assert.deepEqual(Object.keys(entry).sort(), ['explanationKo', 'ipa', 'meaningKo', 'term']);
    for (const field of ['term', 'ipa', 'meaningKo', 'explanationKo']) {
      assert.equal(typeof entry[field], 'string');
      assert.ok(entry[field].trim().length > 0, `${entry.term || '(empty)'}:${field}`);
      assert.doesNotMatch(entry[field], /[<>]/, `${entry.term}:${field}`);
    }
    const term = normalize(entry.term);
    assert.ok(!seen.has(term), `duplicate vocabulary term: ${term}`);
    seen.add(term);
    assert.match(entry.ipa, /^\/.+\/$/, `${entry.term}:ipa`);
  }
});

test('offline vocabulary covers every normalized Faceytalk learning wordform', async () => {
  const [vocabulary, transcript] = await Promise.all([
    loadJson(sourceUrl),
    readFile(transcriptUrl, 'utf8')
  ]);
  const spoken = transcript
    .split('\n')
    .filter(line => line.startsWith('['))
    .map(line => line.replace(/^\[[^\]]+\]\s*/, ''))
    .join(' ');
  const sourceTerms = new Set((spoken.match(WORD_PATTERN) ?? []).map(normalize));
  const vocabularyTerms = new Set(vocabulary.map(entry => normalize(entry.term)));
  assert.deepEqual([...vocabularyTerms].sort(), [...sourceTerms].sort());
});

test('nonstandard child speech and fictional terms carry explicit learning cautions', async () => {
  const vocabulary = await loadJson(sourceUrl);
  const byTerm = new Map(vocabulary.map(entry => [normalize(entry.term), entry]));
  assert.match(byTerm.get('lended').explanationKo, /표준 과거형은 lent/);
  assert.match(byTerm.get('freee').explanationKo, /표준 철자는 free/);
  assert.match(byTerm.get('nooo').explanationKo, /표준 철자는 no/);
  for (const term of ['facey', 'faceytalk', 'gowilla', 'uss']) {
    assert.match(byTerm.get(term).explanationKo, /(일반|보통).*단어.*아니/);
  }
});

test('committed public vocabulary is an exact deterministic copy', async () => {
  const [source, published] = await Promise.all([loadJson(sourceUrl), loadJson(publicUrl)]);
  assert.deepEqual(published, source);
});
