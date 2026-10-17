// The Pivot step on real DuckDB-WASM (Node build) against tests/fixtures/sales.csv (a row with no month and no
// rep) and tests/fixtures/codes.csv (250 distinct values, more than can become columns).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { compile, CompileError, compileDisplayPage, MAX_PIVOT_VALUES, sourceFileName, type Target } from '../../src/compiler';
import { EngineClient, tableRows } from '../../src/engine/client';
import { readPivotValues } from '../../src/flow/pivot';
import type { Project } from '../../src/model';
import { pivotValuesChange } from '../../src/steps/pivot';
import { createNodeBackend } from '../helpers/nodeBackend';
import { flow, src, step } from '../helpers/projects';

const sales = src({ id: 'sales', format: 'csv' });
const codes = src({ id: 'codes', format: 'csv' });
const fixture = (file: string) => new Uint8Array(readFileSync(join(__dirname, '../fixtures', file)));

let engine: EngineClient;
beforeAll(async () => {
  engine = new EngineClient(await createNodeBackend());
  await engine.registerBuffer(sourceFileName(sales), fixture('sales.csv'));
  await engine.registerBuffer(sourceFileName(codes), fixture('codes.csv'));
});
afterAll(() => engine.close());

const project = (params: Record<string, unknown>, source = sales, after: Record<string, unknown>[] = []) =>
  flow({
    sources: [source],
    nodes: [
      { id: 'in', type: 'source', sourceId: source.id },
      { id: 't', type: 'transform', steps: [step('p', 'pivot', params), ...after.map((s, i) => step(`a${i}`, 'sortRows', s))] },
    ],
    wires: [['in', 't']],
  });
const input: Target = { nodeId: 't', stepIndex: -1 };

async function run(p: Project) {
  const schema = await engine.describe(compile(p, { nodeId: 't' }).sql);
  const rows = tableRows((await engine.query(compileDisplayPage(p, { nodeId: 't' }, schema.map((c) => c.name), 0))).table);
  return { names: schema.map((c) => c.name), types: schema.map((c) => c.type), rows: rows.map((r) => schema.map((c) => r[c.name])) };
}

/** Set a pivot up the way the editor does: read its Columns field's values from the step's input. */
async function setUp(params: { rows?: string[]; column: string; values: { column: string; agg: string }[]; filters?: unknown[] }, source = sales) {
  const base = { rows: [], filters: [], ...params };
  const read = await readPivotValues(engine, project({ ...base, pivotValues: ['x'] }, source), input, { column: base.column, filters: base.filters as never });
  return { ...base, pivotValues: read.values, moreValues: read.more };
}

describe('pivot', () => {
  it('turns each month into a column of revenue per region, with empty cells where a region has none', async () => {
    const params = await setUp({ rows: ['region'], column: 'month', values: [{ column: 'revenue', agg: 'sum' }] });
    expect(params.pivotValues).toEqual(['2024-01', '2024-02', '2024-03']);
    const r = await run(project(params));
    expect(r.names).toEqual(['region', '2024-01 sum of revenue', '2024-02 sum of revenue', '2024-03 sum of revenue']);
    expect(r.rows).toEqual([
      ['East', null, null, '40.0'],
      ['North', '55.5', '20.0', null],
      ['South', '50.0', '76.5', null],
      ['West', null, null, null],
    ]);
  });

  it('a pivot with filters only reads and counts the rows that pass them', async () => {
    const filters = [{ column: 'region', op: 'notEquals', value: 'east' }];
    const params = await setUp({ rows: ['product'], column: 'month', values: [{ column: 'rep', agg: 'count' }, { column: 'units', agg: 'max' }], filters });
    // East was the only region with a March sale, so March isn't a column.
    expect(params.pivotValues).toEqual(['2024-01', '2024-02']);
    const r = await run(project(params));
    expect(r.names).toEqual(['product', '2024-01 count of rep', '2024-01 max of units', '2024-02 count of rep', '2024-02 max of units']);
    expect(r.rows).toEqual([
      ['Gadget', '1', '1', '2', '2'],
      ['Widget', '2', '5', '1', '2'],
    ]);
  });

  it('with no Rows, gives one row of totals; later steps see its columns, renamed', async () => {
    const params = await setUp({ column: 'product', values: [{ column: 'revenue', agg: 'sum' }] });
    const r = await run(project({ ...params, names: { 'Widget sum of revenue': 'widgets' } }, sales, [{ keys: [{ column: 'widgets', descending: false }] }]));
    expect(r.names).toEqual(['Gadget sum of revenue', 'widgets']);
    expect(r.rows).toEqual([['127.5', '140.0']]);
  });

  it('first, last and list follow the file order, and skip rows with no value', async () => {
    const params = await setUp({ rows: ['region'], column: 'product', values: [{ column: 'rep', agg: 'first' }, { column: 'rep', agg: 'last' }, { column: 'rep', agg: 'list' }] });
    const r = await run(project(params));
    expect(r.rows).toEqual([
      ['East', null, null, null, 'Ed', 'Ed', 'Ed'],
      ['North', 'Bo', 'Bo', 'Bo', 'Ann', 'Ann', 'Ann, Ann'],
      ['South', 'Cy', 'Di', 'Cy, Di', 'Cy', 'Cy', 'Cy'],
      ['West', null, null, null, null, null, null],
    ]);
  });

  it('a new value in the data leaves the columns as they were until they are refreshed, which reports it', async () => {
    const changed = src({ id: 'changed', format: 'csv' });
    await engine.registerBuffer(sourceFileName(changed), fixture('sales.csv'));
    const params = await setUp({ rows: ['region'], column: 'month', values: [{ column: 'units', agg: 'sum' }] }, changed);
    const before = await run(project(params, changed));

    const more = `${readFileSync(join(__dirname, '../fixtures/sales.csv'), 'utf8')}North,2024-04,Widget,7,70.00,Ann\n`;
    await engine.registerBuffer(sourceFileName(changed), new TextEncoder().encode(more));
    const after = await run(project(params, changed));
    expect(after.names).toEqual(before.names);
    expect(after.names).not.toContain('2024-04 sum of units');

    const refreshed = await readPivotValues(engine, project(params, changed), input, { column: 'month', filters: [] });
    expect(refreshed.values).toEqual(['2024-01', '2024-02', '2024-03', '2024-04']);
    expect(pivotValuesChange(params.pivotValues, refreshed.values)).toBe('Added 2024-04.');
    const now = await run(project({ ...params, pivotValues: refreshed.values }, changed));
    expect(now.names.at(-1)).toBe('2024-04 sum of units');
    expect(now.rows.find((r) => r[0] === 'North')?.at(-1)).toBe('7');
  });

  it(`reads at most ${MAX_PIVOT_VALUES} values, in the column’s own order, and says there were more`, async () => {
    const byNumber = await readPivotValues(engine, project({ rows: [], column: 'n', pivotValues: ['1'], values: [{ column: 'code', agg: 'count' }] }, codes), input, { column: 'n', filters: [] });
    expect(byNumber.more).toBe(true);
    expect(byNumber.values).toHaveLength(MAX_PIVOT_VALUES);
    // Numbers sort as numbers: 10 comes after 9, not after 1.
    expect(byNumber.values.slice(7, 11)).toEqual(['8', '9', '10', '11']);
    const r = await run(project({ rows: [], column: 'n', pivotValues: byNumber.values, values: [{ column: 'code', agg: 'count' }] }, codes));
    expect(r.names).toHaveLength(MAX_PIVOT_VALUES);
    expect(r.rows).toEqual([Array(MAX_PIVOT_VALUES).fill('1')]);
  });
});

