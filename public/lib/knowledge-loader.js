// Share active learning lookups with a small queue; view changes can reuse pending work.
export function createKnowledgeLoader({ resolve, cache = new Map(), concurrency = 2 } = {}) {
  if (typeof resolve !== 'function' || !Number.isInteger(concurrency) || concurrency < 1) throw new TypeError('Invalid knowledge loader.');
  let generation = 0;
  let active = 0;
  let controller = new AbortController();
  const pending = new Map();
  let queue = [];
  const abortError = () => new DOMException('Learning account changed.', 'AbortError');

  function pump() {
    while (active < concurrency && queue.length) {
      const task = queue.shift();
      const signal = controller.signal;
      active++;
      Promise.resolve().then(() => {
        if (task.generation !== generation || signal.aborted) throw abortError();
        return resolve(task.word, { signal });
      }).then(result => {
        if (task.generation !== generation || signal.aborted) throw abortError();
        if (result?.englishStatus === 'ready' && result.relatedWords?.length) cache.set(task.key, result);
        task.accept(result);
      }).catch(task.reject).finally(() => {
        if (task.generation !== generation) return;
        pending.delete(task.key);
        active--;
        pump();
      });
    }
  }

  function load(word) {
    const key = String(word?.term || '').trim().toLocaleLowerCase('en-US');
    if (!key) return Promise.reject(new TypeError('A study word is required.'));
    if (cache.has(key)) return Promise.resolve(cache.get(key));
    if (pending.has(key)) return pending.get(key);
    let accept, reject;
    const promise = new Promise((yes, no) => { accept = yes; reject = no; });
    pending.set(key, promise);
    // Shared lookups contain term-level content only; a record's edited meaning
    // is merged by its own view after the shared response arrives.
    queue.push({ word: { term: String(word.term).trim() }, key, accept, reject, generation });
    pump();
    return promise;
  }

  function clear() {
    generation++;
    controller.abort();
    controller = new AbortController();
    for (const task of queue) task.reject(abortError());
    queue = [];
    active = 0;
    pending.clear();
    cache.clear();
  }

  return { load, prefetch: words => { for (const word of words) load(word).catch(() => {}); }, clear };
}
