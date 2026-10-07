const DEFAULT_ENDPOINT = 'https://api.dictionaryapi.dev/api/v2/entries/en/';
const DEFAULT_AI_MEANING_ENDPOINT = '/api/meaning';

const FIXED_LEMMAS = new Map(Object.entries({
  am: 'be', are: 'be', is: 'be', was: 'be', were: 'be', been: 'be', being: 'be',
  has: 'have', had: 'have', having: 'have',
  does: 'do', did: 'do', done: 'do', doing: 'do',
  goes: 'go', went: 'go', gone: 'go', going: 'go',
  comes: 'come', came: 'come', coming: 'come',
  takes: 'take', took: 'take', taken: 'take', taking: 'take',
  makes: 'make', made: 'make', making: 'make',
  writes: 'write', wrote: 'write', written: 'write', writing: 'write',
  reads: 'read', reading: 'read',
  draws: 'draw', drew: 'draw', drawn: 'draw', drawing: 'draw',
  knows: 'know', knew: 'know', known: 'know', knowing: 'know',
  says: 'say', said: 'say', saying: 'say',
  gets: 'get', got: 'get', gotten: 'get', getting: 'get',
  sees: 'see', saw: 'see', seen: 'see', seeing: 'see',
  feels: 'feel', felt: 'feel', feeling: 'feel',
  thinks: 'think', thought: 'think', thinking: 'think',
  tells: 'tell', told: 'tell', telling: 'tell',
  finds: 'find', found: 'find', finding: 'find',
  gives: 'give', gave: 'give', given: 'give', giving: 'give',
  leaves: 'leave', left: 'leave', leaving: 'leave',
  children: 'child', people: 'person', men: 'man', women: 'woman', feet: 'foot', teeth: 'tooth',
  mice: 'mouse', geese: 'goose',
  excited: 'excite', exciting: 'excite', excites: 'excite', means: 'mean',
  dying: 'die', lying: 'lie', tying: 'tie'
}));

const UNINFLECTED = new Set([
  'afterwards', 'always', 'as', 'axes', 'bus', 'chess', 'class', 'clothes', 'gas', 'glass',
  'grass', 'his', 'is', 'news', 'octopus', 'perhaps', 'physics', 'series', 'species',
  'thanks', 'this', 'towards', 'us', 'various', 'yes'
]);

const ATTESTED_BASES = new Set([
  ...FIXED_LEMMAS.values(),
  'age', 'answer', 'ask', 'box', 'call', 'carry', 'change', 'child', 'clean', 'close',
  'come', 'cook', 'dance', 'dad', 'draw', 'excite', 'family', 'finish', 'friend', 'game',
  'goal', 'good', 'happy', 'help', 'hide', 'hog', 'jump', 'learn', 'like', 'listen', 'live',
  'look', 'love', 'make', 'mean', 'move', 'mum', 'need', 'open', 'paint', 'parent', 'person',
  'phone', 'play', 'please', 'polite', 'quick', 'quiet', 'read', 'remember', 'run', 'share',
  'silly', 'sister', 'slow', 'smile', 'start', 'stop', 'story', 'study', 'talk', 'take',
  'try', 'turn', 'use', 'wait', 'walk', 'want', 'wash', 'watch', 'word', 'work', 'write'
]);

function normalizedTerm(value) {
  return String(value ?? '').normalize('NFKC').replace(/[‘’ʼ]/g, "'")
    .toLocaleLowerCase('en-US').trim().replace(/\s+/g, ' ');
}

function inflectionCandidates(term) {
  const candidates = [];
  if (term.endsWith('ied') && term.length > 4) candidates.push(`${term.slice(0, -3)}y`);
  if (term.endsWith('ed') && term.length > 4) {
    candidates.push(term.slice(0, -1), term.slice(0, -2));
    const stem = term.slice(0, -2);
    if (/([b-df-hj-np-tv-z])\1$/.test(stem)) candidates.push(stem.slice(0, -1));
  }
  if (term.endsWith('ing') && term.length > 4) {
    const stem = term.slice(0, -3);
    candidates.push(`${stem}e`, stem);
    if (/([b-df-hj-np-tv-z])\1$/.test(stem)) candidates.push(stem.slice(0, -1));
  }
  if (term.endsWith('ies') && term.length > 4) candidates.push(`${term.slice(0, -3)}y`);
  if (term.endsWith('es') && term.length > 4) candidates.push(term.slice(0, -2), term.slice(0, -1));
  if (term.endsWith('s') && term.length > 3 && !/(?:ss|us|ous|ays|ics)$/.test(term)) {
    candidates.push(term.slice(0, -1));
  }
  return [...new Set(candidates.filter(Boolean))];
}