describe('group by', () => {
  it('summarises each region: total, distinct reps, first, last and the list of reps', async () => {
    const r = await run(
      project({
        rows: ['region'],
        values: [
          { column: 'units', agg: 'sum' },
          { column: 'rep', agg: 'countDistinct' },
          { column: 'rep', agg: 'first' },
          { column: 'rep', agg: 'last' },
          { column: 'rep', agg: 'list' },
        ],
      }),
    );
    expect(r.names).toEqual(['region', 'sum of units', 'count distinct of rep', 'first of rep', 'last of rep', 'list of rep']);
    expect(r.rows).toEqual([
      ['East', '4', '1', 'Ed', 'Ed', 'Ed'],
      ['North', '6', '2', 'Ann', 'Ann', 'Ann, Bo, Ann'],
      ['South', '8', '2', 'Cy', 'Di', 'Cy, Cy, Di'],
      ['West', '1', '0', null, null, null],
    ]);
  });

  it('with no Rows, gives one row: total, average and median', async () => {
    const r = await run(project({ values: [{ column: 'revenue', agg: 'sum' }, { column: 'revenue', agg: 'average' }, { column: 'units', agg: 'median' }, { column: 'region', agg: 'min' }] }));
    expect(r.rows).toEqual([['267.5', '33.4375', '2.0', 'East']]);
  });

  it('spreads each region’s units as standard deviation and variance, empty for a region with one row', async () => {
    const r = await run(project({ rows: ['region'], values: [{ column: 'units', agg: 'stddev' }, { column: 'units', agg: 'variance' }] }));
    expect(r.names).toEqual(['region', 'standard deviation of units', 'variance of units']);
    // Sample statistics, as a spreadsheet's STDEV and VAR give: North's 3, 1, 2 vary by 1.
    expect(r.rows).toEqual([
      ['East', null, null],
      ['North', '1.0', '1.0'],
      ['South', '2.0816659994661326', '4.333333333333333'],
      ['West', null, null],
    ]);
  });

  it('with no Values, lists each combination once; empty groups sort last', async () => {
    const r = await run(project({ rows: ['month', 'product'], filters: [{ column: 'product', op: 'startsWith', value: 'G' }] }));
    expect(r.rows).toEqual([
      ['2024-01', 'Gadget'],
      ['2024-02', 'Gadget'],
      [null, 'Gadget'],
    ]);
  });

  it('refuses settings that would give clashing columns before running anything', () => {
    const clash = project({ rows: ['region'], values: [{ column: 'units', agg: 'sum' }], names: { 'sum of units': 'Region' } });
    expect(() => compile(clash, { nodeId: 't' })).toThrow(CompileError);
    expect(() => compile(clash, { nodeId: 't' })).toThrow(/two columns would be called Region/);
  });
});
