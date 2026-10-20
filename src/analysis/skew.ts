// Skewed rows: rows whose cells sit a column to the left or right of where they belong, because a cell was deleted
// or inserted in a spreadsheet. From compileSkew's groups (each row's kinds as a string, with its count and first
// and last row) the usual row is found, then a group of rows that is the usual row shifted by one at some column;
// the fix is Realign rows on those rows, with the columns' types given back after the move.
import type { Condition } from '../compiler/steps/rows';
import type { ColumnSchema } from '../model';
import type { Issue, StepFix } from './issues';

export interface SkewGroup {
  /** One character per column: e empty, n number, d date, b boolean, t text, x other. */
  sig: string;
  n: number;
  first: number;
  last: number;
}

export function parseSkew(rows: Record<string, unknown>[]): SkewGroup[] {
  return rows.map((r) => ({ sig: String(r.sig ?? ''), n: Number(r.n ?? 0), first: Number(r.first ?? 0), last: Number(r.last ?? 0) }));
}

export interface Skew {
  /** The usual row's kinds, and the shifted rows'. */
  base: SkewGroup;
  shifted: SkewGroup;
  /** The first column whose cells moved (an index into the columns). */
  at: number;
  /** Which way the shifted rows' cells sit: left of where they belong (a cell deleted) or right (a cell inserted). */
  sit: 'left' | 'right';
  /** How the shifted rows are picked out: from a row number down, or where a column is empty. */
  rows: { from: number } | { emptyColumn: number };
  /** Whether the pick catches only the shifted rows, as far as the groups show. */
  exact: boolean;
}

/** Columns the reader named itself, which are empty on a usual row (DuckDB's column7, Excel's Column H). */
const GENERATED = /^column\d+$|^Column [A-Z]+$/;
const EMPTY = 'e';

/** Positions where `sig` has an empty where `other` has not. */
const holes = (sig: string, other: string) => [...sig].map((k, i) => (k === EMPTY && other[i] !== EMPTY ? i : -1)).filter((i) => i >= 0);
const lastFilled = (sig: string) => sig.replace(/e+$/, '').length - 1;

/**
 * The column from which `s` is `b` shifted: its cells one to the left (`s[j] = b[j + 1]`) or right (`s[j] = b[j - 1]`)
 * from some column on, the same before it, with at least two cells whose kind changed. The largest such column.
 */
function shiftOf(b: string, s: string, sit: 'left' | 'right'): number | undefined {
  const len = b.length;
  const at = (k: number) => {
    for (let j = 0; j < k; j++) if (s[j] !== b[j]) return false;
    if (sit === 'left') {
      for (let j = k; j < len; j++) if (s[j] !== (b[j + 1] ?? EMPTY)) return false;
    } else {
      if (s[k] !== EMPTY) return false;
      for (let j = k + 1; j < len; j++) if (s[j] !== b[j - 1]) return false;
    }
    let changed = 0;
    for (let j = k; j < len; j++) if (s[j] !== EMPTY && s[j] !== b[j]) changed++;
    return changed >= 2;
  };
  for (let k = len - 1; k >= 0; k--) if (at(k)) return k;
  return undefined;
}

/**
 * Find a shifted block among the groups: the pair (usual row, shifted rows) with the strongest signs that the second
 * is the first with a cell deleted or inserted. The signs: the shifted rows have a hole (an empty cell) where the
 * usual row is filled, inside the row more than at its end; a column the reader named itself is filled only on the
 * shifted rows. Rows with nothing in them are left out.
 */
export function findSkew(columns: string[], groups: SkewGroup[]): Skew | undefined {
  const width = columns.length;
  const real = groups.filter((g) => g.sig.length === width && /[^e]/.test(g.sig) && g.n >= 2).slice(0, 6);
  let best: (Skew & { score: number }) | undefined;
  for (const base of real) {
    for (const shifted of real) {
      if (shifted === base) continue;
      for (const sit of ['left', 'right'] as const) {
        const at = shiftOf(base.sig, shifted.sig, sit);
        if (at == null) continue;
        let score = 0;
        const edge = lastFilled(shifted.sig);
        for (const i of holes(shifted.sig, base.sig)) score += i < edge ? 2 : 1;
        columns.forEach((c, i) => {
          if (!GENERATED.test(c)) return;
          if (shifted.sig[i] !== EMPTY && base.sig[i] === EMPTY) score += 2;
          if (base.sig[i] !== EMPTY && shifted.sig[i] === EMPTY) score -= 2;
        });
        if (score <= 0) continue;
        if (best && (best.score > score || (best.score === score && best.base.n >= base.n))) continue;
        const others = real.filter((g) => g !== shifted);
        // From a row down when the shifted rows all come after every other row; else a column empty only on them.
        const suffix = others.every((g) => g.last < shifted.first);
        const empties = holes(shifted.sig, base.sig);
        const column = (sit === 'right' && empties.includes(at) ? [at, ...empties] : [...empties].reverse()).find((i) => others.every((g) => g.sig[i] !== EMPTY)) ?? empties[0];
        const rows = suffix ? { from: shifted.first } : column != null ? { emptyColumn: column } : undefined;
        if (!rows) continue;
        const exact = 'from' in rows ? true : others.every((g) => g.sig[rows.emptyColumn] !== EMPTY);
        best = { base, shifted, at, sit, rows, exact, score };
      }
    }
  }
  if (!best) return undefined;
  const { score: _score, ...skew } = best;
  return skew;
}

