// Column profiles for the viewed result: SUMMARIZE's counts, and what text columns look like.
// Imported from the files themselves, not the kit's index, so the runner's bundle (which analyses files too) stays clear of the components.
import type { ColumnKind } from '../ui/columnKind';
import { formatValue, fullCount } from '../ui/format';
import { displayFormat, type DisplayFormat } from '../ui/locale';
import type { Quality } from '../ui/QualityBar';

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
  /** Set on a text column where only half or more of the values read as numbers or dates: mixed types. */
  partly?: { kind: 'numbers' | 'dates'; share: number };
}

/** A text column is "partly" numbers or dates when at least half of its values, but fewer than LOOKS_LIKE_SHARE, read as one. */
export const PARTLY_SHARE = 0.5;

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

/** What compileTypeSniff says about a column: mostly numbers or dates (`looksLike`), or only partly (`partly`). */
export type TypeSniff = Pick<ColumnProfile, 'looksLike' | 'partly'>;

/** Read compileTypeSniff's single row for the given columns. Numbers win over dates when both read. */
export function parseTypeSniff(row: Record<string, unknown>, columns: string[]): Record<string, TypeSniff> {
  const out: Record<string, TypeSniff> = {};
  columns.forEach((c, i) => {
    const n = Number(row[`n${i}`] ?? 0);
    if (!n) return;
    const num = Number(row[`num${i}`] ?? 0) / n;
    const date = Number(row[`date${i}`] ?? 0) / n;
    const [kind, share] = num >= date ? (['numbers', num] as const) : (['dates', date] as const);
    if (share >= LOOKS_LIKE_SHARE) out[c] = { looksLike: { kind, share } };
    else if (share >= PARTLY_SHARE) out[c] = { partly: { kind, share } };
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
