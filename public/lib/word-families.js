function normalizeTerm(value) {
  return String(value ?? '')
    .normalize('NFKC')
    .replace(/[‘’ʼ]/g, "'")
    .toLocaleLowerCase('en-US')
    .trim()
    .replace(/\s+/g, ' ');
}

export function findWordFamily(term, families) {
  const target = normalizeTerm(term);
  if (!target || !Array.isArray(families)) return null;

  return families.find(family => (
    Array.isArray(family?.terms)
    && family.terms.some(candidate => normalizeTerm(candidate) === target)
  )) ?? null;
}

const IRREGULAR_VERBS = new Map(Object.entries({
  be: ['was/were', 'been', 'being'], buy: ['bought', 'bought', 'buying'],
  come: ['came', 'come', 'coming'], do: ['did', 'done', 'doing'],
  draw: ['drew', 'drawn', 'drawing'], get: ['got', 'gotten', 'getting'], give: ['gave', 'given', 'giving'],
  fly: ['flew', 'flown', 'flying'], go: ['went', 'gone', 'going'], have: ['had', 'had', 'having'],
  know: ['knew', 'known', 'knowing'], leave: ['left', 'left', 'leaving'],
  make: ['made', 'made', 'making'], read: ['read', 'read', 'reading'], run: ['ran', 'run', 'running'],
  say: ['said', 'said', 'saying'], see: ['saw', 'seen', 'seeing'], tell: ['told', 'told', 'telling'],
  take: ['took', 'taken', 'taking'], think: ['thought', 'thought', 'thinking'],
  write: ['wrote', 'written', 'writing']
}));
const DOUBLE_FINAL_VERBS = new Set(['chat', 'clap', 'drop', 'hop', 'nod', 'plan', 'rob', 'skip', 'stop', 'tap']);
const VERIFIED_REGULAR_VERBS = new Set([
  'ask', 'call', 'carry', 'change', 'clean', 'close', 'cook', 'dance', 'excite', 'finish',
  'help', 'jump', 'learn', 'like', 'listen', 'live', 'look', 'love', 'move', 'need', 'open',
  'paint', 'play', 'remember', 'share', 'start', 'study', 'talk', 'try', 'turn', 'use', 'wait',
  'walk', 'want', 'wash', 'watch', 'work'
]);
const VERIFIED_COUNT_NOUNS = new Map(Object.entries({
  book: 'books', child: 'children', friend: 'friends', game: 'games', goal: 'goals',
  jump: 'jumps', person: 'people', phone: 'phones', story: 'stories', word: 'words'
}));

function regularVerbForms(base) {
  if (IRREGULAR_VERBS.has(base)) return IRREGULAR_VERBS.get(base);
  if (!VERIFIED_REGULAR_VERBS.has(base)) return null;
  const consonantY = /[^aeiou]y$/.test(base);
  const doubleFinal = DOUBLE_FINAL_VERBS.has(base);
  const past = base.endsWith('e') ? `${base}d`
    : consonantY ? `${base.slice(0, -1)}ied`
      : doubleFinal ? `${base}${base.at(-1)}ed` : `${base}ed`;
  const progressive = base.endsWith('ie') ? `${base.slice(0, -2)}ying`
    : base.endsWith('e') && !base.endsWith('ee') ? `${base.slice(0, -1)}ing`
      : doubleFinal ? `${base}${base.at(-1)}ing` : `${base}ing`;
  return [past, past, progressive];
}

function pluralNoun(base) {
  return VERIFIED_COUNT_NOUNS.get(base) || '';
}

export function getWordFamilyReview(term, families, dictionaryEntry = null) {
  const relatedWords = Array.isArray(dictionaryEntry?.relatedWords) ? dictionaryEntry.relatedWords : [];
  if (relatedWords.length) {
    const base = normalizeTerm(dictionaryEntry?.term || term);
    return {
      id: base,
      terms: [base],
      titleKo: `${base} 어형·관련어 복습`,
      noteKo: String(dictionaryEntry?.familyNoteKo || '단어의 형태와 뜻 관계를 구분해서 살펴보세요.'),
      items: relatedWords,
      source: 'knowledge-package'
    };
  }
  const curated = findWordFamily(term, families);
  if (curated) return { ...curated, source: 'curated' };
  const base = normalizeTerm(dictionaryEntry?.term || term);
  if (!base || base.includes(' ')) return null;
  const parts = new Set((Array.isArray(dictionaryEntry?.meanings) ? dictionaryEntry.meanings : [])
    .map(meaning => normalizeTerm(meaning?.partOfSpeech)));
  const items = [];
  if (parts.has('verb')) {
    const forms = regularVerbForms(base);
    if (forms) {
      const [past, participle, progressive] = forms;
      items.push(
        { term: base, labelKo: '동사원형' },
        { term: past, labelKo: '과거형' },
        { term: participle, labelKo: '과거분사형' },
        { term: progressive, labelKo: '현재분사/진행형' }
      );
    }
  }
  const plural = parts.has('noun') ? pluralNoun(base) : '';
  if (plural) items.push({ term: plural, labelKo: '복수형' });
  const unique = items.filter((item, index, all) => all.findIndex(candidate => (
    candidate.term === item.term && candidate.labelKo === item.labelKo
  )) === index);
  if (!unique.length) return null;
  return {
    id: base,
    terms: [base],
    titleKo: `${base} 어형 복습`,
    noteKo: '사전 품사와 검증된 기본 어형만 표시합니다.',
    items: unique,
    source: 'inflection'
  };
}
