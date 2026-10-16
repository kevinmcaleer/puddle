// Unpivot and Transpose on real DuckDB-WASM (Node build) against tests/fixtures/quarters.csv: three regions, a
// quarter column each, two empty values and a text column.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { compile, CompileError, compileDisplayPage, MAX_TRANSPOSE_ROWS, sourceFileName, type Target } from '../../src/compiler';
import { EngineClient, tableRows } from '../../src/engine/client';
import { toEngineError } from '../../src/engine/errors';
import { readPivotValues } from '../../src/flow/pivot';
import { readTransposeRows } from '../../src/flow/transpose';
import type { Source, Step } from '../../src/model';
import { createNodeBackend } from '../helpers/nodeBackend';
import { flow, src, step } from '../helpers/projects';

const quarters = src({ id: 'quarters', format: 'csv' });
const fixture = (file: string) => new Uint8Array(readFileSync(join(__dirname, '../fixtures', file)));

let engine: EngineClient;
beforeAll(async () => {
  engine = new EngineClient(await createNodeBackend());
  await engine.registerBuffer(sourceFileName(quarters), fixture('quarters.csv'));
});
afterAll(() => engine.close());

const project = (steps: Step[], source: Source = quarters) =>
  flow({
    sources: [source],
    nodes: [
      { id: 'in', type: 'source', sourceId: source.id },
      { id: 't', type: 'transform', steps },
    ],
    wires: [['in', 't']],
  });
const before = (stepIndex: number): Target => ({ nodeId: 't', stepIndex });

async function run(steps: Step[], source: Source = quarters) {
  const p = project(steps, source);
  const schema = await engine.describe(compile(p, { nodeId: 't' }).sql);
  const rows = tableRows((await engine.query(compileDisplayPage(p, { nodeId: 't' }, schema.map((c) => c.name), 0))).table);
  return { names: schema.map((c) => c.name), rows: rows.map((r) => schema.map((c) => r[c.name])) };
}

const unpivot = (params: Record<string, unknown>) => step('u', 'unpivot', { attribute: 'attribute', value: 'value', ...params });

describe('unpivot', () => {
  it('turns the quarter columns into rows of attribute and value, leaving out empty values', async () => {
    const r = await run([unpivot({ columns: ['q1', 'q2', 'q3'] })]);
    expect(r.names).toEqual(['region', 'manager', 'attribute', 'value']);
    expect(r.rows).toEqual([
      ['East', 'Ed', 'q1', '10'],
      ['East', 'Ed', 'q2', '12'],
      ['North', 'Ann', 'q1', '7'],
      ['North', 'Ann', 'q2', '9'],
      ['North', 'Ann', 'q3', '11'],
      ['South', 'Cy', 'q1', '5'],
      ['South', 'Cy', 'q3', '8'],
    ]);
  });

  it('“every column except” unpivots the rest; empty values can be kept; the new columns can be named', async () => {
    const r = await run([unpivot({ columns: ['region', 'manager'], except: true, keepEmpty: true, attribute: 'quarter', value: 'sales' })]);
    expect(r.names).toEqual(['region', 'manager', 'quarter', 'sales']);
    expect(r.rows).toHaveLength(9);
    expect(r.rows[2]).toEqual(['East', 'Ed', 'q3', null]);
  });

  it('explains columns of different types, and unpivots them as text when asked', async () => {
    const mixed = project([unpivot({ columns: ['q1', 'manager'] })]);
    const error = await engine.describe(compile(mixed, { nodeId: 't' }).sql).then(
      () => undefined,
      (e: unknown) => toEngineError(e),
    );
    expect(error?.message).toBe('The columns being unpivoted hold different types (BIGINT and VARCHAR), and one value column can only hold one. Turn on Treat all values as text, or change their types first.');

    const asText = await run([unpivot({ columns: ['q1', 'manager'], asText: true })]);
    expect(asText.rows[0]).toEqual(['East', '12', null, 'q1', '10']);
    expect(asText.rows[1]).toEqual(['East', '12', null, 'manager', 'Ed']);
    const exceptText = await run([unpivot({ columns: ['region'], except: true, asText: true })]);
    expect(exceptText.rows.slice(0, 4)).toEqual([
      ['East', 'q1', '10'],
      ['East', 'q2', '12'],
      ['East', 'manager', 'Ed'],
      ['North', 'q1', '7'],
    ]);
  });

  it('unpivot then pivot round-trips the fixture back to the original table', async () => {
    const original = await run([]);
    const un = unpivot({ columns: ['q1', 'q2', 'q3'] });
    const read = await readPivotValues(engine, project([un]), before(0), { column: 'attribute', filters: [] });
    expect(read.values).toEqual(['q1', 'q2', 'q3']);
    const back = step('p', 'pivot', {
      rows: ['region', 'manager'],
      column: 'attribute',
      pivotValues: read.values,
      values: [{ column: 'value', agg: 'sum' }],
      names: { 'q1 sum of value': 'q1', 'q2 sum of value': 'q2', 'q3 sum of value': 'q3' },
    });
    const r = await run([un, back, step('o', 'reorderColumns', { columns: ['region', 'q1', 'q2', 'q3'] })]);
    expect(r.names).toEqual(original.names);
    expect(r.rows).toEqual(original.rows);
  });
});

