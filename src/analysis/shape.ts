// The shape detectors: rows around and inside a table that aren't data (banners, footers, separators, a header
// pasted in again, blank rows, total rows), from one query (compileShape), each with its fix: a read option for the
// top and bottom, a step for the rest.
import type { Condition } from '../compiler/steps/rows';
import type { ParseOptions } from '../model';
import { issueKey, type Issue, type IssueKind } from './issues';

/** compileShape's row, read back. */
export interface ShapeFacts {
  rows: number;
  blank: number;
  narrow: number;
  separator: number;
  separatorEx?: string;
  header: number;
  total: number;
  totalEx: string[];
  totalCol?: string;
  top: number;
  bottom: number;
}

export function parseShape(row: Record<string, unknown>): ShapeFacts {
  const num = (k: string) => (row[k] == null ? 0 : Number(row[k]));
  const words = row.totalEx;
  return {
    rows: num('rows'),
    blank: num('blank'),
    narrow: num('narrow'),
    separator: num('separator'),
    separatorEx: row.separatorEx == null ? undefined : String(row.separatorEx),
    header: num('header'),
    total: num('total'),
    totalEx: words != null && typeof words === 'object' && Symbol.iterator in words ? Array.from(words as Iterable<unknown>).filter((w) => w != null).map(String) : [],
    totalCol: row.totalCol == null ? undefined : String(row.totalCol),
    top: num('top'),
    bottom: num('bottom'),
  };
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * The shape issues of a source read from delimited text: the banner and footer become skip options on the source
 * (`options` are its read options now, so the counts add up); the rest become steps that drop the rows.
 */
export function findShapeIssues(columns: string[], shape: ShapeFacts, options: ParseOptions, ignored: string[] = []): Issue[] {
  const out: Issue[] = [];
  const add = (kind: IssueKind, issue: Omit<Issue, 'key' | 'kind' | 'column'>) => {
    const key = issueKey(kind);
    if (!ignored.includes(key)) out.push({ key, kind, ...issue });
  };
  const [first] = columns;
  if (!first || !shape.rows || shape.rows === shape.top) return out;
  const share = (n: number) => n / shape.rows;
  const filter = (conditions: Condition[], match: 'all' | 'any' = 'all', matchCase = false) => ({ type: 'filterRows', params: { mode: 'remove', match, conditions, matchCase } });

  // Leading narrow rows are a banner only when no header row was taken from the file (a skip would take the header
  // with them otherwise): then the skip option drops them, and the row after is read as the header.
  const unnamed = options.header === false || columns.every((c) => /^column\d+$/.test(c));
  const banner = unnamed ? shape.top : 0;
  if (banner) {
    const skip = (options.skip ?? 0) + banner;
    add('bannerRows', { count: banner, share: share(banner), examples: [], severity: 'fix', fix: { readOptions: { skip }, label: `Skip ${plural(skip, 'line')} at the top` } });
  }
  if (shape.bottom) {
    const skipBottom = (options.skipBottom ?? 0) + shape.bottom;
    add('footerRows', { count: shape.bottom, share: share(shape.bottom), examples: [], severity: 'fix', fix: { readOptions: { skipBottom }, label: `Skip ${plural(skipBottom, 'row')} at the bottom` } });
  }
  if (shape.header) {
    const named = columns.filter((c) => !/^column\d+$/.test(c)).slice(0, 2);
    add('repeatedHeader', { count: shape.header, share: share(shape.header), examples: named, severity: 'fix', fix: filter(named.map((c) => ({ column: c, op: 'equals', value: c })), 'all', true) });
  }
  // Separators and other narrow rows inside the table (page breaks, a banner on page two) go together, since the
  // banner and footer ones leave with the skip options. (Blank rows are counted apart; a wholly blank row is never
  // narrow, so the counts don't overlap.)
  const inside = shape.separator + shape.narrow - banner - shape.bottom;
  if (inside > 0) {
    const rest = columns.slice(1);
    add('narrowRows', {
      count: inside,
      share: share(inside),
      examples: shape.separatorEx ? [shape.separatorEx.slice(0, 12)] : [],
      severity: 'fix',
      fix: rest.length ? filter(rest.map((c) => ({ column: c, op: 'empty', value: '' }))) : undefined,
    });
  }
  if (shape.blank) add('blankRows', { count: shape.blank, share: share(shape.blank), examples: [], severity: 'fix', fix: { type: 'removeBlankRows', params: { columns: [] } } });
  if (shape.total && shape.totalCol) {
    const words = shape.totalEx.length ? shape.totalEx : ['total'];
    add('totalRows', { count: shape.total, share: share(shape.total), examples: words, severity: 'suggest', fix: filter(words.map((w) => ({ column: shape.totalCol!, op: 'startsWith', value: w })), 'any') });
  }
  return out;
}
