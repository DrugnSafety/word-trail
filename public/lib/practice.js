export const PRACTICE_ORDER = Object.freeze(['explain', 'point', 'spelling', 'audio', 'cloze', 'meaning', 'family', 'reading']);

export function nextPractice(mode, index, words, hasMeaning = () => true) {
  if (!words.length || index < 0 || index >= words.length) return { complete: true };
  for (let next = PRACTICE_ORDER.indexOf(mode) + 1; next < PRACTICE_ORDER.length; next += 1) {
    const candidate = PRACTICE_ORDER[next];
    if (candidate !== 'meaning' || hasMeaning(words[index])) return { mode: candidate, index };
  }
  return index + 1 < words.length ? { mode: PRACTICE_ORDER[0], index: index + 1 } : { complete: true };
}

export function phraseRange(referenceRanges, word) {
  const startIndex = word.sourceIndexes?.[0] ?? word.sourceIndex;
  const count = String(word.term).match(/[\p{L}\p{M}\p{N}]+(?:['’‘ʼ][\p{L}\p{M}\p{N}]+)*/gu)?.length || 1;
  const first = referenceRanges[startIndex];
  const last = referenceRanges[startIndex + count - 1];
  return first && last ? { start: first.start, end: last.end } : null;
}
