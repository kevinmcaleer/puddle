// The Rows step group on real DuckDB-WASM (Node build) against fixtures with gaps, duplicates and title rows.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { compile, compileDisplayPage, headerNames, sourceFileName } from '../../src/compiler';
import { EngineClient, tableRows } from '../../src/engine/client';
import type { Source, Step } from '../../src/model';
import { createNodeBackend } from '../helpers/nodeBackend';
import { flow, src, step } from '../helpers/projects';

const cust = src({ id: 'cust', format: 'csv' });
const gaps = src({ id: 'gaps', format: 'csv' });
const titled = src({ id: 'titled', format: 'csv', parseOptions: { header: false } });

let engine: EngineClient;
beforeAll(async () => {
  engine = new EngineClient(await createNodeBackend());
  for (const [s, file] of [[cust, 'customers.csv'], [gaps, 'gaps.csv'], [titled, 'title-rows.csv']] as const)
    await engine.registerBuffer(sourceFileName(s), new Uint8Array(readFileSync(join(__dirname, '../fixtures', file))));
});
afterAll(() => engine.close());

const project = (source: Source, steps: Step[]) =>
  flow({
    sources: [source],
    nodes: [
      { id: 'in', type: 'source', sourceId: source.id },
      { id: 't', type: 'transform', steps },
    ],
    wires: [['in', 't']],
  });

/** The output as DuckDB prints it, as arrays of cells, after the column names. */
async function run(source: Source, ...steps: [string, Record<string, unknown>][]) {
  const p = project(source, steps.map(([type, params], i) => step(`s${i}`, type, params)));
  const columns = (await engine.describe(compile(p, { nodeId: 't' }).sql)).map((c) => c.name);
  const rows = tableRows((await engine.query(compileDisplayPage(p, { nodeId: 't' }, columns, 0))).table);
  return [columns, ...rows.map((r) => columns.map((c) => r[c] ?? null))];
}

describe('rows steps', () => {
  it('filters by conditions, ignoring case unless asked, and leaves rows with empty values out', async () => {
    const keep = (conditions: object[], extra = {}) => run(cust, ['filterRows', { mode: 'keep', match: 'all', conditions, matchCase: false, ...extra }]);
    expect((await keep([{ column: 'email', op: 'contains', value: 'ada' }])).slice(1).map((r) => r[0])).toEqual(['1']);
    expect((await keep([{ column: 'email', op: 'contains', value: 'ada' }], { matchCase: true })).length).toBe(1);
    expect((await keep([{ column: 'id', op: 'greater', value: '2' }])).slice(1).map((r) => r[0])).toEqual(['3', '4']);
    expect((await keep([{ column: 'email', op: 'empty', value: '' }])).slice(1).map((r) => r[0])).toEqual(['3']);
    const any = await keep([{ column: 'id', op: 'equals', value: '1' }, { column: 'id', op: 'equals', value: '4' }], { match: 'any' });
    expect(any.slice(1).map((r) => r[0])).toEqual(['1', '4']);
    // Removing rows whose email ends with "com" keeps the row without an email, and the one with a trailing space.
    const removed = await run(cust, ['filterRows', { mode: 'remove', match: 'all', conditions: [{ column: 'email', op: 'endsWith', value: 'com' }], matchCase: false }]);
    expect(removed.slice(1).map((r) => r[0])).toEqual(['2', '3']);
  });

  it('sorts by several columns, keeping ties in file order and empty values last', async () => {
    const r = await run(gaps, ['sortRows', { keys: [{ column: 'region', descending: true }, { column: 'sales', descending: false }] }]);
    expect(r.slice(1).map((x) => `${x[0]}|${x[1]}|${x[2]}`)).toEqual(['South|Jan|8', 'South|Jan|8', 'North|Jan|10', 'null|Feb|7', 'null|Feb|12', 'null|Mar|null', 'null|null|null']);
  });

  it('removes rows from the top or the bottom', async () => {
    expect((await run(cust, ['removeRows', { from: 'top', count: 3 }])).slice(1).map((r) => r[0])).toEqual(['4']);
    expect((await run(cust, ['removeRows', { from: 'bottom', count: 3 }])).slice(1).map((r) => r[0])).toEqual(['1']);
    expect((await run(cust, ['removeRows', { from: 'bottom', count: 9 }])).length).toBe(1);
  });

  it('removes rows that are blank everywhere, or blank in the columns picked', async () => {
    expect((await run(gaps, ['removeBlankRows', { columns: [] }])).length).toBe(1 + 6);
    expect((await run(gaps, ['removeBlankRows', { columns: ['region'] }])).slice(1).map((r) => r[0])).toEqual(['North', 'South', 'South']);
    // Name is only spaces on row 4 of customers.csv.
    expect((await run(cust, ['removeBlankRows', { columns: ['name'] }])).slice(1).map((r) => r[0])).toEqual(['1', '2', '3']);
  });

  it('fills gaps down or up, in file order', async () => {
    const down = await run(gaps, ['fillRows', { columns: ['region'], direction: 'down' }]);
    expect(down.slice(1).map((r) => r[0])).toEqual(['North', 'North', 'North', 'North', 'South', 'South', 'South']);
    const up = await run(gaps, ['fillRows', { columns: ['region', 'sales'], direction: 'up' }]);
    expect(up.slice(1).map((r) => `${r[0]}|${r[2]}`)).toEqual(['North|10', 'South|12', 'South|8', 'South|8', 'South|8', 'South|7', 'South|8']);
  });

  it('removes duplicates keeping the first, or keeps only the duplicated rows', async () => {
    const filled: [string, Record<string, unknown>] = ['fillRows', { columns: ['region'], direction: 'down' }];
    const first = await run(gaps, filled, ['duplicateRows', { columns: [], keep: 'first' }]);
    expect(first.length).toBe(1 + 6);
    const byRegion = await run(gaps, filled, ['duplicateRows', { columns: ['region'], keep: 'first' }]);
    expect(byRegion.slice(1).map((r) => `${r[0]}|${r[1]}`)).toEqual(['North|Jan', 'South|Jan']);
    const dups = await run(gaps, ['duplicateRows', { columns: [], keep: 'duplicates' }]);
    expect(dups.slice(1).map((r) => r.join('|'))).toEqual(['South|Jan|8', 'South|Jan|8']);
  });

  it('promotes the first row to headers after removing title rows', async () => {
    const before = await run(titled, ['removeRows', { from: 'top', count: 2 }]);
    const columns = before[0] as string[];
    const renames = headerNames(columns, Object.fromEntries(columns.map((c, i) => [c, before[1]![i]])));
    expect(renames.map((r) => r.to)).toEqual(['Region', 'Quarter', 'Total']);
    const after = await run(titled, ['removeRows', { from: 'top', count: 2 }], ['promoteHeaders', { renames }]);
    expect(after).toEqual([
      ['Region', 'Quarter', 'Total'],
      ['North', 'Q1', '120'],
      ['South', 'Q1', '95'],
    ]);
  });

  it('header names fall back to the old name when blank and number repeats', () => {
    expect(headerNames(['a', 'b', 'c', 'd'], { a: 'Name', b: ' ', c: 'Name', d: null }).map((r) => r.to)).toEqual(['Name', 'b', 'Name_2', 'd']);
  });
});
