// The column detectors: what the profile and one query of exact counts say is wrong with each column.
import type { AnalysisCheck } from '../compiler';
import type { ColumnSchema, ParseOptions } from '../model';
import { LOOKS_LIKE_SHARE, type ColumnProfile } from '../results/profile';
import { columnKind } from '../ui/columnKind';
import { issueKey, type Issue, type IssueKind } from './issues';
import { findShapeIssues, type ShapeFacts } from './shape';

/** Columns with at most about this many distinct values are read in full, to find the same value written several ways. */
export const FEW_VALUES = 50;

const isText = (c: ColumnSchema) => columnKind(c.type) === 'text';

/** Which checks to run, from the profile: text columns get the text counts, and a list of values when there are few. */
export function analysisChecks(columns: ColumnSchema[], profile: Record<string, ColumnProfile>): AnalysisCheck[] {
  return columns.filter(isText).map((c) => {
    const p = profile[c.name];
    const few = p?.distinct != null && p.distinct <= FEW_VALUES;
    return { column: c.name, text: true, ...(few ? { values: true } : {}) };
  });
}

/** compileAnalysis's row, read back per column. */
export interface ColumnFacts {
  nonNull: number;
  edges?: number;
  edgesEx?: string[];
  doubled?: number;
  doubledEx?: string[];
  nonPrinting?: number;
  nonPrintingEx?: string[];
  blank?: number;
  values?: string[];
}

export interface AnalysisFacts {
  rows: number;
  dups?: number;
  columns: Record<string, ColumnFacts>;
  /** For a source read from delimited text: the rows around and inside the table that aren't data, and the read options it had. */
  shape?: { facts: ShapeFacts; options: ParseOptions };
}

const list = (v: unknown): string[] | undefined => (v != null && typeof v === 'object' && Symbol.iterator in v ? Array.from(v as Iterable<unknown>).filter((x) => x != null).map(String) : undefined);

export function parseAnalysis(row: Record<string, unknown>, checks: AnalysisCheck[]): AnalysisFacts {
  const num = (k: string) => (row[k] == null ? undefined : Number(row[k]));
  const columns: Record<string, ColumnFacts> = {};
  checks.forEach((c, i) => {
    const facts: ColumnFacts = { nonNull: num(`nn${i}`) ?? 0 };
    if (c.text) {
      facts.edges = num(`edges${i}`);
      facts.edgesEx = list(row[`edgesEx${i}`]);
      facts.doubled = num(`dbl${i}`);
      facts.doubledEx = list(row[`dblEx${i}`]);
      facts.nonPrinting = num(`np${i}`);
      facts.nonPrintingEx = list(row[`npEx${i}`]);
      facts.blank = num(`blank${i}`);
    }
    if (c.values) facts.values = list(row[`vals${i}`]);
    columns[c.column] = facts;
  });
  return { rows: num('rows') ?? 0, dups: num('dups'), columns };
}

/** Two examples at most, distinct, as they are in the data. */
const examples = (xs: string[] | undefined) => [...new Set(xs ?? [])].slice(0, 3);

/**
 * The values of a column that are the same once capitals are ignored (and spaces at the ends and inside are
 * tidied): [["north", "North", "NORTH"], ...], only groups with more than one spelling.
 */
export function caseVariants(values: string[]): string[][] {
  const groups = new Map<string, string[]>();
  for (const v of values) {
    const k = v.trim().replace(/\s+/g, ' ').toLowerCase();
    if (!k) continue;
    const g = groups.get(k);
    if (g) {
      if (!g.includes(v)) g.push(v);
    } else groups.set(k, [v]);
  }
  return [...groups.values()].filter((g) => g.length > 1);
}

/** The case most of a column's variants are written in, so the fix picks the form already in use. */
export function commonCase(groups: string[][]): 'upper' | 'lower' | 'title' {
  // Title case wins a tie: it reads best and is what Change case offers first.
  const tally = { title: 0, upper: 0, lower: 0 };
  for (const v of groups.flat()) {
    if (v === v.toUpperCase() && v !== v.toLowerCase()) tally.upper++;
    else if (v === v.toLowerCase() && v !== v.toUpperCase()) tally.lower++;
    else tally.title++;
  }
  return (Object.keys(tally) as (keyof typeof tally)[]).sort((a, b) => tally[b] - tally[a])[0]!;
}

/**
 * The issues of a node's output: from the profile (numbers and dates stored as text), the exact counts (spaces,
 * non-printing characters, blank text, duplicate rows) and the value lists (mixed capitals). Ignored issues are
 * left out.
 */
export function findIssues(columns: ColumnSchema[], profile: Record<string, ColumnProfile>, facts: AnalysisFacts, ignored: string[] = []): Issue[] {
  const out: Issue[] = [];
  const add = (kind: IssueKind, column: string | undefined, issue: Omit<Issue, 'key' | 'kind' | 'column'>) => {
    const key = issueKey(kind, column);
    if (!ignored.includes(key)) out.push({ key, kind, column, ...issue });
  };
  if (!facts.rows) return out;
  if (facts.shape) out.push(...findShapeIssues(columns.map((c) => c.name), facts.shape.facts, facts.shape.options, ignored));
  if (facts.dups) add('duplicateRows', undefined, { count: facts.dups, share: facts.dups / facts.rows, examples: [], severity: 'fix', fix: { type: 'duplicateRows', params: { columns: [], keep: 'first' } } });
  for (const c of columns) {
    const column = c.name;
    const p = profile[column];
    const x = facts.columns[column];
    if (!x || !x.nonNull) continue;
    const share = (n: number) => n / x.nonNull;
    if (x.nonPrinting) add('nonPrinting', column, { count: x.nonPrinting, share: share(x.nonPrinting), examples: examples(x.nonPrintingEx), severity: 'fix', fix: { type: 'removeNonPrinting' } });
    if (x.edges) add('edgeSpaces', column, { count: x.edges, share: share(x.edges), examples: examples(x.edgesEx), severity: 'fix', fix: { type: 'trimWhitespace' } });
    if (x.doubled) add('doubleSpaces', column, { count: x.doubled, share: share(x.doubled), examples: examples(x.doubledEx), severity: 'fix', fix: { type: 'collapseSpaces' } });
    if (x.blank) add('emptyText', column, { count: x.blank, share: share(x.blank), examples: [], severity: 'fix', fix: { type: 'emptyToNull' } });
    if (x.values) {
      const groups = caseVariants(x.values);
      if (groups.length) add('mixedCase', column, { count: groups.reduce((n, g) => n + g.length, 0), examples: groups[0]!.slice(0, 3), severity: 'fix', fix: { type: 'changeCase', params: { mode: commonCase(groups) } } });
    }
    if (isText(c) && p?.looksLike && p.looksLike.share >= LOOKS_LIKE_SHARE) {
      const whole = p.looksLike.share >= 1;
      const ex = [p.min, p.max].filter((v): v is string => v != null);
      if (p.looksLike.kind === 'numbers') add('numbersAsText', column, { count: Math.round(p.looksLike.share * x.nonNull), share: p.looksLike.share, examples: ex, severity: whole ? 'fix' : 'suggest', fix: { type: 'parseNumbers' } });
      else add('datesAsText', column, { count: Math.round(p.looksLike.share * x.nonNull), share: p.looksLike.share, examples: ex, severity: whole ? 'fix' : 'suggest', fix: { type: 'parseDates' } });
    }
  }
  return out;
}