/** The steps that put the rows right and give the moved columns their types back. */
export interface SkewFix {
  steps: StepFix[];
  /** The columns the move leaves as text that held dates: their date text comes from these columns. */
  dateSources: Record<string, string[]>;
}


/**
 * Realign rows on the shifted rows, then, per moved column, the step that gives it back the kind the usual row has
 * there (`formats` are the date formats to read, found by the caller from the columns the dates come from), and
 * Remove columns for a column the reader named that is empty once the inserted cells are gone.
 */
export function skewFix(columns: ColumnSchema[], skew: Skew, formats: Record<string, string[]> = {}): SkewFix {
  const names = columns.map((c) => c.name);
  const moved = names.slice(skew.at);
  const direction = skew.sit === 'left' ? 'right' : 'left';
  const picked = 'from' in skew.rows ? { rows: 'from', from: skew.rows.from, conditions: [] as Condition[] } : { rows: 'where', from: 1, conditions: [{ column: names[skew.rows.emptyColumn]!, op: 'empty', value: '' } satisfies Condition] };
  const steps: StepFix[] = [{ type: 'realignRows', params: { ...picked, match: 'all', matchCase: false, columns: moved, direction, by: 1 } }];
  const kindOf = (i: number) => skew.base.sig[i];
  const typeOf = (i: number) => columns[i]?.type ?? 'VARCHAR';
  /** The columns whose values a moved column holds after the move: its own, and its neighbour's on the shifted rows. */
  const sources = (i: number) => [i, direction === 'right' ? i - 1 : i + 1].filter((j) => j >= skew.at && j < names.length);
  const numbers: string[] = [];
  const integers: string[] = [];
  const dates: string[] = [];
  const dateSources: Record<string, string[]> = {};
  const booleans: string[] = [];
  const empty: string[] = [];
  for (let i = skew.at; i < names.length; i++) {
    const name = names[i]!;
    const kind = kindOf(i);
    if (kind === 'n') (sources(i).every((j) => /INT/i.test(typeOf(j))) ? integers : numbers).push(name);
    else if (kind === 'd') {
      dates.push(name);
      dateSources[name] = sources(i).map((j) => names[j]!);
    } else if (kind === 'b') booleans.push(name);
    else if (kind === EMPTY && GENERATED.test(name) && direction === 'left') empty.push(name);
  }
  if (integers.length) steps.push({ type: 'changeType', params: { columns: integers, to: 'integer', onError: 'empty' } });
  if (numbers.length) steps.push({ type: 'parseNumbers', params: { columns: numbers } });
  for (const name of dates) steps.push({ type: 'parseDates', params: { columns: [name], formats: formats[name] ?? ['%Y-%m-%d'], onError: 'empty' } });
  if (booleans.length) steps.push({ type: 'changeType', params: { columns: booleans, to: 'boolean', onError: 'empty' } });
  if (empty.length) steps.push({ type: 'removeColumns', params: { columns: empty } });
  return { steps, dateSources };
}

/** The issue for a skew, with its fix: applied by Fix all when the rows are picked out exactly, else suggested. */
export function skewIssue(columns: ColumnSchema[], skew: Skew, fix: SkewFix): Omit<Issue, 'key' | 'kind' | 'column'> {
  const names = columns.map((c) => c.name);
  const where = 'from' in skew.rows ? `from row ${skew.rows.from}` : `where ${names[skew.rows.emptyColumn]} is empty`;
  return {
    value: skew.sit,
    count: skew.shifted.n,
    examples: [`rows ${skew.shifted.first} to ${skew.shifted.last}`, where],
    severity: skew.exact ? 'fix' : 'suggest',
    fix: { steps: fix.steps, label: 'Realign rows' },
  };
}
