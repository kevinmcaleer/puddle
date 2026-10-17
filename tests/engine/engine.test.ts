// Real DuckDB-WASM (Node build) behind the EngineClient, against fixture files.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { compile, compileCount, compilePreview, SchemaCache, sourceFileName } from '../../src/compiler';
import { EngineClient, tableRows } from '../../src/engine/client';
import { isCancelled } from '../../src/engine/errors';
import type { Project, Source } from '../../src/model';
import { createNodeBackend } from '../helpers/nodeBackend';
import { flow, src, step } from '../helpers/projects';

const fixture = (name: string) => new Uint8Array(readFileSync(join(__dirname, '../fixtures', name)));

let engine: EngineClient;

beforeAll(async () => {
  engine = new EngineClient(await createNodeBackend());
});
afterAll(() => engine.close());

async function load(source: Source, file: string) {
  await engine.registerBuffer(sourceFileName(source), fixture(file));
}

const single = (source: Source, steps = [] as ReturnType<typeof step>[]): Project =>
  flow({
    sources: [source],
    nodes: [
      { id: 'in', type: 'source', sourceId: source.id },
      { id: 't', type: 'transform', steps },
      { id: 'out', type: 'output' },
    ],
    wires: [['in', 't'], ['t', 'out']],
  });

const rows = async (sql: string) => tableRows((await engine.query(sql)).table);

