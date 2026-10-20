// The exact facts behind a node's issues (src/analysis), in one query per node: counts of the ways a text column
// is untidy, with an example or two of each, and how many rows repeat.
import type { Project } from '../model';
import { compile, type Target } from './compile';
import { ident, str } from './sql';

/** Control characters, zero-width characters, a no-break space and a byte-order mark: the same set Remove non-printing characters strips, plus NBSP. */
export const NON_PRINTING_PATTERN = '[\\x00-\\x1F\\x7F\\x{00A0}\\x{200B}-\\x{200D}\\x{2060}\\x{FEFF}]';

/** What to count on one column. */
export interface AnalysisCheck {
  column: string;
  /** Spaces at the ends, doubled spaces inside (the ends aside), non-printing characters and blank text, each with two examples. */
  text?: boolean;
  /** The distinct values, trimmed, for columns with few of them: mixed capitals are found among them. */
  values?: boolean;
}

/** At most this many distinct values are listed per column. */
export const VALUES_LIMIT = 60;

/**
 * One row: `rows`, `dups` (rows that repeat another row entirely, when `all` names the columns), and per check i
 * `nn<i>` non-null values plus, for `text`, `edges<i>`, `dbl<i>`, `np<i>` and `blank<i>` counts with `edgesEx<i>`,
 * `dblEx<i>` and `npEx<i>` as the smallest and largest offending value, and for `values`, `vals<i>` as a list.
 */
export function compileAnalysis(project: Project, target: Target, checks: AnalysisCheck[], all: string[] = []): string {
  const parts = ['count(*) AS "rows"'];
  if (all.length) parts.push(`count(*) - count(DISTINCT (${all.map(ident).join(', ')})) AS dups`);
  checks.forEach((c, i) => {
    const col = ident(c.column);
    const text = `CAST(${col} AS VARCHAR)`;
    const n = (name: string) => ident(`${name}${i}`);
    parts.push(`count(${col}) AS ${n('nn')}`);
    if (c.text) {
      const where = (cond: string) => `FILTER (WHERE ${cond})`;
      const edges = `${text} <> trim(${text})`;
      const dbl = `trim(${text}) LIKE '%  %'`;
      const np = `regexp_matches(${text}, ${str(NON_PRINTING_PATTERN)})`;
      const blank = `${col} IS NOT NULL AND trim(${text}) = ''`;
      parts.push(
        `count(*) ${where(edges)} AS ${n('edges')}`,
        `[min(${text}) ${where(edges)}, max(${text}) ${where(edges)}] AS ${n('edgesEx')}`,
        `count(*) ${where(dbl)} AS ${n('dbl')}`,
        `[min(${text}) ${where(dbl)}, max(${text}) ${where(dbl)}] AS ${n('dblEx')}`,
        `count(*) ${where(np)} AS ${n('np')}`,
        `[min(${text}) ${where(np)}, max(${text}) ${where(np)}] AS ${n('npEx')}`,
        `count(*) ${where(blank)} AS ${n('blank')}`,
      );
    }
    if (c.values) parts.push(`list_slice(list_sort(list(DISTINCT trim(${text})) FILTER (WHERE ${col} IS NOT NULL)), 1, ${VALUES_LIMIT}) AS ${n('vals')}`);
  });
  return `SELECT ${parts.join(', ')} FROM (${compile(project, target).sql})`;
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
