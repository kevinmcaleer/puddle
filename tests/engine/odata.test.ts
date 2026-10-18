// OData feeds end to end below the UI: a local HTTP server answering as TripPin (version 4) and Northwind (version 2)
// do, the real fetch, jsdom's XML parser for $metadata, and real DuckDB-WASM (Node build) reading the CSV Puddle
// writes with the column types $metadata declares. The runner reads the same feed on DuckDB's native build.
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
// @ts-expect-error jsdom ships without type declarations, and only its DOMParser is used here.
import { JSDOM } from 'jsdom';
import { useEngineStore } from '../../src/app/engine';
import { compile, compileCount } from '../../src/compiler';
import { EngineClient, tableRows } from '../../src/engine/client';
import { createProject, useProjectStore, type Project } from '../../src/model';
import { openDb } from '../../src/runner/db';
import { runProject } from '../../src/runner/run';
import { placeSources } from '../../src/runner/sources';
import { useAttachments } from '../../src/sources/attachments';
import { connect, feedColumns, type Connected, type Credentials } from '../../src/sources/odata';
import { forgetSignIn, rememberSignIn } from '../../src/sources/odataSignIn';
import { addODataSource, loadUrlSource, useUrlFetches } from '../../src/sources/url';
import { createNodeBackend } from '../helpers/nodeBackend';
import { startFileServer, type FileServer } from '../helpers/fileServer';
import { flow } from '../helpers/projects';

const fixture = (name: string) => readFileSync(join(__dirname, '../fixtures/odata', name), 'utf8');

let engine: EngineClient;
let open: FileServer;
let locked: FileServer;
const hadParser = 'DOMParser' in globalThis;
const SIGN_IN: Credentials = { kind: 'basic', user: 'kev', password: 'puddle' };

/** Serve a service's fixtures under `root`, with the addresses in them (next links) pointing at this server. */
function serve(server: FileServer, root: string, real: string, files: Record<string, string>) {
  for (const [path, name] of Object.entries(files))
    server.files.set(root + path, { body: fixture(name).replaceAll(real, server.url(root)), type: name.endsWith('.xml') ? 'application/xml' : 'application/json' });
}

const TRIPPIN = { '/$metadata': 'trippin-metadata.xml', '/People': 'trippin-people-1.json', '/People?%24skiptoken=4': 'trippin-people-2.json', '/People?%24skiptoken=8': 'trippin-people-3.json' };

beforeAll(async () => {
  if (!hadParser) (globalThis as { DOMParser?: unknown }).DOMParser = (new JSDOM('') as { window: { DOMParser: unknown } }).window.DOMParser;
  engine = new EngineClient(await createNodeBackend());
  useEngineStore.setState({ engine, status: { state: 'ready', info: engine.info } });
  open = await startFileServer({ cors: true });
  serve(open, '/trippin', 'https://services.odata.org/TripPinRESTierService', TRIPPIN);
  serve(open, '/northwind', 'https://services.odata.org/V2/Northwind/Northwind.svc', { '/$metadata': 'northwind-v2-metadata.xml', '/Orders': 'northwind-v2-orders.json' });
  locked = await startFileServer({ cors: true, authorization: 'Basic a2V2OnB1ZGRsZQ==' });
  serve(locked, '/trippin', 'https://services.odata.org/TripPinRESTierService', TRIPPIN);
});
afterAll(async () => {
  if (!hadParser) delete (globalThis as { DOMParser?: unknown }).DOMParser;
  await open.close();
  await locked.close();
  await engine.close();
});
beforeEach(() => {
  useProjectStore.getState().load(createProject('OData'));
  useAttachments.setState({ sources: {} });
  useUrlFetches.setState({ fetches: {} });
});

const project = () => useProjectStore.getState().history.present;
const nodeOf = (p: Project, sourceId: string) => p.nodes.find((n) => n.type === 'source' && n.sourceId === sourceId)!.id;

