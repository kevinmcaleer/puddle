// The exact facts behind a node's issues (src/analysis), in one query per node: counts of the ways a text column
// is untidy, with an example or two of each, and how many rows repeat.
import type { Project } from '../model';
import { compile, type Target } from './compile';
import { isPlaceholder, looksLikeDate, looksLikeNumber, MOJIBAKE_PATTERN } from './patterns';
import { ident, str } from './sql';

/** Control characters, zero-width characters, a no-break space and a byte-order mark: the same set Remove non-printing characters strips, plus NBSP. */
export const NON_PRINTING_PATTERN = '[\\x00-\\x1F\\x7F\\x{00A0}\\x{200B}-\\x{200D}\\x{2060}\\x{FEFF}]';

/** What to count on one column. */
export interface AnalysisCheck {
  column: string;
  /**
   * Text facts: spaces at the ends, doubled spaces inside, non-printing characters, blank text, placeholders for
   * empty, values that aren't numbers or dates, the shapes the values take, key: value pairs and mangled text, each
   * with examples.
   */
  text?: boolean;
  /** The distinct values with their counts, for columns with few of them (compileValueCounts). */
  values?: boolean;
  /** The smallest and largest value as a number and how many are whole, for numbers that stand for dates. */
  numeric?: boolean;
  /** How many values equal their row number (from 1 or from 0): an index column. */
  index?: boolean;
  /** The most frequent value, for a column that should be unique. */
  id?: boolean;
}

/** At most this many distinct values are listed per column. */
export const VALUES_LIMIT = 60;

const ROW_NUMBER = '__puddle_rn';

/** SQL for a value's shape: digits as 9, capitals as A, small letters as a, everything else as it is. */
const shapeOf = (trimmed: string) => `regexp_replace(regexp_replace(regexp_replace(${trimmed}, '[0-9]', '9', 'g'), '[A-Z]', 'A', 'g'), '[a-z]', 'a', 'g')`;

/** A key and a value in one cell: a short word or phrase, a colon or equals sign, then something. */
const KEY_VALUE_PATTERN = '^[A-Za-z][^:=]{0,39}[:=]\\s*\\S';

/**
 * One row: `rows`, `dups` (rows that repeat another row entirely, when `all` names the columns), and per check i
 * `nn<i>` non-null values, plus:
 * - for `text`: `edges<i>`, `dbl<i>`, `np<i>` and `blank<i>` counts with `edgesEx<i>`, `dblEx<i>` and `npEx<i>` as the
 *   smallest and largest offending value; `ph<i>` placeholders for empty; `nonNum<i>` values that are neither numbers
 *   nor placeholders; `kv<i>` key: value cells with `kvSep<i>` the sign used and `kvEx<i>` an example; `moji<i>`
 *   mangled values with `mojiEx<i>` examples; `comma<i>` and `point<i>` values ending in a comma or a point and one
 *   or two digits (which decimal mark the numbers use);
 * - for `numeric`: `nmin<i>`, `nmax<i>` and `whole<i>` whole numbers;
 * - for `index`: `seq1<i>` and `seq0<i>` values equal to the row number from 1 and from 0.
 * Nothing here needs the distinct values: those facts come from compileDistinctFacts, one grouped query per column,
 * because dozens of DISTINCT aggregates in one query exhaust the browser's memory.
 */
