// How alike two values are, for spotting a misspelling among a column's values: Jaro-Winkler similarity, which
// rewards a shared start, as misspellings mostly keep the first letters.

/** Jaro similarity, 0 to 1: matching characters within half the longer length, less transpositions. */
export function jaro(a: string, b: string): number {
  if (a === b) return 1;
  if (!a.length || !b.length) return 0;
  const window = Math.max(0, Math.floor(Math.max(a.length, b.length) / 2) - 1);
  const matchedA = new Array<boolean>(a.length).fill(false);
  const matchedB = new Array<boolean>(b.length).fill(false);
  let matches = 0;
  for (let i = 0; i < a.length; i++) {
    const lo = Math.max(0, i - window);
    const hi = Math.min(b.length - 1, i + window);
    for (let j = lo; j <= hi; j++) {
      if (matchedB[j] || a[i] !== b[j]) continue;
      matchedA[i] = matchedB[j] = true;
      matches++;
      break;
    }
  }
  if (!matches) return 0;
  let transpositions = 0;
  let k = 0;
  for (let i = 0; i < a.length; i++) {
    if (!matchedA[i]) continue;
    while (!matchedB[k]) k++;
    if (a[i] !== b[k]) transpositions++;
    k++;
  }
  return (matches / a.length + matches / b.length + (matches - transpositions / 2) / matches) / 3;
}

/** Jaro-Winkler similarity: Jaro, raised by up to 0.1 for a shared prefix of up to four characters. */
export function jaroWinkler(a: string, b: string): number {
  const j = jaro(a, b);
  let prefix = 0;
  while (prefix < 4 && prefix < a.length && prefix < b.length && a[prefix] === b[prefix]) prefix++;
  return j + prefix * 0.1 * (1 - j);
}

/** Two values are near-duplicates (one a likely misspelling of the other) above this similarity. */
export const NEAR_DUPLICATE = 0.9;

/** Edits (a letter changed, added, dropped or two swapped) that turn one value into the other, up to `max` + 1. */
export function editDistance(a: string, b: string, max = 2): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev2: number[] = [];
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let d = Math.min(prev[j]! + 1, row[j - 1]! + 1, prev[j - 1]! + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d = Math.min(d, prev2[j - 2]! + 1);
      row.push(d);
    }
    prev2 = prev;
    prev = row;
  }
  return prev[b.length]!;
}

/**
 * Whether two words are close enough for one to be a misspelling of the other: within one edit per five characters
 * (so one in "Leeds", two in "Massachusetts"), and, for a word under five characters, Jaro-Winkler above the
 * threshold too. The edit budget keeps two names with the same first word apart: "Fatima Patel" and "Fatima Ali"
 * share a start, not a spelling, though Jaro-Winkler rates them alike.
 */
export function alike(a: string, b: string): boolean {
  const shorter = Math.min(a.length, b.length);
  const budget = Math.max(1, Math.floor(shorter / 5));
  if (editDistance(a, b, budget) > budget) return false;
  return shorter >= 5 || jaroWinkler(a, b) >= NEAR_DUPLICATE;
}

export interface ValueCount {
  value: string;
  count: number;
}

/**
 * Likely misspellings among a column's values, each with the value it was probably meant to be: a rarer value
 * that is nearly the same as a more common one, once capitals and spaces are ignored. Only words count: values of at
 * least four characters with a letter in them, and numbers, codes and dates are left alone.
 */
export function nearDuplicates(counts: ValueCount[]): { value: string; count: number; target: string }[] {
  // Spellings that differ only in capitals or spaces are one value here (Mixed capitals lists those); the most common spelling stands for the group.
  const groups = new Map<string, { value: string; count: number }>();
  for (const { value, count } of counts) {
    const key = value.trim().replace(/\s+/g, ' ').toLowerCase();
    if (key.length < 4 || !/\p{L}/u.test(key) || /\d{3}/.test(key)) continue;
    const g = groups.get(key);
    if (g) {
      if (count > g.count) g.value = value;
      g.count += count;
    } else groups.set(key, { value, count });
  }
  const sorted = [...groups.entries()].sort((a, b) => b[1].count - a[1].count || a[0].localeCompare(b[0]));
  const out: { value: string; count: number; target: string }[] = [];
  for (let i = 1; i < sorted.length; i++) {
    const [key, g] = sorted[i]!;
    let best: { score: number; target: string } | undefined;
    for (let j = 0; j < i; j++) {
      const [other, o] = sorted[j]!;
      if (o.count <= g.count || out.some((x) => x.value === o.value)) continue;
      const score = jaroWinkler(key, other);
      if (alike(key, other) && (!best || score > best.score)) best = { score, target: o.value };
    }
    if (best) out.push({ value: g.value, count: g.count, target: best.target });
  }
  return out;
}
