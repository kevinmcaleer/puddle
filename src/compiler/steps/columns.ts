// The Columns step group: reorder, change type, split, merge, add index, duplicate, add from expression.
// Rename and remove live in basic.ts with the other foundation steps.
import { z } from 'zod';
import { ident, list, num, str } from '../sql';
import { defineStep } from './registry';

const Column = z.string().min(1, 'pick a column');
const Columns = z.array(z.string().min(1)).min(1, 'pick at least one column');
const Name = z.string().trim().min(1, 'give the new column a name');
const Names = z.array(z.string().trim().min(1, 'name every new column')).min(1, 'name at least one new column');

const names = (cols: string[]) => cols.join(', ');

/** Column types a step can convert to, by the word people use for them. */
export const COLUMN_TYPES = {
  text: 'VARCHAR',
  integer: 'BIGINT',
  decimal: 'DOUBLE',
  boolean: 'BOOLEAN',
  date: 'DATE',
  timestamp: 'TIMESTAMP',
} as const;
export type ColumnTypeName = keyof typeof COLUMN_TYPES;

export const reorderColumns = defineStep({
  type: 'reorderColumns',
  params: z.object({ columns: Columns }),
  label: (p) => `Moved ${names(p.columns)} to the front`,
  compile: (p, { input }) => `SELECT ${list(p.columns.map(ident))}, * EXCLUDE (${list(p.columns.map(ident))}) FROM ${input}`,
});

export const changeType = defineStep({
  type: 'changeType',
  params: z.object({
    columns: Columns,
    to: z.enum(Object.keys(COLUMN_TYPES) as [ColumnTypeName, ...ColumnTypeName[]]),
    /** Values that don't convert become empty, or stop the flow with an error. */
    onError: z.enum(['empty', 'fail']).default('empty'),
  }),
  label: (p) => `Changed ${names(p.columns)} to ${p.to}`,
  compile: (p, { input }) => {
    const cast = p.onError === 'fail' ? 'CAST' : 'TRY_CAST';
    return `SELECT * REPLACE (${list(p.columns.map((c) => `${cast}(${ident(c)} AS ${COLUMN_TYPES[p.to]}) AS ${ident(c)}`))}) FROM ${input}`;
  },
});

/** The input's columns, without `drop` when it should go. */
const keep = (drop: string[], keepOriginal: boolean) => (keepOriginal ? '*' : `* EXCLUDE (${list(drop.map(ident))})`);

export const splitByDelimiter = defineStep({
  type: 'splitByDelimiter',
  params: z.object({ column: Column, delimiter: z.string().min(1, 'give the delimiter'), into: Names, keepOriginal: z.boolean().default(false) }),
  label: (p) => `Split ${p.column} on ${JSON.stringify(p.delimiter)}`,
  compile: (p, { input }) => {
    // DuckDB lists count from 1; a missing part is empty.
    const parts = p.into.map((n, i) => `string_split(CAST(${ident(p.column)} AS VARCHAR), ${str(p.delimiter)})[${num(i + 1)}] AS ${ident(n)}`);
    return `SELECT ${keep([p.column], p.keepOriginal)}, ${list(parts)} FROM ${input}`;
  },
});

export const splitByPosition = defineStep({
  type: 'splitByPosition',
  params: z
    .object({
      column: Column,
      /** Split after these character counts, e.g. [3] makes "ABC123" into "ABC" and "123". */
      positions: z.array(z.number().int().positive('positions count from 1')).min(1, 'give at least one position'),
      into: Names,
      keepOriginal: z.boolean().default(false),
    })
    .refine((p) => p.positions.every((x, i) => i === 0 || x > p.positions[i - 1]!), { path: ['positions'], message: 'list positions from smallest to largest' })
    .refine((p) => p.into.length === p.positions.length + 1, { path: ['into'], message: 'name one more column than there are positions' }),
  label: (p) => `Split ${p.column} at ${p.positions.join(', ')}`,
  compile: (p, { input }) => {
    const col = `CAST(${ident(p.column)} AS VARCHAR)`;
    const parts = p.into.map((n, i) => {
      const start = i === 0 ? 1 : p.positions[i - 1]! + 1;
      const end = p.positions[i];
      const expr = end == null ? `substr(${col}, ${num(start)})` : `substr(${col}, ${num(start)}, ${num(end - start + 1)})`;
      return `${expr} AS ${ident(n)}`;
    });
    return `SELECT ${keep([p.column], p.keepOriginal)}, ${list(parts)} FROM ${input}`;
  },
});

export const mergeColumns = defineStep({
  type: 'mergeColumns',
  params: z.object({
    columns: z.array(z.string().min(1)).min(2, 'pick at least two columns'),
    separator: z.string().default(' '),
    into: Name,
    keepOriginals: z.boolean().default(false),
  }),
  label: (p) => `Merged ${names(p.columns)} into ${p.into}`,
  // concat_ws skips empty values, so "Ada" and nothing merge to "Ada", not "Ada ".
  compile: (p, { input }) =>
    `SELECT ${keep(p.columns, p.keepOriginals)}, concat_ws(${str(p.separator)}, ${list(p.columns.map((c) => `CAST(${ident(c)} AS VARCHAR)`))}) AS ${ident(p.into)} FROM ${input}`,
});

export const addIndex = defineStep({
  type: 'addIndex',
  params: z.object({ name: Name, start: z.number().int().default(1) }),
  label: (p) => `Added index ${p.name}`,
  compile: (p, { input }) => {
    const offset = p.start - 1;
    const n = offset === 0 ? 'row_number() OVER ()' : `row_number() OVER () ${offset > 0 ? '+' : '-'} ${num(Math.abs(offset))}`;
    return `SELECT ${n} AS ${ident(p.name)}, * FROM ${input}`;
  },
});

export const duplicateColumn = defineStep({
  type: 'duplicateColumn',
  params: z.object({ column: Column, into: Name }),
  label: (p) => `Duplicated ${p.column} as ${p.into}`,
  compile: (p, { input }) => `SELECT *, ${ident(p.column)} AS ${ident(p.into)} FROM ${input}`,
});

/**
 * Refuse what could end the expression early: a statement separator, or a comment that would hide the rest
 * of the query. Strings and quoted names are skipped, so ';' inside 'a;b' is fine.
 */
export function expressionProblem(expr: string): string | undefined {
  const outside = expr.replace(/'(?:[^']|'')*'|"(?:[^"]|"")*"/g, '');
  if (/'|"/.test(outside)) return 'close the quote';
  if (outside.includes(';')) return 'use one expression, without ;';
  if (outside.includes('--') || outside.includes('/*')) return 'leave out comments';
  return undefined;
}

export const addColumn = defineStep({
  type: 'addColumn',
  params: z.object({
    name: Name,
    expression: z
      .string()
      .trim()
      .min(1, 'write an expression')
      .superRefine((e, ctx) => {
        const problem = expressionProblem(e);
        if (problem) ctx.addIssue({ code: 'custom', message: problem });
      }),
  }),
  label: (p) => `Added ${p.name}`,
  compile: (p, { input }) => `SELECT *, (${p.expression}) AS ${ident(p.name)} FROM ${input}`,
});