describe('transpose', () => {
  async function setUp(headers: boolean, source: Source = quarters, steps: Step[] = []) {
    const columns = (await engine.describe(compile(project(steps, source), { nodeId: 't' }).sql)).map((c) => c.name);
    const read = await readTransposeRows(engine, project(steps, source), { nodeId: 't' }, columns[0]!);
    return step('x', 'transpose', { columns, headers, ...read });
  }

  it('swaps rows and columns, naming the new columns row 1, row 2…', async () => {
    const r = await run([await setUp(false)]);
    expect(r.names).toEqual(['column', 'row 1', 'row 2', 'row 3']);
    expect(r.rows).toEqual([
      ['region', 'East', 'North', 'South'],
      ['q1', '10', '7', '5'],
      ['q2', '12', '9', null],
      ['q3', null, '11', '8'],
      ['manager', 'Ed', 'Ann', 'Cy'],
    ]);
  });

  it('uses the first column as headers when asked', async () => {
    const r = await run([await setUp(true)]);
    expect(r.names).toEqual(['column', 'East', 'North', 'South']);
    expect(r.rows[0]).toEqual(['q1', '10', '7', '5']);
    expect(r.rows.at(-1)).toEqual(['manager', 'Ed', 'Ann', 'Cy']);
  });

  it('stops with a plain reason when the input has a different number of rows from when it was set up', async () => {
    const changing = src({ id: 'changing', format: 'csv' });
    await engine.registerBuffer(sourceFileName(changing), fixture('quarters.csv'));
    const x = await setUp(false, changing);
    await engine.registerBuffer(sourceFileName(changing), new TextEncoder().encode(`${readFileSync(join(__dirname, '../fixtures/quarters.csv'), 'utf8')}West,1,2,3,Di\n`));
    const error = await run([x], changing).then(
      () => undefined,
      (e: unknown) => toEngineError(e),
    );
    expect(error?.message).toBe('Transpose was set up for 3 rows, and its input has a different number now. Refresh the rows in the step’s settings.');
  });

  it(`refuses more than ${MAX_TRANSPOSE_ROWS} rows, saying why, before running anything`, async () => {
    const big = src({ id: 'big', format: 'csv' });
    const csv = ['id,x', ...Array.from({ length: 1500 }, (_, i) => `${i},${i * 2}`)].join('\n');
    await engine.registerBuffer(sourceFileName(big), new TextEncoder().encode(csv));
    const x = await setUp(false, big);
    expect(x.params).toMatchObject({ rowCount: 1500, headerValues: [] });
    expect(() => compile(project([x], big), { nodeId: 't' })).toThrow(CompileError);
    expect(() => compile(project([x], big), { nodeId: 't' })).toThrow(
      'the table has 1,500 rows, and transpose makes a column of each, so it only runs on up to 1,000: filter or group the rows first',
    );
  });
});
