// Column profiles for the viewed result: SUMMARIZE's counts, and what text columns look like.
import { displayFormat, formatValue, fullCount, type ColumnKind, type DisplayFormat, type Quality } from '../ui';

export interface ColumnProfile {
  /** Share of empty values, 0 to 1. */
  empty: number;
  /** About how many distinct values (DuckDB's approximate count). */
  distinct?: number;
  min?: string | null;
  max?: string | null;
  /** The column's kind, so the smallest and largest are shown as its values are. */
  kind?: ColumnKind;
  /** Set on a text column whose non-empty values mostly read as numbers or dates. */
  looksLike?: { kind: 'numbers' | 'dates'; share: number };
}

/** A text column "looks like" numbers or dates when at least this share of its non-empty values reads as one. */
export const LOOKS_LIKE_SHARE = 0.8;

export function parseProfile(rows: Record<string, unknown>[], kinds: Record<string, ColumnKind> = {}): Record<string, ColumnProfile> {
  const out: Record<string, ColumnProfile> = {};
  for (const row of rows) {
    const name = String(row.column_name);
    out[name] = {
      ...(kinds[name] && { kind: kinds[name] }),
      empty: Number(row.null_pct ?? 0) / 100,
      distinct: row.approx_unique == null ? undefined : Number(row.approx_unique),
      min: row.min == null ? null : String(row.min),
      max: row.max == null ? null : String(row.max),
    };
  }
  return out;
}

/** Read compileTypeSniff's single row for the given columns. Numbers win over dates when both read. */
export function parseTypeSniff(row: Record<string, unknown>, columns: string[]): Record<string, ColumnProfile['looksLike']> {
  const out: Record<string, ColumnProfile['looksLike']> = {};
  columns.forEach((c, i) => {
    const n = Number(row[`n${i}`] ?? 0);
    if (!n) return;
    const num = Number(row[`num${i}`] ?? 0) / n;
    const date = Number(row[`date${i}`] ?? 0) / n;
    if (num >= LOOKS_LIKE_SHARE && num >= date) out[c] = { kind: 'numbers', share: num };
    else if (date >= LOOKS_LIKE_SHARE) out[c] = { kind: 'dates', share: date };
  });
  return out;
}

export const qualityOf = (p: ColumnProfile | undefined): Quality | undefined => (p ? { valid: 1 - p.empty, empty: p.empty, error: 0 } : undefined);

const pct = (x: number) => `${Math.round(x * 100)}%`;

/** One line about a column, e.g. "about 4 distinct · 1 to 4 · 25% empty · looks like numbers", in the display locale. */
export function describeProfile(p: ColumnProfile, f: DisplayFormat = displayFormat()): string {
  const parts: string[] = [];
  const show = (v: string) => formatValue(v, p.kind ?? 'text', f);
  if (p.distinct != null) parts.push(`about ${fullCount(p.distinct, f)} distinct`);
  if (p.min != null && p.max != null) parts.push(p.min === p.max ? `all ${show(p.min)}` : `${show(p.min)} to ${show(p.max)}`);
  parts.push(`${pct(p.empty)} empty`);
  if (p.looksLike) parts.push(`looks like ${p.looksLike.kind}${p.looksLike.share < 1 ? ` (${pct(p.looksLike.share)})` : ''}`);
  return parts.join(' · ');
}