async function add(c: Connected, set: string, spec: { select?: string[]; filter?: string; top?: number } = {}, credentials?: Credentials) {
  const entitySet = c.service.entitySets.find((s) => s.name === set)!;
  return addODataSource(c.service.root, { entitySet: set, version: c.service.version, ...spec, columns: feedColumns(entitySet, spec.select), ...(credentials ? { auth: credentials.kind } : {}) }, { credentials });
}

async function rows(sourceId: string, where = '') {
  const p = project();
  const { sql } = compile(p, { nodeId: nodeOf(p, sourceId) });
  return { sql, rows: tableRows((await engine.query(`SELECT * FROM (${sql}) ${where}`)).table) as Record<string, unknown>[] };
}

describe('an OData feed as a source', () => {
  it('reads TripPin’s People over every page, typed from $metadata', async () => {
    const c = await connect(open.url('/trippin/People'));
    expect(c.entitySet).toBe('People');
    const s = await add(c, 'People');
    expect(s).toMatchObject({ kind: 'url', format: 'csv', name: 'People', url: { href: open.url('/trippin'), odata: { entitySet: 'People', version: 4 } } });
    const { sql, rows: people } = await rows(s.id, 'ORDER BY UserName');
    const cols = await engine.describe(sql);
    expect(cols.map((col) => [col.name, col.type])).toEqual([
      ['UserName', 'VARCHAR'],
      ['FirstName', 'VARCHAR'],
      ['LastName', 'VARCHAR'],
      ['MiddleName', 'VARCHAR'],
      ['Gender', 'VARCHAR'],
      ['Age', 'BIGINT'],
      ['Emails', 'VARCHAR'],
      ['AddressInfo', 'VARCHAR'],
      ['HomeAddress', 'VARCHAR'],
      ['FavoriteFeature', 'VARCHAR'],
      ['Features', 'VARCHAR'],
    ]);
    expect(people).toHaveLength(10);
    const russell = people.find((r) => r.UserName === 'russellwhyte')!;
    expect(russell).toMatchObject({ FirstName: 'Russell', Age: 22, MiddleName: null, HomeAddress: null, Emails: '["Russell@example.com","Russell@contoso.com"]' });
    // Structured values come in as their JSON text.
    expect(JSON.parse(russell.AddressInfo as string)[0].City.Name).toBe('Boise');
    // An empty string stays empty, apart from a null.
    expect(people.find((r) => r.UserName === 'salliesampson')!.MiddleName).toBe('');
  });

  it('reads only what $select, $filter and $top ask for, typed in $select’s order', async () => {
    open.files.set('/trippin/People?$select=Age,UserName&$filter=Age%20gt%2023&$top=2', { body: JSON.stringify({ value: [{ Age: 31, UserName: 'javieralfred' }, { Age: 25, UserName: 'elainestewart' }, { Age: 44, UserName: 'salliesampson' }] }), type: 'application/json' });
    const s = await add(await connect(open.url('/trippin')), 'People', { select: ['Age', 'UserName'], filter: 'Age gt 23', top: 2 });
    const { sql, rows: people } = await rows(s.id);
    expect((await engine.describe(sql)).map((col) => [col.name, col.type])).toEqual([
      ['Age', 'BIGINT'],
      ['UserName', 'VARCHAR'],
    ]);
    expect(people).toEqual([
      { Age: 31, UserName: 'javieralfred' },
      { Age: 25, UserName: 'elainestewart' },
    ]);
  });

  it('reads Northwind’s version 2 dates, times and decimals as DuckDB types', async () => {
    const c = await connect(open.url('/northwind/'));
    expect(c.service.version).toBe(2);
    const s = await add(c, 'Orders');
    const { sql, rows: orders } = await rows(s.id, 'ORDER BY OrderID');
    expect((await engine.describe(sql)).map((col) => col.type)).toEqual(['INTEGER', 'VARCHAR', 'TIMESTAMP', 'TIMESTAMP', 'TIME', 'DECIMAL(19,4)', 'VARCHAR']);
    const text = tableRows((await engine.query(`SELECT CAST(OrderDate AS VARCHAR) AS d, CAST(ShippedAt AS VARCHAR) AS s, CAST(CutOff AS VARCHAR) AS t, CAST(Freight AS VARCHAR) AS f FROM (${sql}) ORDER BY OrderID`)).table);
    expect(text).toEqual([
      { d: '1996-07-04 00:00:00', s: '1996-07-16 00:00:00', t: '13:20:00', f: '32.3800' },
      { d: '1996-07-05 00:00:00', s: null, t: null, f: '11.6100' },
    ]);
    expect(orders[1]!.ShipName).toBe('Toms Spezialitäten');
  });

  it('reads the feed again on Refresh and notices when its rows changed', async () => {
    const s = await add(await connect(open.url('/trippin')), 'People');
    const before = open.files.get('/trippin/People?%24skiptoken=8')!;
    open.files.set('/trippin/People?%24skiptoken=8', { ...before, body: String(before.body).replace('"Sallie"', '"Sal"') });
    try {
      await loadUrlSource(project().sources[0]!, { refresh: true });
      expect(useAttachments.getState().sources[s.id]).toBe('mismatch');
      const p = project();
      const [{ n }] = tableRows((await engine.query(compileCount(p, { nodeId: nodeOf(p, s.id) }))).table) as [{ n: number }];
      expect(n).toBe(10);
      expect((await rows(s.id, `WHERE UserName = 'salliesampson'`)).rows[0]!.FirstName).toBe('Sal');
    } finally {
      open.files.set('/trippin/People?%24skiptoken=8', before);
    }
  });

  it('signs in with Basic, keeps the sign-in out of the project, and asks for it again where this tab has none', async () => {
    await expect(connect(locked.url('/trippin'))).rejects.toMatchObject({ kind: 'auth' });
    const s = await add(await connect(locked.url('/trippin'), { credentials: SIGN_IN }), 'People', {}, SIGN_IN);
    expect(s.url!.odata!.auth).toBe('basic');
    expect(JSON.stringify(project())).not.toContain('puddle');
    expect(locked.requests.every((r) => r.authorization === undefined || r.authorization === 'Basic a2V2OnB1ZGRsZQ==')).toBe(true);

    // A new tab: no sign-in kept for the source.
    forgetSignIn(s.id);
    await loadUrlSource(project().sources[0]!);
    expect(useUrlFetches.getState().fetches[s.id]).toMatchObject({ state: 'failed', kind: 'auth' });
    expect(useAttachments.getState().sources[s.id]).toBe('detached');

    rememberSignIn(s.id, SIGN_IN);
    await loadUrlSource(project().sources[0]!, { refresh: true });
    expect(useUrlFetches.getState().fetches[s.id]).toMatchObject({ state: 'ok' });
    expect((await rows(s.id)).rows).toHaveLength(10);
  });
});

