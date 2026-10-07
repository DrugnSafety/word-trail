// Share small, account-scoped learning requests without caching failed responses.
export function createStudyGuideLookup({ fetchImpl = globalThis.fetch, endpoint = '/api/study-guide', concurrency = 2 } = {}) {
  if (typeof fetchImpl !== 'function' || !Number.isInteger(concurrency) || concurrency < 1) throw new TypeError('Invalid study guide lookup.');
  let generation = 0, active = 0;
  let controller = new AbortController();
  const cache = new Map(), pending = new Map();
  let queue = [];
  const aborted = () => new DOMException('Study account changed.', 'AbortError');

  function pump() {
    while (active < concurrency && queue.length) {
      const task = queue.shift(), signal = controller.signal;
      active++;
      Promise.resolve().then(async () => {
        if (signal.aborted || task.generation !== generation) throw aborted();
        const response = await fetchImpl(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(task.input), signal });
        if (!response.ok) throw new Error(response.status === 429 ? '잠시 쉬었다가 다시 눌러 주세요.' : '학습 설명을 불러오지 못했어요. 다시 눌러 주세요.');
        const guide = await response.json();
        if (signal.aborted || task.generation !== generation) throw aborted();
        if (!guide || guide.kind !== task.input.kind || guide.text !== task.input.text) throw new Error('이 학습 내용과 일치하는 설명을 받지 못했어요.');
        cache.set(task.key, guide);
        task.accept(guide);
      }).catch(task.reject).finally(() => {
        if (task.generation !== generation) return;
        pending.delete(task.key); active--; pump();
      });
    }
  }

  function load(kind, text, context = '') {
    const input = { kind, text: String(text || '').trim(), context: String(context || '').trim() };
    if (!['word', 'sentence'].includes(kind) || !input.text) return Promise.reject(new TypeError('A word or sentence is required.'));
    const key = JSON.stringify(input);
    if (cache.has(key)) return Promise.resolve(cache.get(key));
    if (pending.has(key)) return pending.get(key);
    let accept, reject;
    const promise = new Promise((yes, no) => { accept = yes; reject = no; });
    pending.set(key, promise);
    queue.push({ input, key, accept, reject, generation }); pump();
    return promise;
  }

  function clear() {
    generation++; controller.abort(); controller = new AbortController();
    queue.forEach(task => task.reject(aborted())); queue = [];
    pending.clear(); cache.clear(); active = 0;
  }
  return { load, clear, prefetch: entries => entries.forEach(({ kind, text, context }) => { load(kind, text, context).catch(() => {}); }) };
}