export function compileAnalysis(project: Project, target: Target, checks: AnalysisCheck[], all: string[] = []): string {
  const parts = ['count(*) AS "rows"'];
  if (all.length) parts.push(`count(*) - count(DISTINCT (${all.map(ident).join(', ')})) AS dups`);
  checks.forEach((c, i) => {
    const col = ident(c.column);
    const text = `CAST(${col} AS VARCHAR)`;
    const trimmed = `trim(${text})`;
    const n = (name: string) => ident(`${name}${i}`);
    const where = (cond: string) => `FILTER (WHERE ${cond})`;
    parts.push(`count(${col}) AS ${n('nn')}`);
    if (c.text) {
      const edges = `${text} <> ${trimmed}`;
      const dbl = `${trimmed} LIKE '%  %'`;
      const np = `regexp_matches(${text}, ${str(NON_PRINTING_PATTERN)})`;
      const blank = `${col} IS NOT NULL AND ${trimmed} = ''`;
      const filled = `${col} IS NOT NULL AND ${trimmed} <> ''`;
      const ph = `${filled} AND ${isPlaceholder(trimmed)}`;
      // A value that is the column's own name is a header pasted in again (compileShape finds those), not a value.
      const real = `${filled} AND NOT ${isPlaceholder(trimmed)} AND lower(${trimmed}) <> ${str(c.column.trim().toLowerCase())}`;
      const nonNum = `${real} AND NOT ${looksLikeNumber(trimmed)}`;
      const kv = `${real} AND regexp_matches(${trimmed}, ${str(KEY_VALUE_PATTERN)})`;
      const moji = `regexp_matches(${text}, ${str(MOJIBAKE_PATTERN)})`;
      parts.push(
        `count(*) ${where(edges)} AS ${n('edges')}`,
        `[min(${text}) ${where(edges)}, max(${text}) ${where(edges)}] AS ${n('edgesEx')}`,
        `count(*) ${where(dbl)} AS ${n('dbl')}`,
        `[min(${text}) ${where(dbl)}, max(${text}) ${where(dbl)}] AS ${n('dblEx')}`,
        `count(*) ${where(np)} AS ${n('np')}`,
        `[min(${text}) ${where(np)}, max(${text}) ${where(np)}] AS ${n('npEx')}`,
        `count(*) ${where(blank)} AS ${n('blank')}`,
        `count(*) ${where(ph)} AS ${n('ph')}`,
        `count(*) ${where(nonNum)} AS ${n('nonNum')}`,
        `count(*) ${where(kv)} AS ${n('kv')}`,
        `max(regexp_extract(${trimmed}, '([:=])', 1)) ${where(kv)} AS ${n('kvSep')}`,
        `min(${trimmed}) ${where(kv)} AS ${n('kvEx')}`,
        `count(*) ${where(moji)} AS ${n('moji')}`,
        `[min(${text}) ${where(moji)}, max(${text}) ${where(moji)}] AS ${n('mojiEx')}`,
        `count(*) ${where(`regexp_matches(${trimmed}, ',\\d{1,2}\\s*[-)]?\\s*([£$€¥]|[A-Z]{3})?$')`)} AS ${n('comma')}`,
        `count(*) ${where(`regexp_matches(${trimmed}, '\\.\\d{1,2}\\s*[-)]?\\s*([£$€¥]|[A-Z]{3})?$')`)} AS ${n('point')}`,
      );
    }
    if (c.numeric) {
      const num = `TRY_CAST(${trimmed} AS DOUBLE)`;
      parts.push(`min(${num}) AS ${n('nmin')}`, `max(${num}) AS ${n('nmax')}`, `count(*) ${where(`${num} = floor(${num})`)} AS ${n('whole')}`);
    }
    if (c.index) {
      const num = `TRY_CAST(${trimmed} AS BIGINT)`;
      parts.push(`count(*) ${where(`${num} = ${ident(ROW_NUMBER)}`)} AS ${n('seq1')}`, `count(*) ${where(`${num} = ${ident(ROW_NUMBER)} - 1`)} AS ${n('seq0')}`);
    }
  });
  const source = checks.some((c) => c.index) ? `SELECT *, row_number() OVER () AS ${ident(ROW_NUMBER)} FROM (${compile(project, target).sql})` : compile(project, target).sql;
  return `SELECT ${parts.join(', ')} FROM (${source})`;
}

/**
 * What a column's distinct values say, one grouped query per column joined with UNION ALL: rows of `c` (the
 * column), `dist` (distinct values), `mode` (the most frequent, as text) and, for text checks, `phEx` the
 * placeholders for empty seen (up to 12), `nonNumEx` and `nonDateEx` a few values that aren't numbers or dates,
 * `shapes` how many shapes the values take (digits as 9, letters as A or a) and `shapesEx` the first few.
 */
export function compileDistinctFacts(project: Project, target: Target, checks: AnalysisCheck[]): string {
  if (!checks.length) throw new RangeError('No columns to look at.');
  const columns = checks.map((c) => {
    const col = ident(c.column);
    const t = 't';
    const few = (expr: string, cond: string, limit: number) => `list_slice(list_sort(list(${expr}) FILTER (WHERE ${cond})), 1, ${limit})`;
    const parts = [`${str(c.column)} AS c`, 'count(*) AS dist', 'arg_max(t, n) AS mode'];
    if (c.text) {
      const filled = `${t} <> ''`;
      const ph = `${filled} AND ${isPlaceholder(t)}`;
      const real = `${filled} AND NOT ${isPlaceholder(t)} AND lower(${t}) <> ${str(c.column.trim().toLowerCase())}`;
      parts.push(
        `${few(t, ph, 12)} AS "phEx"`,
        `${few(t, `${real} AND NOT ${looksLikeNumber(t)}`, 5)} AS "nonNumEx"`,
        `${few(t, `${real} AND NOT ${looksLikeDate(t)}`, 5)} AS "nonDateEx"`,
        `count(DISTINCT ${shapeOf(t)}) FILTER (WHERE ${real}) AS shapes`,
        `list_slice(list_sort(list(DISTINCT ${shapeOf(t)}) FILTER (WHERE ${real})), 1, 6) AS "shapesEx"`,
      );
    } else parts.push('NULL AS "phEx"', 'NULL AS "nonNumEx"', 'NULL AS "nonDateEx"', 'NULL AS shapes', 'NULL AS "shapesEx"');
    return `SELECT ${parts.join(', ')} FROM (SELECT trim(CAST(${col} AS VARCHAR)) AS t, count(*) AS n FROM src WHERE ${col} IS NOT NULL GROUP BY 1)`;
  });
  return `WITH src AS (${compile(project, target).sql}) ${columns.join(' UNION ALL ')}`;
}