describe('the runner', () => {
  it('reads an OData feed itself, typed as in the browser, and says it can’t sign in to one that needs it', async () => {
    const people = await add(await connect(open.url('/trippin')), 'People', { select: ['UserName', 'Age'] });
    const p = flow({
      sources: [{ ...project().sources[0]!, id: people.id }],
      nodes: [
        { id: 'src', type: 'source', sourceId: people.id },
        { id: 'out', type: 'output', outputSpec: { format: 'csv', options: {} } },
      ],
      wires: [['src', 'out', 0]],
    });
    const folder = mkdtempSync(join(tmpdir(), 'puddle-odata-'));
    const db = await openDb();
    try {
      const { log } = await runProject(p, { folder, outDir: join(folder, 'out'), db });
      expect(log.outputs[0]).toMatchObject({ status: 'written', rows: 10 });
      const csv = readFileSync(join(folder, 'out', 'out.csv'), 'utf8').trim().split('\n');
      expect(csv[0]).toBe('UserName,Age');
      expect(csv).toContain('russellwhyte,22');
    } finally {
      await db.close();
      rmSync(folder, { recursive: true, force: true });
    }
    const signed = { ...p, sources: p.sources.map((s) => ({ ...s, url: { ...s.url!, odata: { ...s.url!.odata!, auth: 'basic' as const } } })) };
    expect(placeSources(signed, '/p', () => false)[0]).toMatchObject({ reason: 'is an OData feed that needs a sign-in, which the runner can’t give yet' });
  });
});
