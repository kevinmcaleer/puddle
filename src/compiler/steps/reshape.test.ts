import { describe, expect, it } from 'vitest';
import { schemaErrors } from '../../steps/forms';
import { MAX_PIVOT_VALUES, MAX_TRANSPOSE_ROWS, pivot, pivotOutputs, pivotValuesQuery, transpose, unpivot } from './reshape';

const base = { rows: ['region'], column: '', pivotValues: [], values: [{ column: 'total', agg: 'sum' }], filters: [], names: {} };
const compile = (p: Record<string, unknown>) => pivot.compile(pivot.params.parse({ ...base, ...p }), { input: '"n_in"' });
const errors = (p: Record<string, unknown>) => schemaErrors(pivot.params, { ...base, ...p });

describe('pivot step', () => {
  it('compiles a group by, a pivot and a filtered pivot', () => {
    expect(compile({ values: [{ column: 'total', agg: 'sum' }, { column: 'id', agg: 'countDistinct' }] })).toMatchSnapshot('group by');
    expect(compile({ column: 'month', pivotValues: ['2024-01', "it's"], values: [{ column: 'total', agg: 'sum' }, { column: 'rep', agg: 'list' }] })).toMatchSnapshot('pivot');
    expect(compile({ rows: [], column: 'month', pivotValues: ['2024-01'], filters: [{ column: 'region', op: 'equals', value: 'North' }] })).toMatchSnapshot('pivot with filters and no rows');
  });

  it('reads the file order only when first, last or list need it', () => {
    expect(compile({})).not.toContain('row_number');
    expect(compile({ values: [{ column: 'rep', agg: 'first' }] })).toContain('arg_min("rep", CASE WHEN "rep" IS NULL THEN NULL ELSE "__puddle_row" END)');
    expect(compile({ values: [{ column: 'rep', agg: 'last' }] })).toContain('arg_max(');
  });

  it('names columns readably: the pivot value, then the aggregate and its column; renames replace them', () => {
    const p = { column: 'month', pivotValues: ['2024-01', ''], values: [{ column: 'total', agg: 'sum' as const }, { column: 'id', agg: 'count' as const }], names: { '2024-01 count of id': 'orders in January' } };
    expect(pivotOutputs(p).map((o) => o.name)).toEqual(['2024-01 sum of total', 'orders in January', '(empty) sum of total', '(empty) count of id']);
    expect(pivotOutputs({ ...p, column: '' }).map((o) => o.name)).toEqual(['sum of total', 'count of id']);
    // A name cleared to spaces falls back to the default.
    expect(pivotOutputs({ ...p, column: '', names: { 'sum of total': '  ' } })[0]!.name).toBe('sum of total');
  });

  it('says what is missing or clashing, keyed by the zone it is about', () => {
    expect(errors({ rows: [], values: [] })).toEqual({ rows: 'Drag a column to Rows or Values.' });
    expect(errors({ rows: ['region', 'region'] })).toEqual({ rows: 'Rows has region twice.' });
    expect(errors({ column: 'region', pivotValues: ['a'] })).toEqual({ column: 'Rows and Columns can’t both have region: take it out of one.' });
    expect(errors({ column: 'month', pivotValues: ['a'], values: [] })).toEqual({ values: 'Drag a column to Values to fill the new columns.' });
    expect(errors({ column: 'month' })).toEqual({ column: 'No values of month to make columns from: refresh columns to read them.' });
    expect(errors({ values: [{ column: 'total', agg: 'sum' }, { column: 'total', agg: 'sum' }] })).toEqual({ values: 'Values has sum of total twice.' });
    expect(errors({ pivotValues: Array.from({ length: MAX_PIVOT_VALUES + 1 }, (_, i) => String(i)), column: 'n' })).toEqual({ pivotValues: `Only ${MAX_PIVOT_VALUES} values can become columns.` });
    expect(errors({ filters: [{ column: 'region', op: 'equals', value: '' }] })).toEqual({ filters: 'Give a value to compare with.' });
  });

  it('refuses names that differ only in case, as DuckDB would clash them', () => {
    // Values that differ only in case make default names that clash; renaming one fixes it.
    const p = { rows: [], column: 'code', pivotValues: ['a', 'A'] };
    expect(errors(p)).toEqual({ names: 'Two columns would be called A sum of total: rename one.' });
    expect(errors({ ...p, names: { 'A sum of total': 'upper A' } })).toEqual({});
    expect(errors({ names: { 'sum of total': 'REGION' } })).toEqual({ names: 'Two columns would be called REGION: rename one.' });
  });

  it('labels itself by what it does', () => {
    const label = (p: Record<string, unknown>) => pivot.label(pivot.params.parse({ ...base, ...p }));
    expect(label({ column: 'month', pivotValues: ['a'] })).toBe('Pivoted month into columns by region');
    expect(label({})).toBe('Grouped by region');
    expect(label({ rows: [], values: [{ column: 'total', agg: 'sum' }, { column: 'total', agg: 'max' }] })).toBe('Summarised total');
  });

  it('reads the Columns field’s values in its own order, after the filters, one more than can be used', () => {
    expect(pivotValuesQuery({ column: 'month', filters: [{ column: 'region', op: 'notEquals', value: 'East' }] }, '"n_in"')).toBe(
      `SELECT CAST("month" AS VARCHAR) AS v FROM (SELECT * FROM "n_in" WHERE coalesce((lower(CAST("region" AS VARCHAR)) IS DISTINCT FROM 'east'), false)) WHERE "month" IS NOT NULL GROUP BY "month" ORDER BY "month" LIMIT ${MAX_PIVOT_VALUES + 1}`,
    );
  });
});

