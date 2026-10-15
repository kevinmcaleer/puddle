// The Rows step group: filter, sort, remove top or bottom rows, remove blank rows, duplicates, fill, promote headers.
import { z } from 'zod';
import { ident, list, num, str } from '../sql';
import { defineStep } from './registry';

const Columns = z.array(z.string().min(1)).min(1, 'pick at least one column');
/** Columns, where none means every column. */
const AnyColumns = z.array(z.string().min(1)).default([]);

const names = (cols: string[]) => cols.join(', ');
const ROW = ident('__puddle_row');
const KEY = ident('__puddle_key');

/** The input with its file order as a column, so order-sensitive steps can sort back to it. */
const numbered = (input: string) => `(SELECT row_number() OVER () AS ${ROW}, * FROM ${input})`;

/** Text that's empty once trimmed counts as blank, like a null. */
const blank = (expr: string) => `coalesce(trim(CAST(${expr} AS VARCHAR)), '') = ''`;

export const FILTER_OPS = {
  equals: 'is',
  notEquals: 'is not',
  contains: 'contains',
  notContains: 'does not contain',
  startsWith: 'starts with',
  endsWith: 'ends with',
  greater: 'is more than',
  greaterOrEqual: 'is at least',
  less: 'is less than',
  lessOrEqual: 'is at most',
  empty: 'is empty',
  notEmpty: 'is not empty',
} as const;
export type FilterOp = keyof typeof FILTER_OPS;
const NO_VALUE: FilterOp[] = ['empty', 'notEmpty'];

const Condition = z
  .object({ column: z.string().min(1, 'pick a column'), op: z.enum(Object.keys(FILTER_OPS) as [FilterOp, ...FilterOp[]]), value: z.string().default('') })
  .refine((c) => NO_VALUE.includes(c.op) || c.value !== '', { path: ['value'], message: 'give a value to compare with' });
type Condition = z.infer<typeof Condition>;

/** One condition as SQL. Text comparisons ignore case unless asked; values are cast to the column's type by DuckDB. */
function condition(c: Condition, matchCase: boolean): string {
  const col = ident(c.column);
  const text = matchCase ? `CAST(${col} AS VARCHAR)` : `lower(CAST(${col} AS VARCHAR))`;
  const v = str(matchCase ? c.value : c.value.toLowerCase());
  switch (c.op) {
    case 'equals':
      return `${text} = ${v}`;
    case 'notEquals':
      return `${text} IS DISTINCT FROM ${v}`;
    case 'contains':
      return `contains(${text}, ${v})`;
    case 'notContains':
      return `NOT coalesce(contains(${text}, ${v}), false)`;
    case 'startsWith':
      return `starts_with(${text}, ${v})`;
    case 'endsWith':
      return `ends_with(${text}, ${v})`;
    case 'greater':
      return `${col} > ${str(c.value)}`;
    case 'greaterOrEqual':
      return `${col} >= ${str(c.value)}`;
    case 'less':
      return `${col} < ${str(c.value)}`;
    case 'lessOrEqual':
      return `${col} <= ${str(c.value)}`;
    case 'empty':
      return blank(col);
    case 'notEmpty':
      return `NOT (${blank(col)})`;
  }
}

export const filterRows = defineStep({
  type: 'filterRows',
  params: z.object({
    mode: z.enum(['keep', 'remove']).default('keep'),
    match: z.enum(['all', 'any']).default('all'),
    conditions: z.array(Condition).min(1, 'add a condition'),
    matchCase: z.boolean().default(false),
  }),
  label: (p) => {
    const c = p.conditions[0]!;
    const what = p.conditions.length === 1 ? `where ${c.column} ${FILTER_OPS[c.op]}${NO_VALUE.includes(c.op) ? '' : ` ${c.value}`}` : `matching ${p.match} of ${p.conditions.length} conditions`;
    return `${p.mode === 'keep' ? 'Kept' : 'Removed'} rows ${what}`;
  },
  compile: (p, { input }) => {
    const where = p.conditions.map((c) => `(${condition(c, p.matchCase)})`).join(p.match === 'all' ? ' AND ' : ' OR ');
    // A condition on an empty value is unknown; unknown rows are not kept, and not removed either.
    return `SELECT * FROM ${input} WHERE ${p.mode === 'keep' ? `coalesce(${where}, false)` : `NOT coalesce(${where}, false)`}`;
  },
});