describe('engine', () => {
  it('reports the bundle and version', () => {
    expect(engine.info.version).toMatch(/^v1\./);
  });

  it.each([
    ['csv', 'customers.csv', 4, ['id', 'name', 'email', 'joined']],
    ['tsv', 'orders.tsv', 3, ['order_id', 'customer_id', 'total']],
  ] as const)('reads %s sources', async (format, file, count, columns) => {
    const s = src({ id: `f_${format}`, format });
    await load(s, file);
    const p = single(s);
    const [{ n }] = (await rows(compileCount(p, { nodeId: 'out' }))) as [{ n: number }];
    expect(n).toBe(count);
    expect((await engine.describe(compile(p, { nodeId: 'out' }).sql)).map((c) => c.name)).toEqual(columns);
  });

  // JSON and Parquet aren't built into the WASM bundles: DuckDB downloads those extensions from
  // extensions.duckdb.org on first use. The Node test backend turns that off to stay hermetic, so these
  // formats are read from their fixtures (items.json, events.ndjson, customers.parquet) in the container e2e
  // tests (e2e/container/deploy.spec.ts), where Puddle serves the extensions itself.
  it('says plainly when a format needs an extension that can\'t load', async () => {
    const s = src({ id: 'items', format: 'json' });
    await load(s, 'items.json');
    await expect(engine.query(compile(single(s), { nodeId: 'out' }).sql)).rejects.toMatchObject({ code: 'missing-extension', message: expect.stringContaining('json extension') });
  });

  it('honours parse options such as delimiter and null strings', async () => {
    const s = src({ id: 'semi', format: 'csv', parseOptions: { delimiter: ';', nullStrings: ['N/A'] } });
    await load(s, 'semicolon.csv');
    expect(await rows(compilePreview(single(s), { nodeId: 'out' }))).toEqual([
      { id: 1, city: 'Leeds' },
      { id: 2, city: null },
      { id: 3, city: 'York' },
    ]);
  });

  // Regression: a bank statement whose header ends in a comma, with an unquoted comma in one description, was read
  // as a single column (the sniffer gave up on the comma), and failed to read at all with the delimiter set to comma.
  // The unquoted comma pushes that row's text into Debit Amount, so the column stays text, as in Power Query.
  it.each([[{}], [{ delimiter: ',' }]] as const)('splits ragged CSV rows on the delimiter (options %j)', async (parseOptions) => {
    const s = src({ id: `bank_${Object.keys(parseOptions).length}`, format: 'csv', parseOptions });
    await load(s, 'bank-statement.csv');
    const p = single(s);
    const columns = (await engine.describe(compile(p, { nodeId: 'out' }).sql)).map((c) => c.name);
    expect(columns.slice(0, 8)).toEqual(['Transaction Date', 'Transaction Type', 'Sort Code', 'Account Number', 'Transaction Description', 'Debit Amount', 'Credit Amount', 'Balance']);
    const [{ n }] = (await rows(compileCount(p, { nodeId: 'out' }))) as [{ n: number }];
    expect(n).toBe(25);
    const [first] = (await rows(compilePreview(p, { nodeId: 'out' }))) as Record<string, unknown>[];
    expect(first).toMatchObject({ 'Transaction Type': 'TFR', 'Sort Code': "'12-24-82", 'Account Number': '06564201', 'Transaction Description': 'ADVICE CONFIRMS', 'Debit Amount': '12.50' });
  });

  it('runs a cleaning flow end to end, per step', async () => {
    const s = src({ id: 'cust', format: 'csv' });
    await load(s, 'customers.csv');
    const p = single(s, [
      step('a', 'trimWhitespace', { columns: ['name', 'email'] }),
      step('b', 'changeCase', { columns: ['name'], mode: 'title' }),
      step('c', 'renameColumns', { renames: [{ from: 'name', to: 'full_name' }] }),
      step('d', 'removeColumns', { columns: ['joined'] }),
    ]);
    expect(await rows(compilePreview(p, { nodeId: 'out' }))).toEqual([
      { id: 1, full_name: 'Ada Lovelace', email: 'ADA@example.com' },
      { id: 2, full_name: 'Grace Hopper', email: 'grace@example.com' },
      { id: 3, full_name: 'Edsger W. Dijkstra', email: null },
      { id: 4, full_name: '', email: 'null@example.com' },
    ]);
    const afterTrim = await rows(compilePreview(p, { nodeId: 't', stepIndex: 0 }));
    expect(afterTrim.map((r) => r.name)).toEqual(['Ada Lovelace', 'grace hopper', 'Edsger W. Dijkstra', '']);
    expect((await engine.describe(compile(p, { nodeId: 't', stepIndex: 2 }).sql)).map((c) => c.name)).toEqual(['id', 'full_name', 'email', 'joined']);
  });

  it.each([
    ['upper', ['  ADA LOVELACE ', 'GRACE HOPPER']],
    ['lower', ['  ada lovelace ', 'grace hopper']],
    ['sentence', ['  ada lovelace ', 'Grace hopper']],
    ['title', ['  Ada Lovelace ', 'Grace Hopper']],
  ] as const)('changes case: %s', async (mode, expected) => {
    const s = src({ id: 'case', format: 'csv' });
    await load(s, 'customers.csv');
    const out = await rows(compilePreview(single(s, [step('c', 'changeCase', { columns: ['name'], mode })]), { nodeId: 'out' }, 0, 2));
    expect(out.map((r) => r.name)).toEqual(expected);
  });

  it('caches schemas through DESCRIBE', async () => {
    const s = src({ id: 'cache', format: 'csv' });
    await load(s, 'customers.csv');
    const describe = vi.fn((sql: string) => engine.describe(sql));
    const cache = new SchemaCache(describe);
    const p = single(s, [step('r', 'removeColumns', { columns: ['email'] })]);
    const cols = await cache.get(p, { nodeId: 'out' });
    expect(cols).toEqual([
      { name: 'id', type: 'BIGINT' },
      { name: 'name', type: 'VARCHAR' },
      { name: 'joined', type: 'VARCHAR' },
    ]);
    await cache.get({ ...p, name: 'moved' }, { nodeId: 'out' });
    expect(describe).toHaveBeenCalledTimes(1);
  });

  it('returns typed errors in plain words', async () => {
    const s = src({ id: 'err', format: 'csv' });
    await load(s, 'customers.csv');
    const p = single(s, [step('x', 'removeColumns', { columns: ['order_dt'] })]);
    await expect(engine.query(compile(p, { nodeId: 'out' }).sql)).rejects.toMatchObject({ code: 'missing' });
    await expect(engine.query('SELEC 1')).rejects.toMatchObject({ code: 'syntax' });
    await expect(engine.query(`SELECT * FROM read_csv('missing.csv')`)).rejects.toMatchObject({ code: 'io' });
  });

  it('cancels a superseded preview so its result is never shown', async () => {
    const first = engine.query('SELECT 1 AS v', { supersede: 'preview' });
    const second = engine.query('SELECT 2 AS v', { supersede: 'preview' });
    await expect(first).rejects.toSatisfy(isCancelled);
    expect(tableRows((await second).table)).toEqual([{ v: 2 }]);
  });
});
