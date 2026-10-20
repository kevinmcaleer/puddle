// The onboarding samples on real DuckDB-WASM (Node build), served over HTTP from public/samples as the app serves
// them: each opens as a project with its data read, has the problems its note describes, and the fixes the note
// suggests clear them.
// openSample saves the new project, so IndexedDB must be there before it runs. Without it the save fails and leaves
// src/persistence/db.ts holding a failed open, which broke whichever IndexedDB test ran next in the same worker.
import 'fake-indexeddb/auto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { useEngineStore } from '../../src/app/engine';
import { useSession } from '../../src/app/session';
import { compile, compileCount } from '../../src/compiler';
import { EngineClient, tableRows } from '../../src/engine/client';
import { detectDateFormats } from '../../src/dates';
import { schemaCacheFor } from '../../src/flow/status';
import { useProjectStore, type Project, type Source } from '../../src/model';
import { gatherSuggestionFacts, suggestRules } from '../../src/rules';
import { SAMPLES, TAXI_TUTORIAL, type SampleFile } from '../../src/samples/catalog';
import { openSample } from '../../src/samples/open';
import { useAttachments } from '../../src/sources/attachments';
import { resetExcelSources, syncExcelSources } from '../../src/sources/excel';
import { inProcessClient, setExcelClient } from '../../src/excel/client';
import { ExcelService } from '../../src/excel/service';
import { syncRewrites } from '../../src/sources/rewrite';
import { useUrlFetches } from '../../src/sources/url';
import { startFileServer, type FileServer } from '../helpers/fileServer';
import { createNodeBackend } from '../helpers/nodeBackend';
import { flow, step } from '../helpers/projects';

const dir = join(__dirname, '../../public/samples');

let engine: EngineClient;
let server: FileServer;

beforeAll(async () => {
  engine = new EngineClient(await createNodeBackend());
  useEngineStore.setState({ engine, status: { state: 'ready', info: engine.info } });
  server = await startFileServer({ ranges: true });
  for (const f of readdirSync(dir)) server.files.set(`/app/samples/${f}`, { body: readFileSync(join(dir, f)), type: 'text/csv' });
  // The taxi tutorial's files, as Puddle's server passes them through from the TLC: small stand-ins with their columns.
  const fixtures = join(__dirname, '../fixtures');
  server.files.set('/app/tutorial-data/trip-data/yellow_tripdata_2024-01.parquet', { body: readFileSync(join(fixtures, 'taxi-trips.parquet')), type: 'binary/octet-stream' });
  server.files.set('/app/tutorial-data/misc/taxi_zone_lookup.csv', { body: readFileSync(join(fixtures, 'taxi-zones.csv')), type: 'text/csv' });
});
afterAll(async () => {
  await server.close();
  await engine.close();
});
beforeEach(() => {
  setExcelClient(inProcessClient(new ExcelService()));
  resetExcelSources();
});
afterEach(() => setExcelClient(undefined));

/** Open a sample as the app does, from a Puddle served at /app/. */
const open = (id: string) => openSample(id, server.url('/app/'));

const rows = async (sql: string) => tableRows((await engine.query(sql)).table);
const one = async (sql: string) => Number(Object.values((await rows(sql))[0]!)[0]);
const count = (p: Project, nodeId: string) => one(compileCount(p, { nodeId }));

/** A source followed by a Transform with these steps; `out` is the Transform. */
const cleaned = (source: Source, steps: ReturnType<typeof step>[]) =>
  flow({ sources: [source], nodes: [{ id: 'in', type: 'source', sourceId: source.id }, { id: 'out', type: 'transform', steps }], wires: [['in', 'out']] });

