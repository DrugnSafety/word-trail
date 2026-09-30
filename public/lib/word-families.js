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
