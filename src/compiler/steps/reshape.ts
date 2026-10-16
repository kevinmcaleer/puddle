// The Reshape step group: pivot and group by.
import { z } from 'zod';
import { ident, list, str } from '../sql';
import { defineStep } from './registry';
import { condition, Condition } from './rows';

/** How a Values field is summarised, with the word its default column name uses. */
export const AGGREGATES = {
  sum: 'sum',
  count: 'count',
  countDistinct: 'count distinct',
  min: 'min',
  max: 'max',
  average: 'average',
  median: 'median',
  first: 'first',
  last: 'last',
  list: 'list',
} as const;
export type Aggregate = keyof typeof AGGREGATES;

/** The most values a Columns field may turn into columns. More are read as a warning, not columns. */
export const MAX_PIVOT_VALUES = 200;

const ROW = ident('__puddle_row');
const PIVOT = ident('__puddle_pivot');
const valueCol = (j: number) => ident(`__puddle_v${j}`);
/** Order-sensitive aggregates read the file order, so first, last and list don't depend on how DuckDB scans. */
const ORDERED: Aggregate[] = ['first', 'last', 'list'];

const PivotValue = z.object({ column: z.string().min(1, 'pick a column'), agg: z.enum(Object.keys(AGGREGATES) as [Aggregate, ...Aggregate[]]) });
export type PivotValue = z.infer<typeof PivotValue>;

const PivotShape = z.object({
  /** Group columns, in order. */
  rows: z.array(z.string().min(1)).default([]),
  /** The column whose values become columns; empty for a group by. */
  column: z.string().default(''),
  /** The values of `column` that become columns, read when the step was set up, so its schema stays put. */
  pivotValues: z.array(z.string()).max(MAX_PIVOT_VALUES, `only ${MAX_PIVOT_VALUES} values can become columns`).default([]),
  /** Whether `column` had more values than became columns when they were read. */
  moreValues: z.boolean().default(false),
  values: z.array(PivotValue).default([]),
  /** Conditions every row must meet before pivoting. */
  filters: z.array(Condition).default([]),
  /** Output names chosen by the user, keyed by the default name. */
  names: z.record(z.string(), z.string()).default({}),
});
export type PivotParams = z.infer<typeof PivotShape>;

/** A Values field's default name, e.g. "sum of total". */
export const valueName = (v: PivotValue) => `${AGGREGATES[v.agg]} of ${v.column}`;
/** How a pivot value reads in a column name: an empty text value would vanish. */
const shownValue = (value: string) => (value === '' ? '(empty)' : value);

export interface PivotOutput {
  /** The readable name the column gets unless renamed, e.g. "2024-01 sum of total". */
  defaultName: string;
  name: string;
  /** Which pivot value (undefined for a group by) and which Values field it holds. */
  pivot?: number;
  value: number;
}

/** The summary columns the step makes, after its Rows columns, in order: by pivot value, then by Values field. */
export function pivotOutputs(p: Pick<PivotParams, 'column' | 'pivotValues' | 'values' | 'names'>): PivotOutput[] {
  const named = (defaultName: string) => p.names[defaultName]?.trim() || defaultName;
  if (!p.column) return p.values.map((v, j) => ({ defaultName: valueName(v), name: named(valueName(v)), value: j }));
  return p.pivotValues.flatMap((pv, i) =>
    p.values.map((v, j) => {
      const defaultName = `${shownValue(pv)} ${valueName(v)}`;
      return { defaultName, name: named(defaultName), pivot: i, value: j };
    }),
  );
}

const sameName = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

function checkPivot(p: PivotParams, ctx: z.RefinementCtx) {
  const issue = (path: string, message: string) => ctx.addIssue({ code: 'custom', path: [path], message });
  if (!p.rows.length && !p.values.length) issue('rows', 'drag a column to Rows or Values');
  const twice = p.rows.find((r, i) => p.rows.indexOf(r) !== i);
  if (twice) issue('rows', `Rows has ${twice} twice`);
  if (p.column && p.rows.includes(p.column)) issue('column', `Rows and Columns can’t both have ${p.column}: take it out of one`);
  if (p.column && !p.values.length) issue('values', 'drag a column to Values to fill the new columns');
  if (p.column && !p.pivotValues.length) issue('column', `no values of ${p.column} to make columns from: refresh columns to read them`);
  const repeated = p.values.find((v, i) => p.values.findIndex((w) => w.column === v.column && w.agg === v.agg) !== i);
  if (repeated) issue('values', `Values has ${valueName(repeated)} twice`);
  if (twice || repeated || (p.column && !p.pivotValues.length)) return;
  // DuckDB column names ignore case, so names that differ only in case would clash.
  const names = [...p.rows, ...pivotOutputs(p).map((o) => o.name)];
  const clash = names.find((n, i) => names.findIndex((m) => sameName(m, n)) !== i);
  if (clash) issue('names', `two columns would be called ${clash}: rename one`);
}

