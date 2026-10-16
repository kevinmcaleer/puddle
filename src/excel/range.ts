// A1-style cell references without SheetJS, so the inspector can check a typed range on the main thread.

/** Zero-based, inclusive cell bounds. */
export interface CellRange {
  s: { r: number; c: number };
  e: { r: number; c: number };
}

/** Largest row and column Excel allows (1,048,576 rows; XFD). */
export const MAX_ROW = 1_048_575;
export const MAX_COL = 16_383;

/** "A" is 0, "Z" is 25, "AA" is 26. */
export function columnIndex(letters: string): number {
  let n = 0;
  for (const ch of letters.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

/** 0 is "A", 26 is "AA". */
export function columnLetters(index: number): string {
  let s = '';
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

const CELL = /^\$?([A-Za-z]{1,3})\$?(\d{1,7})$/;

function parseCell(text: string): { r: number; c: number } | undefined {
  const m = CELL.exec(text.trim());
  if (!m) return undefined;
  const c = columnIndex(m[1]!);
  const r = Number(m[2]) - 1;
  return r >= 0 && r <= MAX_ROW && c <= MAX_COL ? { r, c } : undefined;
}

/**
 * Parse "B3:F200" (either corner first), or a single cell "B3" meaning from there to the end of the sheet's data.
 * Returns undefined when the text isn't a cell range.
 */
export function parseRange(text: string): CellRange | undefined {
  const parts = text.trim().split(':');
  if (parts.length > 2) return undefined;
  const a = parseCell(parts[0] ?? '');
  if (!a) return undefined;
  if (parts.length === 1) return { s: a, e: { r: MAX_ROW, c: MAX_COL } };
  const b = parseCell(parts[1]!);
  if (!b) return undefined;
  return { s: { r: Math.min(a.r, b.r), c: Math.min(a.c, b.c) }, e: { r: Math.max(a.r, b.r), c: Math.max(a.c, b.c) } };
}

/** "B3:F200". */
export const formatRange = (r: CellRange) => `${columnLetters(r.s.c)}${r.s.r + 1}:${columnLetters(r.e.c)}${r.e.r + 1}`;

/** The cells two ranges share, or undefined when they don't overlap. */
export function intersect(a: CellRange, b: CellRange): CellRange | undefined {
  const s = { r: Math.max(a.s.r, b.s.r), c: Math.max(a.s.c, b.s.c) };
  const e = { r: Math.min(a.e.r, b.e.r), c: Math.min(a.e.c, b.e.c) };
  return s.r <= e.r && s.c <= e.c ? { s, e } : undefined;
}