export const sortRows = defineStep({
  type: 'sortRows',
  params: z.object({ keys: z.array(z.object({ column: z.string().min(1, 'pick a column'), descending: z.boolean().default(false) })).min(1, 'add a column to sort by') }),
  label: (p) => `Sorted by ${p.keys.map((k) => `${k.column}${k.descending ? ' (descending)' : ''}`).join(', ')}`,
  // Ties keep their file order; empty values go last either way.
  compile: (p, { input }) =>
    `SELECT * EXCLUDE (${ROW}) FROM ${numbered(input)} ORDER BY ${list(p.keys.map((k) => `${ident(k.column)} ${k.descending ? 'DESC' : 'ASC'} NULLS LAST`))}, ${ROW}`,
});

export const removeRows = defineStep({
  type: 'removeRows',
  params: z.object({ from: z.enum(['top', 'bottom']), count: z.number().int().positive('remove at least one row') }),
  label: (p) => `Removed ${p.from} ${p.count} ${p.count === 1 ? 'row' : 'rows'}`,
  compile: (p, { input }) =>
    p.from === 'top'
      ? `SELECT * FROM ${input} OFFSET ${num(p.count)}`
      : `SELECT * FROM ${input} LIMIT greatest((SELECT count(*) FROM ${input}) - ${num(p.count)}, 0)`,
});

export const removeBlankRows = defineStep({
  type: 'removeBlankRows',
  params: z.object({ columns: AnyColumns }),
  label: (p) => (p.columns.length ? `Removed rows with ${names(p.columns)} blank` : 'Removed blank rows'),
  // A row goes when every column checked is empty or only spaces.
  compile: (p, { input }) => {
    const cols = p.columns.length ? list(p.columns.map((c) => `CAST(${ident(c)} AS VARCHAR)`)) : '*COLUMNS(*)';
    return `SELECT * FROM ${input} WHERE coalesce(trim(concat_ws('', ${cols})), '') <> ''`;
  },
});

export const duplicateRows = defineStep({
  type: 'duplicateRows',
  params: z.object({ columns: AnyColumns, keep: z.enum(['first', 'duplicates']).default('first') }),
  label: (p) => {
    const by = p.columns.length ? ` by ${names(p.columns)}` : '';
    return p.keep === 'first' ? `Removed duplicate rows${by}` : `Kept only duplicate rows${by}`;
  },
  compile: (p, { input }) => {
    const key = p.columns.length ? `row(${list(p.columns.map(ident))})` : 'row(*COLUMNS(*))';
    const keep = p.keep === 'first' ? `row_number() OVER (PARTITION BY ${KEY} ORDER BY ${ROW}) = 1` : `count(*) OVER (PARTITION BY ${KEY}) > 1`;
    return `SELECT * EXCLUDE (${ROW}, ${KEY}) FROM (SELECT row_number() OVER () AS ${ROW}, ${key} AS ${KEY}, * FROM ${input}) QUALIFY ${keep} ORDER BY ${ROW}`;
  },
});

export const fillRows = defineStep({
  type: 'fillRows',
  params: z.object({ columns: Columns, direction: z.enum(['down', 'up']).default('down') }),
  label: (p) => `Filled ${names(p.columns)} ${p.direction}`,
  compile: (p, { input }) => {
    const frame = p.direction === 'down' ? 'ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW' : 'ROWS BETWEEN CURRENT ROW AND UNBOUNDED FOLLOWING';
    const fn = p.direction === 'down' ? 'last_value' : 'first_value';
    const fills = p.columns.map((c) => `${fn}(${ident(c)} IGNORE NULLS) OVER (ORDER BY ${ROW} ${frame}) AS ${ident(c)}`);
    return `SELECT * EXCLUDE (${ROW}) REPLACE (${list(fills)}) FROM ${numbered(input)} ORDER BY ${ROW}`;
  },
});

export const promoteHeaders = defineStep({
  type: 'promoteHeaders',
  params: z.object({
    /** Each column's new name, read from the first row when the step was added. */
    renames: z.array(z.object({ from: z.string().min(1), to: z.string().trim().min(1, 'name every column') })).min(1, 'there are no columns to rename'),
  }),
  label: () => 'Promoted the first row to headers',
  compile: (p, { input }) => {
    const changed = p.renames.filter((r) => r.from !== r.to);
    const select = changed.length ? `* RENAME (${list(changed.map((r) => `${ident(r.from)} AS ${ident(r.to)}`))})` : '*';
    return `SELECT ${select} FROM ${input} OFFSET 1`;
  },
});

/** New column names from a first row: blanks keep the old name, repeats get _2, _3. */
export function headerNames(columns: string[], firstRow: Record<string, unknown>): { from: string; to: string }[] {
  const used = new Set<string>();
  return columns.map((from) => {
    const raw = firstRow[from];
    const base = raw == null || String(raw).trim() === '' ? from : String(raw).trim();
    let to = base;
    for (let i = 2; used.has(to); i++) to = `${base}_${i}`;
    used.add(to);
    return { from, to };
  });
}
