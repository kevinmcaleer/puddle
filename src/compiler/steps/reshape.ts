// The Reshape step group: pivot and group by, unpivot, transpose.
import { z } from 'zod';
import { ident, list, num, stepFailure, str, strList } from '../sql';
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
  stddev: 'standard deviation',
  variance: 'variance',
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
    case 'stddev':
      return `stddev_samp(${x})`;
    case 'variance':
      return `var_samp(${x})`;
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

const NewName = (what: string) => z.string().trim().min(1, `name the ${what} column`);

const UnpivotShape = z.object({
  /** The columns to unpivot, or with `except` the columns to keep as they are. */
  columns: z.array(z.string().min(1)).min(1, 'pick at least one column'),
  except: z.boolean().default(false),
  /** The new column holding each unpivoted column's name. */
  attribute: NewName('attribute').default('attribute'),
  /** The new column holding its value. */
  value: NewName('value').default('value'),
  /** Keep rows whose value is empty, which UNPIVOT leaves out otherwise. */
  keepEmpty: z.boolean().default(false),
  /** Unpivot the values as text, so columns of different types can share one value column. */
  asText: z.boolean().default(false),
});
export type UnpivotParams = z.infer<typeof UnpivotShape>;

export const unpivot = defineStep({
  type: 'unpivot',
  params: UnpivotShape.superRefine((p, ctx) => {
    if (sameName(p.attribute, p.value)) ctx.addIssue({ code: 'custom', path: ['value'], message: 'name the attribute and value columns differently' });
    // With "all except", the picked columns stay, so the new columns mustn't take their names.
    const kept = p.except ? p.columns.find((c) => sameName(c, p.attribute) || sameName(c, p.value)) : undefined;
    if (kept) ctx.addIssue({ code: 'custom', path: [sameName(kept, p.attribute) ? 'attribute' : 'value'], message: `the column ${kept} stays as it is: give the new column another name` });
  }),
  label: (p) => (p.except ? `Unpivoted every column except ${p.columns.join(', ')}` : `Unpivoted ${p.columns.join(', ')}`),
  compile: (p, { input }) => {
    const picked = list(p.columns.map(ident));
    const on = p.except ? `COLUMNS(* EXCLUDE (${picked}))` : picked;
    let source = input;
    if (p.asText)
      source = p.except
        ? `(SELECT ${picked}, CAST(COLUMNS(* EXCLUDE (${picked})) AS VARCHAR) FROM ${input})`
        : `(SELECT * REPLACE (${list(p.columns.map((c) => `CAST(${ident(c)} AS VARCHAR) AS ${ident(c)}`))}) FROM ${input})`;
    return `SELECT * FROM ${source} UNPIVOT ${p.keepEmpty ? 'INCLUDE NULLS ' : ''}(${ident(p.value)} FOR ${ident(p.attribute)} IN (${on}))`;
  },
});

/** The most rows Transpose takes: each becomes a column. */
export const MAX_TRANSPOSE_ROWS = 1000;
/** The first column of a transposed table, holding the input's column names. */
export const TRANSPOSED_NAMES = 'column';

const TransposeShape = z.object({
  /** The input's columns when the step was set up, in order. */
  columns: z.array(z.string().min(1)).min(1, 'there are no columns to transpose'),
  /** How many rows the input had then. */
  rowCount: z.number({ error: 'the rows haven’t been read: refresh them' }).int().min(0),
  /** The first column's values then, as text, for headers. */
  headerValues: z.array(z.string().nullable()).default([]),
  /** Use the first column's values as the new column names; that column isn't transposed. */
  headers: z.boolean().default(false),
});
export type TransposeParams = z.infer<typeof TransposeShape>;

/** The transposed table's column names after the first: the header values, or "row 1", "row 2"…, made unique. */
export function transposedNames(p: Pick<TransposeParams, 'rowCount' | 'headerValues' | 'headers'>): string[] {
  const used = [TRANSPOSED_NAMES];
  return Array.from({ length: Math.min(p.rowCount, MAX_TRANSPOSE_ROWS) }, (_, i) => {
    const header = p.headers ? p.headerValues[i]?.trim() : undefined;
    const base = header || `row ${i + 1}`;
    let name = base;
    for (let k = 2; used.some((u) => sameName(u, name)); k++) name = `${base} (${k})`;
    used.push(name);
    return name;
  });
}

const fmt = (n: number) => n.toLocaleString('en');

export const transpose = defineStep({
  type: 'transpose',
  params: TransposeShape.superRefine((p, ctx) => {
    const issue = (path: string, message: string) => ctx.addIssue({ code: 'custom', path: [path], message });
    if (p.rowCount > MAX_TRANSPOSE_ROWS)
      issue('rowCount', `the table has ${fmt(p.rowCount)} rows, and transpose makes a column of each, so it only runs on up to ${fmt(MAX_TRANSPOSE_ROWS)}: filter or group the rows first`);
    else if (p.rowCount === 0) issue('rowCount', 'the table has no rows to transpose');
    else if (p.headers && p.headerValues.length !== p.rowCount) issue('rowCount', 'the header values weren’t read: refresh the rows');
    if (p.headers && p.columns.length < 2) issue('headers', 'with the first column as headers, there’s no column left to transpose');
  }),
  label: (p) => (p.headers ? `Transposed, with ${p.columns[0]} as headers` : 'Transposed rows and columns'),
  compile: (p, { input }) => {
    const moved = p.headers ? p.columns.slice(1) : p.columns;
    const names = transposedNames(p);
    const R = ident('__puddle_r');
    const C = ident('__puddle_c');
    const V = ident('__puddle_v');
    // The rows become columns fixed when the step was set up; a different number of rows now stops the query.
    const changed = stepFailure(`Transpose was set up for ${fmt(p.rowCount)} rows, and its input has a different number now. Refresh the rows in the step’s settings.`);
    const check = `(SELECT CASE WHEN count(*) <> ${num(p.rowCount)} THEN ${changed} ELSE true END FROM ${input})`;
    const rows = `SELECT row_number() OVER () AS ${R}, ${list(moved.map((c) => `CAST(${ident(c)} AS VARCHAR) AS ${ident(c)}`))} FROM ${input} WHERE ${check}`;
    const long = `SELECT ${R}, ${C}, ${V} FROM (${rows}) UNPIVOT INCLUDE NULLS (${V} FOR ${C} IN (${list(moved.map(ident))}))`;
    const on = names.map((_, i) => `${num(i + 1)} AS ${ident(`__puddle_r${i + 1}`)}`);
    return [
      `SELECT ${list([`${C} AS ${ident(TRANSPOSED_NAMES)}`, ...names.map((n, i) => `${ident(`__puddle_r${i + 1}_v`)} AS ${ident(n)}`)])} FROM (`,
      `  PIVOT (${long})`,
      `  ON ${R} IN (${list(on)})`,
      `  USING first(${V}) AS ${ident('v')}`,
      `  GROUP BY ${C}`,
      `)`,
      `ORDER BY list_position(${strList(moved)}, ${C})`,
    ].join('\n');
  },
});