function familyLemma(term, families) {
  if (!Array.isArray(families)) return '';
  for (const family of families) {
    if (!Array.isArray(family?.terms) || !family.terms.some(form => normalizedTerm(form) === term)) continue;
    const id = normalizedTerm(family.id);
    if (!id || !/^[a-z]+(?:[-'][a-z]+)*$/.test(id)) continue;
    if (term === id || FIXED_LEMMAS.get(term) === id || inflectionCandidates(term).includes(id)) return id;
  }
  return '';
}

/** Resolve a single English surface form to a conservative study headword. */
export function lemmatizeEnglish(value, families = []) {
  const term = normalizedTerm(value);
  if (!term || term.includes(' ') || !/^[a-z]+(?:'[a-z]+)?$/.test(term)) return term;
  const curated = familyLemma(term, families);
  if (curated) return curated;
  if (FIXED_LEMMAS.has(term)) return FIXED_LEMMAS.get(term);
  if (UNINFLECTED.has(term) || term.length < 4) return term;
  const known = new Set(ATTESTED_BASES);
  for (const family of Array.isArray(families) ? families : []) {
    const id = normalizedTerm(family?.id);
    if (/^[a-z]+(?:[-'][a-z]+)*$/.test(id)) known.add(id);
  }
  const attested = inflectionCandidates(term).find(candidate => known.has(candidate));
  if (attested) return attested;
  return term;
}

function abortError(reason) {
  if (reason instanceof Error) return reason;
  return new DOMException('The operation was aborted.', 'AbortError');
}

function callerAbortError(reason) {
  if (reason?.name === 'AbortError') return reason;
  return new DOMException(reason?.message || 'The operation was aborted.', 'AbortError');
}

function linkedSignal(signal, timeoutMs) {
  const controller = new AbortController();
  let timer = null;
  const onAbort = () => controller.abort(signal.reason);
  if (signal?.aborted) controller.abort(signal.reason);
  else signal?.addEventListener('abort', onAbort, { once: true });
  if (Number.isFinite(timeoutMs) && timeoutMs > 0) {
    timer = setTimeout(() => controller.abort(new DOMException('Dictionary request timed out.', 'TimeoutError')), timeoutMs);
  }
  return {
    signal: controller.signal,
    dispose() {
      if (timer !== null) clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    }
  };
}

function cleanDictionaryEntries(term, payload) {
  const entries = Array.isArray(payload) ? payload : [];
  const meanings = [];
  const seen = new Set();
  for (const entry of entries) {
    for (const meaning of Array.isArray(entry?.meanings) ? entry.meanings : []) {
      const definitions = [];
      for (const item of Array.isArray(meaning?.definitions) ? meaning.definitions : []) {
        const definition = String(item?.definition ?? '').trim();
        if (!definition || seen.has(definition)) continue;
        seen.add(definition);
        definitions.push({ definition, example: String(item?.example ?? '').trim() });
        if (definitions.length >= 3) break;
      }
      if (definitions.length) meanings.push({
        partOfSpeech: String(meaning?.partOfSpeech ?? '').trim(), definitions
      });
      if (meanings.length >= 4) break;
    }
    if (meanings.length >= 4) break;
  }
  if (!meanings.length) return null;
  const phonetic = entries.flatMap(entry => Array.isArray(entry?.phonetics) ? entry.phonetics : [])
    .map(item => String(item?.text ?? '').trim()).find(Boolean)
    || entries.map(entry => String(entry?.phonetic ?? '').trim()).find(Boolean) || '';
  return {
    source: 'dictionaryapi', term, phonetic,
    definitionEn: meanings[0].definitions[0].definition,
    meanings
  };
}

function cleanAiMeaning(term, payload) {
  if (!payload || payload.source !== 'openai' || payload.model !== 'gpt-5.4'
      || normalizedTerm(payload.term) !== term) return null;
  const definitionEn = String(payload.definitionEn ?? '').trim();
  const meaningKo = String(payload.meaningKo ?? '').trim();
  const exampleEn = String(payload.exampleEn ?? '').trim();
  const exampleKo = String(payload.exampleKo ?? '').trim();
  const familyNoteKo = String(payload.familyNoteKo ?? '').trim();
  if (!definitionEn || !meaningKo || !/[\uac00-\ud7a3]/u.test(meaningKo)
      || !exampleEn || !exampleKo || !/[\uac00-\ud7a3]/u.test(exampleKo)
      || !familyNoteKo || !/[\uac00-\ud7a3]/u.test(familyNoteKo)
      || definitionEn.length > 1200 || meaningKo.length > 600 || exampleEn.length > 800
      || exampleKo.length > 800 || familyNoteKo.length > 1000) return null;
  const meanings = [];
  for (const meaning of Array.isArray(payload.meanings) ? payload.meanings : []) {
    const definitions = [];
    for (const item of Array.isArray(meaning?.definitions) ? meaning.definitions : []) {
      const definition = String(item?.definition ?? '').trim();
      if (!definition) continue;
      definitions.push({ definition, example: String(item?.example ?? '').trim() });
      if (definitions.length >= 3) break;
    }
    const partOfSpeech = String(meaning?.partOfSpeech ?? '').trim();
    if (definitions.length && partOfSpeech && partOfSpeech.length <= 80) meanings.push({ partOfSpeech, definitions });
    if (meanings.length >= 4) break;
  }
  if (!meanings.length || meanings[0].definitions[0].definition !== definitionEn) return null;
  const relationships = new Set(['inflection', 'derivation', 'related']);
  const relatedWords = [];
  const seenRelated = new Set();
  for (const item of Array.isArray(payload.relatedWords) ? payload.relatedWords : []) {
    const related = {
      term: String(item?.term ?? '').trim(),
      partOfSpeech: String(item?.partOfSpeech ?? '').trim(),
      relationship: String(item?.relationship ?? '').trim(),
      labelKo: String(item?.labelKo ?? '').trim(),
      meaningKo: String(item?.meaningKo ?? '').trim(),
      exampleEn: String(item?.exampleEn ?? '').trim(),
      exampleKo: String(item?.exampleKo ?? '').trim()
    };
    if (Object.values(related).some(value => !value)
        || !relationships.has(related.relationship)
        || related.term.length > 120 || related.partOfSpeech.length > 80 || related.labelKo.length > 120
        || related.meaningKo.length > 400 || related.exampleEn.length > 800 || related.exampleKo.length > 800
        || !/[\uac00-\ud7a3]/u.test(`${related.labelKo}${related.meaningKo}${related.exampleKo}`)) return null;
    const identity = `${normalizedTerm(related.term)}\0${normalizedTerm(related.partOfSpeech)}\0${related.relationship}`;
    if (seenRelated.has(identity)) return null;
    seenRelated.add(identity);
    relatedWords.push(related);
    if (relatedWords.length >= 8) break;
  }
  if (!relatedWords.length) return null;
  return {
    source: 'openai', model: 'gpt-5.4', term, definitionEn, meaningKo,
    exampleEn, exampleKo, familyNoteKo, meanings, relatedWords
  };
}

/** Create a same-origin AI meaning client. Only validated, complete meanings are cached. */
export function createAiMeaningLookup({
  fetchImpl = globalThis.fetch,
  endpoint = DEFAULT_AI_MEANING_ENDPOINT,
  timeoutMs = 30000,
  cache = new Map()
} = {}) {
  if (typeof fetchImpl !== 'function') throw new TypeError('fetch implementation is required');

  return async function lookupAiMeaning(value, { signal } = {}) {
    if (signal?.aborted) throw callerAbortError(signal.reason);
    const term = normalizedTerm(value);
    if (!term) return null;
    if (cache.has(term)) return cache.get(term);
    const linked = linkedSignal(signal, timeoutMs);
    try {
      const response = await fetchImpl(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ term }),
        signal: linked.signal
      });
      if (linked.signal.aborted) throw abortError(linked.signal.reason);
      if (response.status === 404) return null;
      if (!response.ok) throw new Error(`AI meaning request failed (${response.status})`);
      const result = cleanAiMeaning(term, await response.json());
      if (linked.signal.aborted) throw abortError(linked.signal.reason);
      if (!result) throw new Error('AI meaning response was invalid');
      cache.set(term, result);
      return result;
    } catch (error) {
      if (signal?.aborted) throw callerAbortError(signal.reason);
      if (linked.signal.aborted) throw abortError(linked.signal.reason);
      throw error;
    } finally {
      linked.dispose();
    }
  };
}

/**
 * Create a cached DictionaryAPI.dev client. Only successful results (including a confirmed 404)
 * are cached; aborts and transient failures remain retryable.
 */
export function createEnglishDictionary({
  fetchImpl = globalThis.fetch,
  endpoint = DEFAULT_ENDPOINT,
  timeoutMs = 5000,
  cache = new Map()
} = {}) {
  if (typeof fetchImpl !== 'function') throw new TypeError('fetch implementation is required');

  async function request(term, signal) {
    const linked = linkedSignal(signal, timeoutMs);
    try {
      const response = await fetchImpl(`${endpoint}${encodeURIComponent(term)}`, { signal: linked.signal });
      if (response.status === 404) return null;
      if (!response.ok) throw new Error(`Dictionary request failed (${response.status})`);
      return cleanDictionaryEntries(term, await response.json());
    } finally {
      linked.dispose();
    }
  }

  return {
    async lookup(value, { signal } = {}) {
      if (signal?.aborted) throw abortError(signal.reason);
      const term = normalizedTerm(value);
      if (!term || term.includes(' ')) return null;
      if (cache.has(term)) return cache.get(term);
      const result = await request(term, signal);
      cache.set(term, result);
      return result;
    },
    clear() { cache.clear(); }
  };
}

export function createKoreanGlossLookup({
  fetchImpl = globalThis.fetch,
  endpoint = 'https://api.mymemory.translated.net/get',
  timeoutMs = 5000,
  cache = new Map()
} = {}) {
  if (typeof fetchImpl !== 'function') throw new TypeError('fetch implementation is required');

  function withinLimit(value) {
    const text = String(value ?? '').trim();
    if (new TextEncoder().encode(text).length <= 500) return text;
    let output = '';
    for (const character of text) {
      if (new TextEncoder().encode(output + character).length > 500) break;
      output += character;
    }
    return output;
  }

  return async function lookupKorean(term, { signal, definitionEn = '' } = {}) {
    if (signal?.aborted) throw abortError(signal.reason);
    const definition = withinLimit(definitionEn);
    const query = definition || withinLimit(term);
    if (!query) return null;
    const cacheKey = `en|ko:${query}`;
    if (cache.has(cacheKey)) return cache.get(cacheKey);
    const linked = linkedSignal(signal, timeoutMs);
    try {
      const url = new URL(endpoint);
      url.searchParams.set('q', query);
      url.searchParams.set('langpair', 'en|ko');
      const response = await fetchImpl(url.href, { signal: linked.signal });
      if (!response.ok) throw new Error(`Korean translation request failed (${response.status})`);
      const payload = await response.json();
      const translated = String(payload?.responseData?.translatedText ?? '').trim();
      const confirmed = Number(payload?.responseStatus) === 200 && payload?.quotaFinished !== true;
      if (!confirmed) throw new Error('Korean translation service is temporarily unavailable');
      if (!translated || translated.toLocaleLowerCase('en-US') === query.toLocaleLowerCase('en-US')) {
        cache.set(cacheKey, null);
        return null;
      }
      if (!/[\uac00-\ud7a3]/u.test(translated)) throw new Error('Korean translation response was invalid');
      const result = {
        meaningKo: translated,
        source: 'mymemory-translation',
        translatedFrom: definition ? 'definition' : 'term',
        labelKo: '자동 번역'
      };
      cache.set(cacheKey, result);
      return result;
    } catch (error) {
      if (signal?.aborted) throw abortError(signal.reason);
      throw error;
    } finally {
      linked.dispose();
    }
  };
}

export {
  DEFAULT_ENDPOINT as ENGLISH_DICTIONARY_ENDPOINT,
  DEFAULT_AI_MEANING_ENDPOINT as AI_MEANING_ENDPOINT
};
