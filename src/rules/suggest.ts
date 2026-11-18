// Suggested rules: what profiling already knows about a node's output, turned into rules that pass today.
import type { SuggestionCheck } from '../compiler';
import type { ColumnSchema, Rule } from '../model';
import type { ColumnProfile } from '../results/profile';
import { columnKind } from '../ui/columnKind';
import { fullCount } from '../ui/format';

/** A rule offered from profiling, with why. `key` (rule type and column) names it for dismissal. */
export interface Suggestion {
  key: string;
  type: string;
  params: Record<string, unknown>;
  reason: string;
}

/** At most this many distinct values make a column a set worth listing. */
export const IN_SET_MAX = 10;
/** Profiling's distinct count is approximate: columns at least this close to one value per row get an exact count. */
const UNIQUE_NEAR = 0.9;

const isText = (c: ColumnSchema) => columnKind(c.type) === 'text';
const isOrdered = (c: ColumnSchema) => ['integer', 'decimal', 'date', 'timestamp'].includes(columnKind(c.type));
const setLike = (c: ColumnSchema) => ['text', 'integer', 'boolean'].includes(columnKind(c.type));

/** How many suggestions the panel lists before Show more. */
export const SUGGESTIONS_SHOWN = 5;

/** A column named as a key: id, order_id, customerId, code, "invoice no". */
export const keyLike = (name: string) => /(^|[\s_-])(id|key|code|no|number|ref)$/i.test(name.trim()) || /[a-z](Id|ID|Key|Code)$/.test(name.trim());

/**
 * A measure: an amount, not something a row is known by. A decimal column, or text that reads as numbers (amounts
 * written with currency symbols) unless it is named as a key. Its values may all differ today, but nobody means
 * "amount is unique".
 */
export const isMeasure = (c: ColumnSchema, p: Pick<ColumnProfile, 'looksLike'> | undefined) =>
  columnKind(c.type) === 'decimal' || (isText(c) && p?.looksLike?.kind === 'numbers' && !keyLike(c.name));

/**
 * Which exact checks to run, from the profile alone: blanks only where profiling found no nulls, spaces on text
 * columns, an exact distinct count where the approximate one is close to the row count, and the values of columns
 * with few distinct ones.
 */
export function suggestionChecks(columns: ColumnSchema[], profile: Record<string, ColumnProfile>, rows: number): SuggestionCheck[] {
  const checks: SuggestionCheck[] = [];
  for (const c of columns) {
    const p = profile[c.name];
    if (!p) continue;
    const check: SuggestionCheck = { column: c.name };
    if (p.empty === 0) check.blank = true;
    if (isText(c)) check.edges = true;
    // Unique is only suggested when every row has a value, so a column with nulls needs no exact count.
    if (rows >= 2 && p.empty === 0 && p.distinct != null && p.distinct >= rows * UNIQUE_NEAR) check.distinct = true;
    if (setLike(c) && p.distinct != null && p.distinct >= 2 && p.distinct <= IN_SET_MAX && rows >= 2 * p.distinct) check.values = true;
    // Profiling reads dates written many ways; the rule reads fewer, so its own count decides.
    if (isText(c) && p.looksLike?.share === 1) check.reads = p.looksLike.kind === 'numbers' ? 'number' : 'date';
    if (check.blank || check.edges || check.distinct || check.values || check.reads) checks.push(check);
  }
  return checks;
}

/** compileSuggestionChecks' row, read back per column. */
export interface CheckResult {
  nonNull: number;
  blank?: number;
  edges?: number;
  distinct?: number;
  values?: string[];
  /** Values the "reads as" rule would fail. */
  unread?: number;
}

export function parseSuggestionChecks(row: Record<string, unknown>, checks: SuggestionCheck[]): { rows: number; columns: Record<string, CheckResult> } {
  const num = (k: string) => (row[k] == null ? undefined : Number(row[k]));
  const columns: Record<string, CheckResult> = {};
  checks.forEach((c, i) => {
    const values = row[`values${i}`];
    columns[c.column] = {
      nonNull: num(`nn${i}`) ?? 0,
      blank: c.blank ? num(`blank${i}`) : undefined,
      edges: c.edges ? num(`edges${i}`) : undefined,
      distinct: c.distinct ? num(`distinct${i}`) : undefined,
      unread: c.reads ? num(`unread${i}`) : undefined,
      values: c.values && values != null && typeof values === 'object' && Symbol.iterator in values ? Array.from(values as Iterable<unknown>, String) : undefined,
    };
  });
  return { rows: num('rows') ?? 0, columns };
}

