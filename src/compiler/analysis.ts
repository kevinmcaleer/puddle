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