describe('opening a sample', () => {
  it.each(SAMPLES.map((s) => [s.id, s] as const))('%s opens as a new project with each file read and its note', async (_id, sample) => {
    const project = await open(sample.id);
    // A pipe table is read by Puddle before DuckDB sees it, and a workbook by the Excel worker, as the editor does when the project opens.
    await syncRewrites(engine, useProjectStore.getState().history.present);
    await syncExcelSources(engine, useProjectStore.getState().history.present);
    expect(useProjectStore.getState().history.present.id).toBe(project.id);
    expect(project.name).toMatch(/^Sample: /);
    expect(project.notes).toBe(sample.note);
    expect(useSession.getState().inspectorTab).toBe('notes');
    expect(project.sources.map((s) => s.url?.sample)).toEqual(sample.files.map((f) => f.file));
    expect(project.view.viewedNodeId).toBe(project.nodes[0]!.id);
    for (const s of project.sources) {
      expect(useUrlFetches.getState().fetches[s.id]).toMatchObject({ state: 'ok' });
      expect(useAttachments.getState().sources[s.id]).toBe('attached');
      const node = project.nodes.find((n) => n.type === 'source' && n.sourceId === s.id)!;
      const lines = s.format === 'xlsx' ? NaN : readFileSync(join(dir, s.url!.sample!), 'utf8').trim().split('\n').length - 1;
      expect(await count(project, node.id)).toBe((sample.files as readonly SampleFile[]).find((f) => f.file === s.url!.sample)!.rows ?? lines);
    }
  });

  it('reads a sample from wherever Puddle is served now, not the address it was first read from', async () => {
    const project = await open('contacts');
    const source = project.sources[0]!;
    expect(source.url!.href).toBe(server.url('/app/samples/contacts.csv'));
    const reads = server.requests.filter((r) => r.path === '/app/samples/contacts.csv');
    expect(reads.length).toBeGreaterThan(0);
    // One plain GET each, as the service worker precached it, so it is answered from there offline (Firefox too).
    expect(reads.every((r) => r.method === 'GET' && r.range == null)).toBe(true);
  });

  it('opens the taxi tutorial with its trips read in parts and its zones whole, from beside the app', async () => {
    const project = await open('taxi');
    expect(project.notes).toBe(TAXI_TUTORIAL.note);
    const [trips, zones] = project.sources;
    expect([trips!.format, zones!.format]).toEqual(['parquet', 'csv']);
    for (const s of project.sources) expect(useUrlFetches.getState().fetches[s.id]).toMatchObject({ state: 'ok' });
    expect(useUrlFetches.getState().fetches[trips!.id]).toMatchObject({ ranged: true });
    const nodeOf = (s: Source) => project.nodes.find((n) => n.type === 'source' && n.sourceId === s.id)!.id;
    expect(await count(project, nodeOf(zones!))).toBe(11);
    // The Node build here runs without DuckDB's parquet extension, so the trips are queried in e2e/samples.spec.ts.
    // Read like a typed address: the first megabyte by a range request, not one plain GET as shipped samples are.
    const reads = server.requests.filter((r) => r.path === '/app/tutorial-data/trip-data/yellow_tripdata_2024-01.parquet');
    expect(reads[0]).toMatchObject({ method: 'GET', range: 'bytes=0-1048575' });
  });

  it('refuses a sample that doesn’t exist', async () => {
    await expect(open('nope')).rejects.toThrow('no sample called nope');
  });
});

