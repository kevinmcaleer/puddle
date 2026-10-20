// The column detectors: what the profile and one query of exact counts say is wrong with each column.
import { PLACEHOLDERS, type AnalysisCheck } from '../compiler';
import type { ColumnNamesMode, ColumnSchema, ParseOptions } from '../model';
import { LOOKS_LIKE_SHARE, type ColumnProfile } from '../results/profile';
import { columnKind } from '../ui/columnKind';
import { issueKey, type Issue, type IssueFix, type IssueKind, type StepFix } from './issues';
import { tidyRenames } from './names';
import { findShapeIssues, type ShapeFacts } from './shape';
import { skewIssue, type Skew, type SkewFix } from './skew';
import { nearDuplicates, type ValueCount } from './similar';

/** Columns with at most about this many distinct values are read in full, to find the same value written several ways. */
export const FEW_VALUES = 50;

/** Analysis that counts rows (a constant or an index column) needs at least this many to say anything. */
const FEW_ROWS = 5;

const isText = (c: ColumnSchema) => columnKind(c.type) === 'text';
const isWhole = (c: ColumnSchema) => columnKind(c.type) === 'integer';

/** A column named for a date or a time, where a number is likely a date in disguise. */
const DATE_NAME = /(^|[^a-z])(date|time|day|dob|when|created|updated|modified|timestamp|ts|dt)([^a-z]|$)|_(at|on)$|(date|time|day)$/;
/** A column named as an id or a code: one that should be unique. */
const ID_NAME = /(^|[^a-z])(id|key|code|ref|reference|no|number|sku|account|pk)$|^id$|_id$/;
/** A column that counts the rows, as a spreadsheet or pandas export adds one. */
const INDEX_NAME = /^(|unnamed: ?0|index|idx|row|rows|row ?no\.?|row_?num(ber)?|rownum|column0|#|sr\.? ?no\.?|s\.? ?no\.?|no\.?)$/;
/** A column named for a month, a year, a quarter or a period, as a wide table has one of each. */
const PERIOD_NAME = /^((jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*([ _\-/']?\d{2,4})?|(19|20)\d{2}|fy ?\d{2,4}|q[1-4]([ _\-/]?(19|20)?\d{2})?|(19|20)\d{2}[ _\-/]?q[1-4]|(19|20)\d{2}[-_/ ]?(0[1-9]|1[0-2])|h[12]([ _\-/]?\d{4})?|w(ee)?k ?\d{1,2})$/;
/** Pairs of words a boolean column is written with, lower case: the ones DuckDB reads as BOOLEAN. 1 and 0 may be counts, so only suggested. */
const BOOLEAN_PAIRS: [string, string, 'fix' | 'suggest'][] = [['yes', 'no', 'fix'], ['y', 'n', 'fix'], ['true', 'false', 'fix'], ['t', 'f', 'fix'], ['1', '0', 'suggest']];

const lowerName = (name: string) => name.trim().toLowerCase().replace(/[\s_]+/g, ' ');

/**
 * Which checks to run, from the profile: every column gets its counts; text columns the text facts, and a list of
 * values when there are few; numbers (or text that reads as numbers) the numeric facts; the first column the index
 * check when its name says so; id-named columns the most frequent value.
 */
export function analysisChecks(columns: ColumnSchema[], profile: Record<string, ColumnProfile>): AnalysisCheck[] {
  return columns.map((c, i) => {
    const p = profile[c.name];
    const text = isText(c);
    const few = text && p?.distinct != null && p.distinct <= FEW_VALUES;
    const numeric = isWhole(c) || (text && p?.looksLike?.kind === 'numbers');
    const name = lowerName(c.name);
    const index = i === 0 && (isWhole(c) || text) && INDEX_NAME.test(name);
    const id = ID_NAME.test(name) && !index;
    return { column: c.name, ...(text ? { text: true } : {}), ...(few ? { values: true } : {}), ...(numeric ? { numeric: true } : {}), ...(index ? { index: true } : {}), ...(id ? { id: true } : {}) };
  });
}

/** compileAnalysis's row, read back per column. */
export interface ColumnFacts {
  nonNull: number;
  /** Distinct values, exactly. */
  distinct?: number;
  edges?: number;
  edgesEx?: string[];
  doubled?: number;
  doubledEx?: string[];
  nonPrinting?: number;
  nonPrintingEx?: string[];
  blank?: number;
  /** Values that stand for empty (n/a, -, none), and the distinct ones seen. */
  placeholders?: number;
  placeholdersEx?: string[];
  /** Non-empty values that are neither numbers nor placeholders, with a few of them; the same for dates. */
  nonNumbers?: number;
  nonNumbersEx?: string[];
  nonDatesEx?: string[];
  /** Distinct shapes (digits as 9, letters as A or a) and the first few. */
  shapes?: number;
  shapesEx?: string[];
  /** Cells holding a key and a value ("Total: 1,234"), the sign between them and an example. */
  keyValues?: number;
  keyValueSep?: string;
  keyValueEx?: string;
  mojibake?: number;
  mojibakeEx?: string[];
  /** Values ending in a comma, or a point, and one or two digits: which decimal mark the numbers use. */
  commaDecimals?: number;
  pointDecimals?: number;
  /** The distinct values, trimmed and sorted, for a column with few of them. */
  values?: string[];
  /** The same with how often each occurs, the most frequent first. */
  valueCounts?: ValueCount[];
  min?: number;
  max?: number;
  whole?: number;
  /** Values equal to their row number counted from 1, and from 0. */
  seq1?: number;
  seq0?: number;
  mode?: string;
}

export interface AnalysisFacts {
  rows: number;
  dups?: number;
  columns: Record<string, ColumnFacts>;
  /** For a source read from delimited text or a sheet: the rows around and inside the table that aren't data, and the read options it had. */
  shape?: { facts: ShapeFacts; options: ParseOptions; sheet?: boolean };
  /** For a sheet: the merged cells in the rows read, and whether every cell of each took its value. */
  sheet?: { merges: number; filled: boolean };
  /** The project's style for column names, as it was when the node was analysed. */
  columnNames?: ColumnNamesMode;
  /** When the table was too big to look at whole: the rows looked at (its first ones) and how many it has. */
  sample?: { rows: number; total: number };
  /** Rows whose cells sit a column to the left or right of where they belong, with the steps that put them right. */
  skew?: { skew: Skew; fix: SkewFix };
}

const list = (v: unknown): string[] | undefined => (v != null && typeof v === 'object' && Symbol.iterator in v ? Array.from(v as Iterable<unknown>).filter((x) => x != null).map(String) : undefined);

export function parseAnalysis(row: Record<string, unknown>, checks: AnalysisCheck[]): AnalysisFacts {
  const num = (k: string) => (row[k] == null ? undefined : Number(row[k]));
  const text = (k: string) => (row[k] == null ? undefined : String(row[k]));
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
      facts.placeholders = num(`ph${i}`);
      facts.nonNumbers = num(`nonNum${i}`);
      facts.keyValues = num(`kv${i}`);
      facts.keyValueSep = text(`kvSep${i}`);
      facts.keyValueEx = text(`kvEx${i}`);
      facts.mojibake = num(`moji${i}`);
      facts.mojibakeEx = list(row[`mojiEx${i}`]);
      facts.commaDecimals = num(`comma${i}`);
      facts.pointDecimals = num(`point${i}`);
    }
    if (c.numeric) {
      facts.min = num(`nmin${i}`);
      facts.max = num(`nmax${i}`);
      facts.whole = num(`whole${i}`);
    }
    if (c.index) {
      facts.seq1 = num(`seq1${i}`);
      facts.seq0 = num(`seq0${i}`);
    }
    columns[c.column] = facts;
  });
  return { rows: num('rows') ?? 0, dups: num('dups'), columns };
}

/** compileDistinctFacts's rows, read into the facts of the columns they name. */
export function parseDistinctFacts(rows: Record<string, unknown>[], checks: AnalysisCheck[], columns: Record<string, ColumnFacts>): void {
  for (const r of rows) {
    const c = String(r.c);
    const facts = columns[c];
    const check = checks.find((x) => x.column === c);
    if (!facts || !check) continue;
    facts.distinct = r.dist == null ? undefined : Number(r.dist);
    if (check.id) facts.mode = r.mode == null ? undefined : String(r.mode);
    if (check.text) {
      facts.placeholdersEx = list(r.phEx);
      facts.nonNumbersEx = list(r.nonNumEx);
      facts.nonDatesEx = list(r.nonDateEx);
      facts.shapes = r.shapes == null ? undefined : Number(r.shapes);
      facts.shapesEx = list(r.shapesEx);
    }
  }
}

/** compileValueCounts's rows, by column: each value with its count, the most frequent first as the query orders them. */
export function parseValueCounts(rows: Record<string, unknown>[]): Record<string, ValueCount[]> {
  const out: Record<string, ValueCount[]> = {};
  for (const r of rows) {
    const c = String(r.c);
    (out[c] ??= []).push({ value: String(r.v), count: Number(r.n) });
  }
  return out;
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

/** The boolean pair a column's values come from, when they are two values of one pair (placeholders aside). */
export function booleanPair(values: string[]): { pair: [string, string]; severity: 'fix' | 'suggest' } | undefined {
  const seen = new Set(values.map((v) => v.trim().toLowerCase()).filter((v) => v !== '' && !PLACEHOLDERS.includes(v)));
  if (seen.size !== 2) return undefined;
  const found = BOOLEAN_PAIRS.find(([a, b]) => seen.has(a) && seen.has(b));
  return found ? { pair: [found[0], found[1]], severity: found[2] } : undefined;
}

/** The format that reads a column of whole numbers as dates, from their range: Excel serials, Unix seconds or milliseconds. */
export function serialDateFormat(min: number, max: number): 'excel serial' | 'unix seconds' | 'unix milliseconds' | undefined {
  if (min >= 20_000 && max <= 60_000) return 'excel serial';
  if (min >= 1e9 && max < 2e9) return 'unix seconds';
  if (min >= 1e12 && max < 2e12) return 'unix milliseconds';
  return undefined;
}

/** The columns named for months, years or periods, when there are enough of them to be a wide table: three or more. */
export const periodColumns = (columns: string[]) => {
  const found = columns.filter((c) => PERIOD_NAME.test(lowerName(c)));
  return found.length >= 3 ? found : [];
};

/** What the period columns are, for the unpivoted column's name: month, year, quarter or period. */
export function periodKind(columns: string[]): string {
  const names = columns.map(lowerName);
  if (names.every((n) => /^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/.test(n) || /^(19|20)\d{2}[-_/ ]?\d{2}$/.test(n))) return 'month';
  if (names.every((n) => /^(fy ?)?(19|20)?\d{2,4}$/.test(n))) return 'year';
  if (names.every((n) => /q[1-4]/.test(n))) return 'quarter';
  return 'period';
}

/**
 * Parse numbers settings from the decimals seen: a comma or a point, as the column writes them (7.625,43 reads as
 * German whatever the project's locale). No decimals seen: the project's locale decides, as the step's defaults do.
 */
export function decimalParams(x: ColumnFacts): { params?: Record<string, unknown> } {
  const comma = x.commaDecimals ?? 0;
  const point = x.pointDecimals ?? 0;
  if (!comma && !point) return {};
  return { params: { decimal: comma > point ? ',' : '.', locale: '' } };
}

/** A placeholder fix: for a source read from text, the read option; otherwise one Replace values per placeholder. */
function placeholderFix(values: string[], options: ParseOptions | undefined): IssueFix {
  if (options) {
    const nullStrings = [...new Set([...(options.nullStrings ?? []), ...values])];
    return { readOptions: { nullStrings }, label: `Read ${values.map((v) => JSON.stringify(v)).join(', ')} as empty` };
  }
  const distinct = [...new Set(values.map((v) => v.toLowerCase()))];
  const steps: StepFix[] = distinct.map((find) => ({ type: 'replaceValues', params: { match: 'value', find, replace: '', replaceWithNull: true, matchCase: false, toText: false } }));
  return { steps, label: 'Replace values' };
}

/**
 * The issues of a node's output: from the profile (numbers and dates stored as text), the exact counts (spaces,
 * non-printing characters, blank text, duplicate rows) and the value lists (mixed capitals). Ignored issues are
 * left out.
 */
export function findIssues(columns: ColumnSchema[], profile: Record<string, ColumnProfile>, facts: AnalysisFacts, ignored: string[] = []): Issue[] {
  const out: Issue[] = [];
  const add = (kind: IssueKind, column: string | undefined, issue: Omit<Issue, 'key' | 'kind' | 'column'>) => {
    const key = issueKey(kind, column, issue.value);
    if (!ignored.includes(key)) out.push({ key, kind, column, ...issue });
  };
  if (!facts.rows) return out;
  const names = columns.map((c) => c.name);
  const textOptions = facts.shape && !facts.shape.sheet ? facts.shape.options : undefined;
  if (facts.shape) out.push(...findShapeIssues(names, facts.shape.facts, facts.shape.options, ignored, facts.shape.sheet));
  if (facts.sheet?.merges && !facts.sheet.filled)
    add('mergedCells', undefined, { count: facts.sheet.merges, examples: [], severity: 'fix', fix: { readOptions: { fillMerges: true }, label: 'Fill merged cells' } });
  // Shifted rows first: the columns they moved through are judged once they are back in line.
  const skewed = facts.skew && { column: names[facts.skew.skew.at]!, issue: skewIssue(columns, facts.skew.skew, facts.skew.fix) };
  if (skewed) add('skewedRows', skewed.column, skewed.issue);
  const settled = skewed && skewed.issue.severity === 'fix' && !ignored.includes(issueKey('skewedRows', skewed.column, skewed.issue.value)) ? new Set(names.slice(facts.skew!.skew.at)) : undefined;
  if (facts.dups) add('duplicateRows', undefined, { count: facts.dups, share: facts.dups / facts.rows, examples: [], severity: 'fix', fix: { type: 'duplicateRows', params: { columns: [], keep: 'first' } } });
  const renames = tidyRenames(names, facts.columnNames ?? 'words');
  if (renames.length) add('untidyNames', undefined, { count: renames.length, examples: renames.slice(0, 3).map((r) => r.from), severity: 'fix', fix: { type: 'renameColumns', params: { renames } } });
  const periods = periodColumns(names);
  if (periods.length) {
    const kinds = new Set(periods.map((c) => columnKind(columns.find((x) => x.name === c)!.type)));
    add('wideTable', undefined, { count: periods.length, examples: periods.slice(0, 3), severity: 'suggest', fix: { type: 'unpivot', params: { columns: periods, except: false, attribute: periodKind(periods), value: 'value', keepEmpty: true, asText: kinds.size > 1 } } });
  }
  columns.forEach((c, index) => {
    const column = c.name;
    const p = profile[column];
    const x = facts.columns[column];
    if (!x || settled?.has(column)) return;
    if (!x.nonNull || (x.blank != null && x.blank === x.nonNull)) {
      add('emptyColumn', column, { count: facts.rows, share: 1, examples: [], severity: 'fix', fix: { type: 'removeColumns' } });
      return;
    }
    const share = (n: number) => n / x.nonNull;
    if (facts.rows >= FEW_ROWS && index === 0 && x.seq1 != null && (x.seq1 === facts.rows || x.seq0 === facts.rows)) {
      add('indexColumn', column, { count: facts.rows, share: 1, examples: [], severity: 'suggest', fix: { type: 'removeColumns' } });
      return;
    }
    if (x.mojibake) add('mojibake', column, { count: x.mojibake, share: share(x.mojibake), examples: examples(x.mojibakeEx), severity: 'fix', fix: textOptions?.encoding && !/^utf-?8$/i.test(textOptions.encoding) ? { readOptions: { encoding: 'utf-8' }, label: 'Read the file as UTF-8' } : { type: 'fixMojibake' } });
    if (x.nonPrinting) add('nonPrinting', column, { count: x.nonPrinting, share: share(x.nonPrinting), examples: examples(x.nonPrintingEx), severity: 'fix', fix: { type: 'removeNonPrinting' } });
    if (x.edges) add('edgeSpaces', column, { count: x.edges, share: share(x.edges), examples: examples(x.edgesEx), severity: 'fix', fix: { type: 'trimWhitespace' } });
    if (x.doubled) add('doubleSpaces', column, { count: x.doubled, share: share(x.doubled), examples: examples(x.doubledEx), severity: 'fix', fix: { type: 'collapseSpaces' } });
    if (x.blank) add('emptyText', column, { count: x.blank, share: share(x.blank), examples: [], severity: 'fix', fix: { type: 'emptyToNull' } });
    // Placeholders for empty: the known words, and the one word in a column that is otherwise numbers.
    const placeholders = [...(x.placeholdersEx ?? [])];
    let placeholderCount = x.placeholders ?? 0;
    let looks = isText(c) && p?.looksLike && p.looksLike.share >= LOOKS_LIKE_SHARE ? p.looksLike : undefined;
    // A word, not a mark such as the asterisk of a total row (Total rows deals with that), and not the column's own
    // name (a header pasted in again, which Header row repeated deals with).
    const lone = x.nonNumbersEx?.length === 1 ? x.nonNumbersEx[0]! : undefined;
    if (looks?.kind === 'numbers' && lone && x.nonNumbers && /\p{L}/u.test(lone) && lone.toLowerCase() !== column.trim().toLowerCase()) {
      placeholders.push(lone);
      placeholderCount += x.nonNumbers;
      // With that word read as empty, the column is numbers throughout.
      looks = { kind: 'numbers', share: 1 };
    }
    if (placeholderCount) add('placeholders', column, { count: placeholderCount, share: share(placeholderCount), examples: placeholders.slice(0, 3), severity: 'fix', fix: placeholderFix(placeholders, textOptions) });
    const real = x.values?.filter((v) => !placeholders.some((ph) => ph.toLowerCase() === v.toLowerCase())) ?? [];
    if (x.values) {
      const groups = caseVariants(real);
      if (groups.length) add('mixedCase', column, { count: groups.reduce((n, g) => n + g.length, 0), examples: groups[0]!.slice(0, 3), severity: 'fix', fix: { type: 'changeCase', params: { mode: commonCase(groups) } } });
      const pair = booleanPair(real);
      if (pair) add('booleansAsText', column, { count: x.nonNull - placeholderCount, share: 1, examples: pair.pair, severity: pair.severity, fix: { type: 'changeType', params: { to: 'boolean', onError: 'empty' } } });
      for (const near of nearDuplicates((x.valueCounts ?? []).filter((v) => real.includes(v.value)))) {
        add('nearDuplicate', column, { value: near.value, count: near.count, share: share(near.count), examples: [near.value, near.target], severity: 'suggest', fix: { type: 'replaceValues', params: { match: 'value', find: near.value, replace: near.target, replaceWithNull: false, matchCase: false, toText: false } } });
      }
    }
    const serial = x.whole != null && x.whole === x.nonNull && x.min != null && x.max != null && DATE_NAME.test(lowerName(column)) ? serialDateFormat(x.min, x.max) : undefined;
    if (serial) add('serialDates', column, { count: x.nonNull, share: 1, examples: [String(x.min), String(x.max)], severity: 'suggest', fix: { type: 'parseDates', params: { formats: [serial] } } });
    if (isText(c)) {
      const n = x.nonNull - placeholderCount;
      if (looks && !serial) {
        const whole = looks.share >= 1;
        // The lowest and highest values, leaving out a header pasted in again (the column's own name sorts last among dates).
        const ex = [p?.min, p?.max].filter((v): v is string => v != null && v.toLowerCase() !== column.toLowerCase());
        if (looks.kind === 'numbers') add('numbersAsText', column, { count: Math.round(looks.share * n), share: looks.share, examples: ex, severity: whole ? 'fix' : 'suggest', fix: { type: 'parseNumbers', ...decimalParams(x) } });
        else add('datesAsText', column, { count: Math.round(looks.share * n), share: looks.share, examples: ex, severity: whole ? 'fix' : 'suggest', fix: { type: 'parseDates' } });
      } else if (p?.partly && !serial) {
        const numbers = p.partly.kind === 'numbers';
        add('mixedTypes', column, { count: Math.round((1 - p.partly.share) * n), share: 1 - p.partly.share, examples: examples(numbers ? x.nonNumbersEx : x.nonDatesEx), severity: 'suggest', fix: numbers ? { type: 'parseNumbers', ...decimalParams(x) } : { type: 'parseDates' } });
      } else if (x.keyValues && x.keyValues >= n * LOOKS_LIKE_SHARE && x.keyValueSep) {
        const sep = x.keyValueSep === '=' ? 'equals' : 'colon';
        const into = [`${column} key`, `${column} value`];
        // Split at the first sign, then trim the parts: "Total: 1,234" leaves a space before the value.
        const split: StepFix = { type: 'splitByDelimiter', params: { column, delimiterKind: sep, delimiter: '', at: 'left', to: 'columns', quote: '', into, keepOriginal: false } };
        add('keyValue', column, { count: x.keyValues, share: share(x.keyValues), examples: [x.keyValueEx ?? ''].filter(Boolean), severity: 'suggest', fix: { steps: [split, { type: 'trimWhitespace', params: { columns: into } }], label: 'Split by delimiter' } });
      } else if (x.shapes != null && x.shapes >= 2 && x.shapes <= 5 && x.shapesEx?.every((s) => s.includes('9')) && (x.distinct ?? 0) > x.shapes) {
        // The same kind of value written several ways; a safe fix only when the shapes differ by spaces alone.
        const spaceless = new Set(x.shapesEx.map((s) => s.replace(/\s+/g, '')));
        const fix: IssueFix | undefined = spaceless.size === 1 ? { type: 'findReplace', params: { find: ' ', replace: '', regex: false, matchCase: true } } : undefined;
        add('inconsistentShapes', column, { count: x.nonNull - placeholderCount, examples: x.shapesEx.slice(0, 3), severity: fix ? 'suggest' : 'info', ...(fix ? { fix } : {}) });
      }
    }
    if (facts.rows >= FEW_ROWS && x.distinct === 1 && x.nonNull >= 2) add('constantColumn', column, { count: facts.rows, share: 1, examples: [p?.min ?? ''].filter(Boolean), severity: 'info' });
    // Repeated values in an id column, unless they come from rows that repeat entirely (Duplicate rows covers those).
    if (x.mode != null && x.distinct != null && x.distinct < x.nonNull && x.distinct >= x.nonNull / 2 && (facts.dups ?? 0) < x.nonNull - x.distinct) {
      add('idDuplicates', column, { count: x.nonNull - x.distinct, share: share(x.nonNull - x.distinct), examples: [x.mode], severity: 'info' });
    }
  });
  return out;
}