const s = (n: number, word: string) => `${fullCount(n)} ${word}${n === 1 ? '' : 's'}`;

/** The column a rule checks, for matching suggestions against rules already on the node. */
const ruleColumn = (r: Pick<Rule, 'params'>) => {
  const p = r.params as { column?: unknown; columns?: unknown };
  if (typeof p.column === 'string') return p.column;
  return Array.isArray(p.columns) && p.columns.length === 1 ? String(p.columns[0]) : undefined;
};

/**
 * The rules to suggest, each one that would pass on the data as it is now. Suggestions the node already has as a
 * rule (same type and column), or that were dismissed, are left out.
 */
export function suggestRules(
  columns: ColumnSchema[],
  profile: Record<string, ColumnProfile>,
  checked: { rows: number; columns: Record<string, CheckResult> },
  existing: Pick<Rule, 'type' | 'params'>[] = [],
  dismissed: string[] = [],
): Suggestion[] {
  const { rows } = checked;
  const out: Suggestion[] = [];
  const add = (type: string, column: string, params: Record<string, unknown>, reason: string) => {
    const key = `${type}:${column}`;
    if (dismissed.includes(key) || existing.some((r) => r.type === type && ruleColumn(r) === column)) return;
    out.push({ key, type, params, reason });
  };
  if (!rows) return out;
  for (const c of columns) {
    const p = profile[c.name];
    const x = checked.columns[c.name];
    if (!p || !x) continue;
    const column = c.name;
    if (x.blank === 0) add('notEmpty', column, { column }, `${column} has no empty values`);
    // Confirmed by an exact count: every row has a value, and no two are the same.
    if (x.distinct != null && rows >= 2 && x.nonNull === rows && x.distinct === rows && !isMeasure(c, p))
      add('unique', column, { columns: [column] }, `${column} has a different value in each of its ${s(rows, 'row')}`);
    if (x.values && x.values.length >= 2 && x.values.length <= IN_SET_MAX && x.nonNull >= 2 * x.values.length)
      add('inSet', column, { column, values: x.values, matchCase: true }, `${column} has ${s(x.values.length, 'distinct value')}`);
    if (isOrdered(c) && p.min != null && p.max != null && p.min !== p.max) add('inRange', column, { column, min: p.min, max: p.max }, `${column} runs from ${p.min} to ${p.max}`);
    // Every value looks like one, and the rule itself would pass (when that was counted).
    if (isText(c) && p.looksLike && p.looksLike.share === 1 && !x.unread) {
      const as = p.looksLike.kind === 'numbers' ? 'number' : 'date';
      add('readsAs', column, { column, as }, `${column} is text, but every value reads as a ${as}`);
    }
    if (isText(c) && x.edges === 0 && x.nonNull > 0) add('noEdgeSpaces', column, { column }, `${column} has no spaces at either end`);
  }
  return out;
}

/** How likely a kind of rule is to be meant, the likeliest first: keys, required columns, then what the values look like. */
const TYPE_RANK = ['unique', 'notEmpty', 'inSet', 'readsAs', 'inRange', 'noEdgeSpaces'];
const typeRank = (type: string) => (TYPE_RANK.indexOf(type) + 1 || TYPE_RANK.length + 1) - 1;
const suggestionColumn = (s: Suggestion) => s.key.slice(s.type.length + 1);

/**
 * Suggestions with the likeliest to be meant first. Each kind of rule takes its turn (the best key, the best required
 * column, the best list of values and so on, then the second of each), so the first few are not five of one kind.
 * Within a kind, columns named as keys come first, then the order of the table's columns.
 */
export function rankSuggestions(suggestions: Suggestion[]): Suggestion[] {
  const byType = new Map<string, Suggestion[]>();
  for (const s of suggestions) byType.set(s.type, [...(byType.get(s.type) ?? []), s]);
  const turn = new Map<Suggestion, number>();
  for (const list of byType.values()) {
    const keysFirst = [...list.filter((s) => keyLike(suggestionColumn(s))), ...list.filter((s) => !keyLike(suggestionColumn(s)))];
    keysFirst.forEach((s, i) => turn.set(s, i));
  }
  return [...suggestions].sort((a, b) => turn.get(a)! - turn.get(b)! || typeRank(a.type) - typeRank(b.type));
}