/**
 * The distinct values of these columns with how often each occurs, the most frequent first and at most
 * VALUES_LIMIT per column: rows of `c` (the column), `v` (the value, trimmed) and `n`. Empty values are left out.
 */
export function compileValueCounts(project: Project, target: Target, columns: string[]): string {
  if (!columns.length) throw new RangeError('No columns to count.');
  const counts = columns.map((c) => {
    const v = `trim(CAST(${ident(c)} AS VARCHAR))`;
    return `SELECT ${str(c)} AS c, ${v} AS v, count(*) AS n FROM src WHERE ${ident(c)} IS NOT NULL AND ${v} <> '' GROUP BY 2`;
  });
  return `WITH src AS (${compile(project, target).sql}) SELECT c, v, n FROM (${counts.join(' UNION ALL ')}) QUALIFY row_number() OVER (PARTITION BY c ORDER BY n DESC, v) <= ${VALUES_LIMIT} ORDER BY c, n DESC, v`;
}

/**
 * The rows around and inside a table that aren't data (src/analysis/shape.ts), in one query over the node in file
 * order: `rows`; `blank` rows (every column empty); `narrow` rows (only the first column filled: a banner line, a
 * footer, a page break); `separator` rows (a narrow row of one repeated character, `separatorEx` one of them);
 * `header` rows (every named column equal to its own name, a header pasted in again); `total` rows (the first
 * filled of the first three columns starts with "Total", "Sum", "Subtotal" or "*", `totalEx` the words seen and
 * `totalCol` where); `top` leading and `bottom` trailing rows that are blank or narrow, for the skip options.
 */
export function compileShape(project: Project, target: Target, columns: string[]): string {
  const text = (c: string) => `trim(CAST(${ident(c)} AS VARCHAR))`;
  const filled = (c: string) => `coalesce(${text(c)}, '') <> ''`;
  const [first, ...rest] = columns;
  if (!first) return `SELECT 0 AS "rows"`;
  const blank = rest.length ? `NOT (${columns.map(filled).join(' OR ')})` : `NOT ${filled(first)}`;
  const narrow = rest.length ? `${filled(first)} AND NOT (${rest.map(filled).join(' OR ')})` : 'false';
  const separator = `${narrow} AND regexp_matches(${text(first)}, '^(-{3,}|={3,}|_{3,}|\\*{3,}|\\+{3,}|#{3,}|~{3,}|\\.{3,})$')`;
  // Columns DuckDB named itself (column0, column1) say nothing about a header row.
  const named = columns.filter((c) => !/^column\d+$/.test(c));
  const header = named.length >= 2 ? named.map((c) => `${text(c)} = ${str(c)}`).join(' AND ') : 'false';
  const leading = columns.slice(0, 3);
  const firstFilled = `coalesce(${leading.map((c) => `nullif(${text(c)}, '')`).join(', ')})`;
  // RE2 has no backreferences and \b fails after "*", so the words are spelt out, each ending the value or followed by a space or colon.
  const totalWord = `regexp_extract(lower(${firstFilled}), '^(\\*+|grand total|sub ?totals?|totals?|sum)(\\s|:|$)', 1)`;
  const total = `${totalWord} <> ''`;
  const totalCol = `CASE ${leading.map((c) => `WHEN ${filled(c)} THEN ${str(c)}`).join(' ')} END`;
  const flags = `SELECT row_number() OVER () AS rn, ${blank} AS blank, ${narrow} AS narrow, ${separator} AS separator, ${header} AS header, ${total} AS total, ${totalWord} AS word, ${totalCol} AS col, ${text(first)} AS first FROM (${compile(project, target).sql})`;
  return [
    'SELECT count(*) AS "rows"',
    'count(*) FILTER (WHERE blank) AS blank',
    'count(*) FILTER (WHERE narrow AND NOT separator) AS narrow',
    'count(*) FILTER (WHERE separator) AS separator',
    'any_value(first) FILTER (WHERE separator) AS "separatorEx"',
    'count(*) FILTER (WHERE header) AS header',
    'count(*) FILTER (WHERE total AND NOT header) AS total',
    'list(DISTINCT word) FILTER (WHERE total AND NOT header) AS "totalEx"',
    'any_value(col) FILTER (WHERE total AND NOT header) AS "totalCol"',
    'coalesce(min(rn) FILTER (WHERE NOT (blank OR narrow)), count(*) + 1) - 1 AS top',
    'count(*) - coalesce(max(rn) FILTER (WHERE NOT (blank OR narrow)), 0) AS bottom',
    `FROM (${flags})`,
  ].join(', ').replace(', FROM', ' FROM');
}
