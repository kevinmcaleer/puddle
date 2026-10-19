// A small seeded random number generator (mulberry32), so the same seed always gives the same sample rows.

/** Random draws from one seeded stream. */
export interface Random {
  /** A float in [0, 1). */
  next(): number;
  /** A whole number from lo to hi, both included. */
  int(lo: number, hi: number): number;
  /** One item of a non-empty list. */
  pick<T>(items: readonly T[]): T;
  /** true with probability p. */
  chance(p: number): boolean;
}

/** mulberry32: a fast 32-bit generator, good enough for sample data. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A seed mixed with some text (FNV-1a), so each table gets its own stream and adding one doesn't change the others. */
export function mixSeed(seed: number, text: string): number {
  let h = (0x811c9dc5 ^ (seed >>> 0)) >>> 0;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193) >>> 0;
  return h;
}

/** A seeded stream of random draws. */
export function seededRandom(seed: number): Random {
  const next = mulberry32(seed);
  const int = (lo: number, hi: number) => lo + Math.floor(next() * (hi - lo + 1));
  return { next, int, pick: (items) => items[int(0, items.length - 1)]!, chance: (p) => next() < p };
}