describe('unpivot step', () => {
  const compileU = (p: Record<string, unknown>) => unpivot.compile(unpivot.params.parse({ columns: ['q1', 'q2'], ...p }), { input: '"n_in"' });

  it('compiles to UNPIVOT, keeping empty values and casting to text only when asked', () => {
    expect(compileU({})).toMatchSnapshot('columns');
    expect(compileU({ columns: ['region'], except: true, keepEmpty: true, asText: true, attribute: 'quarter', value: 'sales' })).toMatchSnapshot('every column except, as text, with empty values');
    expect(compileU({ asText: true })).toContain(`REPLACE (CAST("q1" AS VARCHAR) AS "q1", CAST("q2" AS VARCHAR) AS "q2")`);
  });

  it('labels itself by what it unpivots', () => {
    expect(unpivot.label(unpivot.params.parse({ columns: ['q1', 'q2'] }))).toBe('Unpivoted q1, q2');
    expect(unpivot.label(unpivot.params.parse({ columns: ['region'], except: true }))).toBe('Unpivoted every column except region');
  });
});

describe('transpose step', () => {
  const params = { columns: ['region', 'q1'], rowCount: 2, headerValues: ['East', "it's"], headers: true };

  it('compiles to UNPIVOT then PIVOT over the rows it was set up for, stopping if their number changes', () => {
    expect(transpose.compile(transpose.params.parse(params), { input: '"n_in"' })).toMatchSnapshot('with headers');
    expect(transpose.compile(transpose.params.parse({ ...params, headers: false }), { input: '"n_in"' })).toContain('"__puddle_r2_v" AS "row 2"');
  });

  it(`refuses an empty table, more than ${MAX_TRANSPOSE_ROWS} rows, and headers with nothing left to transpose`, () => {
    expect(schemaErrors(transpose.params, { ...params, rowCount: 0, headerValues: [] })).toEqual({ rowCount: 'The table has no rows to transpose.' });
    expect(schemaErrors(transpose.params, { ...params, rowCount: MAX_TRANSPOSE_ROWS + 1, headerValues: [] })).toEqual({
      rowCount: 'The table has 1,001 rows, and transpose makes a column of each, so it only runs on up to 1,000: filter or group the rows first.',
    });
    expect(schemaErrors(transpose.params, { ...params, columns: ['region'] })).toEqual({ headers: 'With the first column as headers, there’s no column left to transpose.' });
    expect(schemaErrors(transpose.params, { ...params, headerValues: ['East'] })).toEqual({ rowCount: 'The header values weren’t read: refresh the rows.' });
    expect(schemaErrors(transpose.params, { ...params, rowCount: MAX_TRANSPOSE_ROWS, headerValues: [], headers: false })).toEqual({});
  });
});
