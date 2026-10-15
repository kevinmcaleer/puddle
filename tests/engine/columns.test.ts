// The Columns step group on real DuckDB-WASM (Node build) against tests/fixtures/customers.csv.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { compile, compileDisplayPage, sourceFileName } from '../../src/compiler';
import { EngineClient, tableRows } from '../../src/engine/client';
import type { Source, Step } from '../../src/model';
import { createNodeBackend } from '../helpers/nodeBackend';
import { flow, src, step } from '../helpers/projects';

const cust: Source = src({ id: 'cust', format: 'csv' });

let engine: EngineClient;
beforeAll(async () => {
  engine = new EngineClient(await createNodeBackend());
  await engine.registerBuffer(sourceFileName(cust), new Uint8Array(readFileSync(join(__dirname, '../fixtures/customers.csv'))));
});
afterAll(() => engine.close());

const project = (...steps: Step[]) =>
  flow({
    sources: [cust],
    nodes: [
      { id: 'in', type: 'source', sourceId: cust.id },
      { id: 't', type: 'transform', steps },
    ],
    wires: [['in', 't']],
  });

/** The step's output as DuckDB prints it, and its column names and types. */
async function run(type: string, params: Record<string, unknown>) {
  const p = project(step('s', type, params));
  const schema = await engine.describe(compile(p, { nodeId: 't' }).sql);
  const columns = schema.map((c) => c.name);
  const rows = tableRows((await engine.query(compileDisplayPage(p, { nodeId: 't' }, columns, 0))).table);
  return { columns, types: Object.fromEntries(schema.map((c) => [c.name, c.type])), rows };
}

describe('columns steps', () => {
  it('moves columns to the front in the order given', async () => {
    expect((await run('reorderColumns', { columns: ['email', 'id'] })).columns).toEqual(['email', 'id', 'name', 'joined']);
  });

  it('changes type, emptying values that do not convert, or stopping when asked', async () => {
    const r = await run('changeType', { columns: ['joined'], to: 'date', onError: 'empty' });
    expect(r.types.joined).toBe('DATE');
    expect(r.rows.map((x) => x.joined)).toEqual(['2024-01-31', '2024-02-29', '2024-03-01', null]);
    expect((await run('changeType', { columns: ['id'], to: 'text', onError: 'empty' })).types.id).toBe('VARCHAR');
    await expect(run('changeType', { columns: ['joined'], to: 'date', onError: 'fail' })).rejects.toThrow(/not a date/);
  });

  it('splits by a delimiter, leaving missing parts empty', async () => {
    const r = await run('splitByDelimiter', { column: 'email', delimiter: '@', into: ['user', 'domain', 'extra'], keepOriginal: false });
    expect(r.columns).toEqual(['id', 'name', 'joined', 'user', 'domain', 'extra']);
    expect(r.rows[0]).toMatchObject({ user: 'ADA', domain: 'example.com', extra: null });
    expect(r.rows[2]).toMatchObject({ user: null, domain: null });
  });

  it('splits by position', async () => {
    const r = await run('splitByPosition', { column: 'joined', positions: [4, 5, 7], into: ['year', 'dash', 'month', 'rest'], keepOriginal: true });
    expect(r.columns).toEqual(['id', 'name', 'email', 'joined', 'year', 'dash', 'month', 'rest']);
    expect(r.rows[0]).toMatchObject({ year: '2024', dash: '-', month: '01', rest: '-31' });
  });

  it('merges columns, skipping empty values', async () => {
    const r = await run('mergeColumns', { columns: ['id', 'email'], separator: ' / ', into: 'key', keepOriginals: false });
    expect(r.columns).toEqual(['name', 'joined', 'key']);
    expect(r.rows.map((x) => x.key)).toEqual(['1 / ADA@example.com', '2 / grace@example.com ', '3', '4 / null@example.com']);
  });

  it('adds an index from the start number, in file order', async () => {
    const r = await run('addIndex', { name: 'row', start: 0 });
    expect(r.columns[0]).toBe('row');
    expect(r.rows.map((x) => [x.row, x.id])).toEqual([['0', '1'], ['1', '2'], ['2', '3'], ['3', '4']]);
  });

  it('duplicates a column under a new name', async () => {
    const r = await run('duplicateColumn', { column: 'id', into: 'id copy' });
    expect(r.rows.map((x) => x['id copy'])).toEqual(['1', '2', '3', '4']);
  });

  it('adds a column from an expression, and a bad expression names the problem', async () => {
    const r = await run('addColumn', { name: 'domain', expression: "split_part(email, '@', 2)" });
    expect(r.rows.map((x) => x.domain)).toEqual(['example.com', 'example.com ', null, 'example.com']);
    await expect(run('addColumn', { name: 'x', expression: 'nope + 1' })).rejects.toThrow(/nope/);
  });

  it('a later step that needs a removed column fails', async () => {
    const p = project(step('a', 'removeColumns', { columns: ['email'] }), step('b', 'duplicateColumn', { column: 'email', into: 'e2' }));
    await expect(engine.query(compile(p, { nodeId: 't' }).sql)).rejects.toThrow(/email/);
  });
});