describe('each sample has the problems its note describes, and the suggested fixes clear them', () => {
  it('contact list: stray and doubled spaces, mixed capitals, blank emails, five duplicate rows', async () => {
    const [contacts] = (await open('contacts')).sources;
    const raw = compile(cleaned(contacts!, []), { nodeId: 'out' }).sql;
    expect(await one(`SELECT count(*) FROM (${raw}) WHERE name <> trim(name) OR city <> trim(city)`)).toBeGreaterThan(5);
    expect(await one(`SELECT count(*) FROM (${raw}) WHERE name LIKE '%  %'`)).toBeGreaterThan(0);
    expect(await one(`SELECT count(*) FROM (${raw}) WHERE trim(name) = upper(trim(name))`)).toBeGreaterThan(0);
    expect(await one(`SELECT count(*) FROM (${raw}) WHERE trim(name) = lower(trim(name))`)).toBeGreaterThan(0);
    expect(await one(`SELECT count(*) FROM (${raw}) WHERE email IS NULL OR trim(email) = ''`)).toBeGreaterThan(0);
    expect(await one(`SELECT count(*) - count(DISTINCT (name, email, phone, city, signed_up)) FROM (${raw})`)).toBe(5);

    const cols = ['name', 'city'];
    const fixed = cleaned(contacts!, [
      step('t', 'trimWhitespace', { columns: [...cols, 'email'] }),
      step('c', 'collapseSpaces', { columns: cols }),
      step('k', 'changeCase', { columns: cols, mode: 'title' }),
      step('d', 'duplicateRows', { columns: [], keep: 'first' }),
    ]);
    const sql = compile(fixed, { nodeId: 'out' }).sql;
    expect(await count(fixed, 'out')).toBe(48);
    expect(await one(`SELECT count(*) FROM (${sql}) WHERE name <> trim(name) OR name LIKE '%  %' OR city = upper(city)`)).toBe(0);
    expect(await one(`SELECT count(DISTINCT city) FROM (${sql})`)).toBe(8);
  });

  it('sales: dates in four formats, amounts as text with symbols, untidy currencies and regions', async () => {
    const [sales] = (await open('sales')).sources;
    const project = cleaned(sales!, []);
    const raw = compile(project, { nodeId: 'out' }).sql;
    const types = Object.fromEntries((await engine.describe(raw)).map((c) => [c.name, c.type]));
    expect(types).toMatchObject({ order_date: 'VARCHAR', amount: 'VARCHAR' });
    for (const re of ['^\\d{4}-\\d{2}-\\d{2}$', '^\\d{2}/\\d{2}/\\d{4}$', '^\\d{1,2} [A-Z][a-z]{2} \\d{4}$', '^[A-Z][a-z]+ \\d{1,2}, \\d{4}$'])
      expect(await one(`SELECT count(*) FROM (${raw}) WHERE regexp_matches(order_date, '${re}')`)).toBeGreaterThan(0);
    expect(await one(`SELECT count(*) FROM (${raw}) WHERE regexp_matches(amount, '[£$€A-Z,]')`)).toBeGreaterThan(10);
    expect(await one(`SELECT count(DISTINCT currency) FROM (${raw})`)).toBeGreaterThan(3);
    expect(await one(`SELECT count(*) FROM (${raw}) WHERE region IS NULL OR region IN ('n/a', '')`)).toBeGreaterThan(0);

    // Parse dates detects every format in the column, and values like 24/01/2024 settle the day and month order.
    // Regression: it used to detect only the commonest, so 43 of the 72 dates became empty.
    const detection = await detectDateFormats(engine, project, { nodeId: 'out' }, 'order_date');
    expect(detection.formats).toEqual(['%Y-%m-%d', '%d/%m/%Y', '%d %b %Y', '%B %d, %Y']);
    expect(detection.ambiguous).toMatchObject({ order: 'day', byValues: expect.stringMatching(/^(1[3-9]|2\d|3[01])\//) });
    const fixed = cleaned(sales!, [
      step('d', 'parseDates', { columns: ['order_date'], formats: detection.formats }),
      step('n', 'parseNumbers', { columns: ['amount'], decimal: '.' }),
      step('t', 'trimWhitespace', { columns: ['currency', 'region'] }),
      step('u', 'changeCase', { columns: ['currency'], mode: 'upper' }),
    ]);
    const sql = compile(fixed, { nodeId: 'out' }).sql;
    expect(await one(`SELECT count(*) FROM (${sql}) WHERE order_date IS NULL OR amount IS NULL`)).toBe(0);
    expect((await rows(`SELECT DISTINCT currency FROM (${sql}) ORDER BY 1`)).map((r) => r.currency)).toEqual(['EUR', 'GBP', 'USD']);
  });

  it('orders and customers: ids with stray spaces and lower case miss the join; two orders have no customer', async () => {
    const [orders, customers] = (await open('orders')).sources;
    const joined = (orderSteps: ReturnType<typeof step>[]) =>
      flow({
        sources: [orders!, customers!],
        nodes: [
          { id: 'o', type: 'source', sourceId: orders!.id },
          { id: 'c', type: 'source', sourceId: customers!.id },
          { id: 'fix', type: 'transform', steps: orderSteps },
          { id: 'j', type: 'join', joinSpec: { kind: 'inner', keys: [{ left: 'customer_id', right: 'customer_id' }] } },
        ],
        wires: [['o', 'fix'], ['fix', 'j', 'left'], ['c', 'j', 'right']],
      });
    // The join reads its inputs' columns from the schema cache, as the app's flow fills it.
    const matched = async (p: Project) => (await schemaCacheFor(engine).get(p, { nodeId: 'j' }), count(p, 'j'));
    expect(await matched(joined([]))).toBeLessThan(50);
    const fixed = joined([step('t', 'trimWhitespace', { columns: ['customer_id'] }), step('u', 'changeCase', { columns: ['customer_id'], mode: 'upper' })]);
    expect(await matched(fixed)).toBe(58);
  });

  it('monthly sales: a wide table with gaps written three ways and numbers as text, which unpivots into one row per store and month', async () => {
    const [monthly] = (await open('monthly')).sources;
    const raw = compile(cleaned(monthly!, []), { nodeId: 'out' }).sql;
    const columns = await engine.describe(raw);
    const months = columns.map((c) => c.name).filter((n) => n.endsWith('_2024'));
    expect(months).toHaveLength(12);
    const cells = months.map((m) => `SELECT CAST("${m}" AS VARCHAR) AS v FROM (${raw})`).join(' UNION ALL ');
    expect((await rows(`SELECT DISTINCT coalesce(v, '') AS v FROM (${cells}) WHERE v IS NULL OR v IN ('n/a', '-', '') ORDER BY 1`)).map((r) => r.v)).toEqual(['', '-', 'n/a']);
    expect(await one(`SELECT count(*) FROM (${cells}) WHERE v LIKE '%,%'`)).toBeGreaterThan(0);

    const fixed = cleaned(monthly!, [
      step('u', 'unpivot', { columns: months, attribute: 'month', value: 'sales', keepEmpty: true, asText: true }),
      step('n', 'parseNumbers', { columns: ['sales'], decimal: '.' }),
    ]);
    const sql = compile(fixed, { nodeId: 'out' }).sql;
    expect(await count(fixed, 'out')).toBe(8 * 12);
    expect((await engine.describe(sql)).find((c) => c.name === 'sales')?.type).toBe('DOUBLE');
  });

  it.each(SAMPLES.map((s) => s.id))('%s gives the suggested rules something to say', async (id) => {
    const [first] = (await open(id)).sources;
    await syncRewrites(engine, useProjectStore.getState().history.present);
    await syncExcelSources(engine, useProjectStore.getState().history.present);
    const project = cleaned(first!, []);
    const columns = await engine.describe(compile(project, { nodeId: 'out' }).sql);
    const facts = await gatherSuggestionFacts(engine, project, 'out', columns);
    expect(suggestRules(columns, facts.profile, facts.checked).length).toBeGreaterThan(0);
  });
});