const PivotParamsSchema = PivotShape.superRefine(checkPivot);

/** The aggregate over the column `x`, with `row` the file order where it matters. */
function aggregate(agg: Aggregate, x: string): string {
  // Rows with no value don't count as first or last: their order is null, which arg_min and arg_max skip.
  const order = `CASE WHEN ${x} IS NULL THEN NULL ELSE ${ROW} END`;
  switch (agg) {
    case 'sum':
      return `sum(${x})`;
    case 'count':
      return `count(${x})`;
    case 'countDistinct':
      return `count(DISTINCT ${x})`;
    case 'min':
      return `min(${x})`;
    case 'max':
      return `max(${x})`;
    case 'average':
      return `avg(${x})`;
    case 'median':
      return `median(${x})`;
    case 'first':
      return `arg_min(${x}, ${order})`;
    case 'last':
      return `arg_max(${x}, ${order})`;
    case 'list':
      return `string_agg(CAST(${x} AS VARCHAR), ', ' ORDER BY ${ROW})`;
  }
}

/** The step's input with its filters applied. */
export function filteredInput(p: Pick<PivotParams, 'filters'>, input: string): string {
  if (!p.filters.length) return input;
  const where = p.filters.map((c) => `(${condition(c, false)})`).join(' AND ');
  return `(SELECT * FROM ${input} WHERE coalesce(${where}, false))`;
}

/**
 * The distinct values of the Columns field after the filters, as text and in the column's own order, one more
 * than can become columns so the editor can tell when there are too many. Empty values are left out.
 */
export function pivotValuesQuery(p: Pick<PivotParams, 'column' | 'filters'>, input: string): string {
  const col = ident(p.column);
  return `SELECT CAST(${col} AS VARCHAR) AS v FROM ${filteredInput(p, input)} WHERE ${col} IS NOT NULL GROUP BY ${col} ORDER BY ${col} LIMIT ${MAX_PIVOT_VALUES + 1}`;
}

function compilePivot(p: PivotParams, input: string): string {
  const rows = p.rows.map(ident);
  const outs = pivotOutputs(p);
  const ordered = p.values.some((v) => ORDERED.includes(v.agg));
  const order = rows.length ? `\nORDER BY ${list(rows.map((r) => `${r} ASC NULLS LAST`))}` : '';
  const source = ordered ? `(SELECT *, row_number() OVER () AS ${ROW} FROM ${filteredInput(p, input)})` : filteredInput(p, input);

  if (!p.column) {
    const aggs = outs.map((o) => `${aggregate(p.values[o.value]!.agg, ident(p.values[o.value]!.column))} AS ${ident(o.name)}`);
    return `SELECT ${list([...rows, ...aggs])} FROM ${source}${rows.length ? ` GROUP BY ${list(rows)}` : ''}${order}`;
  }

  // PIVOT groups by every column it isn't told about, so its input has only the rows, the pivot column and the
  // values, under names that can't clash with the user's. The file order is used only inside USING.
  const inner = [...rows, `CAST(${ident(p.column)} AS VARCHAR) AS ${PIVOT}`, ...p.values.map((v, j) => `${ident(v.column)} AS ${valueCol(j)}`), ...(ordered ? [ROW] : [])];
  const on = p.pivotValues.map((v, i) => `${str(v)} AS ${ident(`__puddle_p${i}`)}`);
  const using = p.values.map((v, j) => `${aggregate(v.agg, valueCol(j))} AS ${ident(`v${j}`)}`);
  const picked = outs.map((o) => `${ident(`__puddle_p${o.pivot}_v${o.value}`)} AS ${ident(o.name)}`);
  return [
    `SELECT ${list([...rows, ...picked])} FROM (`,
    `  PIVOT (SELECT ${list(inner)} FROM ${source})`,
    `  ON ${PIVOT} IN (${list(on)})`,
    `  USING ${list(using)}${rows.length ? `\n  GROUP BY ${list(rows)}` : ''}`,
    `)${order}`,
  ].join('\n');
}

export const pivot = defineStep({
  type: 'pivot',
  params: PivotParamsSchema,
  label: (p) => {
    const by = p.rows.length ? ` by ${p.rows.join(', ')}` : '';
    if (p.column) return `Pivoted ${p.column} into columns${by}`;
    if (p.rows.length) return `Grouped${by}`;
    return `Summarised ${[...new Set(p.values.map((v) => v.column))].join(', ')}`;
  },
  compile: (p, { input }) => compilePivot(p, input),
});
