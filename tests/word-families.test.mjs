import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { findWordFamily } from '../public/lib/word-families.js';

const root = new URL('../', import.meta.url);
const sourceUrl = new URL('content/word-families.json', root);
const publicUrl = new URL('public/data/word-families.json', root);

async function loadFamilies() {
  return JSON.parse(await readFile(sourceUrl, 'utf8'));
}

test('word-family packages have a safe, complete rendering schema', async () => {
  const families = await loadFamilies();
  assert.ok(families.length >= 35 && families.length <= 45, `${families.length} packages`);

  const ids = new Set();
  const aliases = new Set();
  for (const family of families) {
    assert.deepEqual(
      Object.keys(family).sort(),
      ['id', 'items', 'noteKo', 'terms', 'titleKo'],
      family.id
    );
    assert.match(family.id, /^[a-z][a-z0-9-]*$/);
    assert.ok(!ids.has(family.id), `duplicate id: ${family.id}`);
    ids.add(family.id);
    assert.ok(family.titleKo.trim().length > 0, `${family.id}:titleKo`);
    assert.ok(family.noteKo.trim().length > 0, `${family.id}:noteKo`);
    assert.ok(family.terms.length > 0, `${family.id}:terms`);
    assert.ok(family.items.length >= 2, `${family.id}:items`);

    for (const term of family.terms) {
      const normalized = term.normalize('NFKC').toLocaleLowerCase('en-US').trim().replace(/\s+/g, ' ');
      assert.ok(normalized.length > 0, `${family.id}:empty alias`);
      assert.ok(!aliases.has(normalized), `duplicate alias: ${normalized}`);
      aliases.add(normalized);
    }

    for (const item of family.items) {
      assert.deepEqual(
        Object.keys(item).sort(),
        ['exampleEn', 'exampleKo', 'labelKo', 'meaningKo', 'term'],
        `${family.id}:${item.term}`
      );
      for (const field of ['term', 'labelKo', 'meaningKo', 'exampleEn', 'exampleKo']) {
        assert.equal(typeof item[field], 'string', `${family.id}:${item.term}:${field}`);
        assert.ok(item[field].trim().length > 0, `${family.id}:${item.term}:${field}`);
        assert.doesNotMatch(item[field], /[<>]/, `${family.id}:${item.term}:${field}`);
      }
      assert.match(item.exampleEn, /[.!?]$/, `${family.id}:${item.term}: English example punctuation`);
      assert.match(item.exampleKo, /[.!?요다자]\.?'?$/, `${family.id}:${item.term}: Korean example ending`);
    }
  }
});

test('curated packages cover the requested Faceytalk learning targets', async () => {
  const families = await loadFamilies();
  const requested = [
    'play', 'help', 'helpful', 'talk', 'talking', 'share', 'draw', 'stop', 'listen', 'wait',
    'read', 'write', 'go', 'come', 'turn', 'want', 'take', 'know', 'be', 'have',
    'happy', 'quick', 'quickly', 'slow', 'quiet', 'polite', 'family', 'mum', 'friend',
    'please', 'hogging', 'phone'
  ];
  for (const term of requested) {
    assert.ok(findWordFamily(term, families), `missing package alias: ${term}`);
  }
});

test('progressive teaching entries use a complete be plus ing phrase', async () => {
  const families = await loadFamilies();
  const progressives = families.flatMap(family => (
    family.items.filter(item => item.labelKo === '현재진행형(구문)')
  ));
  assert.ok(progressives.length >= 20, `${progressives.length} progressive examples`);
  for (const item of progressives) {
    assert.match(item.term, /^(?:am|is|are)\s+\S+ing(?:\s|$)/i, item.term);
  }

  assert.equal(
    families.find(family => family.id === 'want').items.some(item => item.labelKo === '현재진행형(구문)'),
    false,
    'stative want should not be forced into a beginner progressive example'
  );
  assert.equal(
    families.find(family => family.id === 'know').items.some(item => item.labelKo === '현재진행형(구문)'),
    false,
    'stative know should not be forced into a beginner progressive example'
  );
  assert.equal(
    families.find(family => family.id === 'mum').items.some(item => /동사|부사/.test(item.labelKo)),
    false,
    'mum should not receive invented verb or adverb forms'
  );
});

test('findWordFamily normalizes case, apostrophes, whitespace, aliases, and exact phrases', async () => {
  const families = await loadFamilies();
  assert.equal(findWordFamily('  TALKING ', families)?.id, 'talk');
  assert.equal(findWordFamily('Mum’s', families)?.id, 'mum');
  assert.equal(findWordFamily('  take   turns ', families)?.id, 'turn');
  assert.equal(findWordFamily('is playing', families)?.id, 'play');
  assert.equal(findWordFamily('quickly', families)?.id, 'quick');
  assert.equal(findWordFamily('not-curated', families), null);
  assert.equal(findWordFamily('', families), null);
  assert.equal(findWordFamily('play', null), null);
});

test('published word-family data is byte-identical to its source', async () => {
  const [source, published] = await Promise.all([
    readFile(sourceUrl),
    readFile(publicUrl)
  ]);
  assert.deepEqual(published, source);
});
