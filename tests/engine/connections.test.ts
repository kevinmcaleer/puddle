// Connection sources end to end below the UI: a SQLite file read by the SQLite worker's service (in process) into
// Arrow and loaded with its types, a DuckDB file attached to the engine and read as a relation, both through
// syncConnectionSources and the compiler on real DuckDB-WASM (Node build).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { useEngineStore } from '../../src/app/engine';
import { compile, compileCount, sourceTableName } from '../../src/compiler';
import { connectorFor } from '../../src/connect/browser';
import { contextFor } from '../../src/connect/context';
import { rememberConnectionFile, resetConnectionFiles } from '../../src/connections/files';
import { EngineClient, tableRows } from '../../src/engine/client';
import { createProject, removeNodes, updateConnectionSource, useProjectStore, type Connection, type Project } from '../../src/model';
import { addConnectionSources, connectionNeeds, connectionReady, previewTable, readCatalog, refreshConnectionSource, resetConnectionSources, syncConnectionSources, useConnectionReads } from '../../src/sources/connection';
import { attachProject } from '../../src/sources/attach';
import { useAttachments } from '../../src/sources/attachments';
import { inProcessClient, setSqliteClient } from '../../src/sqlite/client';
import { SqliteService } from '../../src/sqlite/service';
import { createNodeBackend } from '../helpers/nodeBackend';

const fixture = (name: string) => new File([readFileSync(join(__dirname, '../fixtures/db', name))], name);

let engine: EngineClient;

beforeAll(async () => {
  engine = new EngineClient(await createNodeBackend());
  useEngineStore.setState({ engine, status: { state: 'ready', info: engine.info } });
});
afterAll(() => engine.close());
beforeEach(() => {
  setSqliteClient(inProcessClient(new SqliteService()));
  resetConnectionSources();
  resetConnectionFiles();
  useAttachments.setState({ sources: {} });
  useProjectStore.getState().load(createProject('Connections'));
});
afterEach(() => setSqliteClient(undefined));

const project = () => useProjectStore.getState().history.present;
const nodeOf = (p: Project, sourceId: string) => p.nodes.find((n) => n.type === 'source' && n.sourceId === sourceId)!.id;
const sync = () => syncConnectionSources(engine, project());
const rows = async (sourceId: string) => tableRows((await engine.query(compile(project(), { nodeId: nodeOf(project(), sourceId) }).sql)).table);
const types = async (sourceId: string) => (await engine.describe(compile(project(), { nodeId: nodeOf(project(), sourceId) }).sql)).map((c) => `${c.name} ${c.type}`);
const tables = async () => tableRows((await engine.query(`SELECT table_name AS t FROM duckdb_tables() WHERE database_name = 'memory' ORDER BY t`)).table).map((r) => String(r.t));

/** A connection to a fixture file, saved in the project with the file chosen for this tab. */
function connect(driver: 'sqlite' | 'duckdb' | 'libsql', file = driver === 'duckdb' ? 'shop.duckdb' : 'shop.sqlite'): Connection {
  const c: Connection = { id: `c-${driver}`, name: driver === 'duckdb' ? 'Shop file' : 'Shop', driver, via: 'browser', settings: { file }, auth: driver === 'libsql' ? 'token' : 'none' };
  useProjectStore.getState().apply((p) => ({ ...p, connections: [...p.connections, c] }));
  rememberConnectionFile(c.id, fixture(file));
  return c;
}

describe('SQLite connection sources', () => {
  it('tests, catalogues, and reads a table with its declared types through the compiler', async () => {
    const c = connect('sqlite');
    const connector = await connectorFor(c);
    expect(await connector.test(contextFor(c))).toEqual({ ok: true, server: 'SQLite file, 3 tables' });
    const catalog = await readCatalog(c);
    expect(catalog.tables.map((t) => [t.name, t.kind, t.rows, t.columns.length])).toEqual([
      ['customers', 'table', 3, 5],
      ['orders', 'table', 4, 4],
      ['order_totals', 'view', 3, 3],
    ]);
    expect(catalog.tables[0]!.columns).toEqual([
      { name: 'id', type: 'BIGINT', nullable: false },
      { name: 'name', type: 'VARCHAR', nullable: false },
      { name: 'email', type: 'VARCHAR', nullable: true },
      { name: 'signed_up', type: 'VARCHAR', nullable: true },
      { name: 'active', type: 'BOOLEAN', nullable: true },
    ]);
    // The catalogue is kept on the connection, so the picker and the runner have it without connecting.
    expect(project().connections[0]!.catalog).toEqual(catalog);
    expect(project().connections[0]!.catalogAt).toBeDefined();

    const past = useProjectStore.getState().history.past.length;
    const [customers, orders] = addConnectionSources(c, { tables: catalog.tables.slice(0, 2) });
    expect(useProjectStore.getState().history.past.length).toBe(past + 1);
    expect(customers).toMatchObject({ kind: 'connection', format: 'connection', name: 'customers', connection: { connectionId: c.id, table: { name: 'customers' }, columns: [{ name: 'id', type: 'BIGINT' }, { name: 'name', type: 'VARCHAR' }, { name: 'email', type: 'VARCHAR' }, { name: 'signed_up', type: 'VARCHAR' }, { name: 'active', type: 'BOOLEAN' }] } });
    expect(useAttachments.getState().sources[customers!.id]).toBe('attached');
    expect(connectionReady(project(), customers!.id)).toBe(false);
    await sync();
    expect(connectionReady(project(), customers!.id)).toBe(true);
    expect(useConnectionReads.getState().reads[customers!.id]).toMatchObject({ state: 'ok', table: sourceTableName(customers!), rows: 3 });
    expect(await types(customers!.id)).toEqual(['id BIGINT', 'name VARCHAR', 'email VARCHAR', 'signed_up VARCHAR', 'active BOOLEAN']);
    expect(await rows(customers!.id)).toEqual([
      { id: 1, name: 'Ada Lovelace', email: 'ada@example.com', signed_up: '2024-01-15', active: true },
      { id: 2, name: 'Grace Hopper', email: 'grace@example.com', signed_up: '2024-02-20', active: true },
      { id: 3, name: 'Alan Turing', email: null, signed_up: '2024-03-05', active: false },
    ]);
    expect(await types(orders!.id)).toEqual(['id BIGINT', 'customer_id BIGINT', 'total DOUBLE', 'placed_at VARCHAR']);
    // The Arrow rows it arrived as are dropped once the typed table is made.
    expect((await tables()).filter((t) => t.endsWith('_arrow'))).toEqual([]);
  });

  it('reads a query with a limit, changes the limit in one undo step, and reads again on Refresh', async () => {
    const c = connect('sqlite');
    const [q] = addConnectionSources(c, { query: 'SELECT name, orders FROM order_totals ORDER BY name', limit: 2 });
    expect(q).toMatchObject({ name: 'Shop query', connection: { query: 'SELECT name, orders FROM order_totals ORDER BY name', limit: 2, columns: [] } });
    await sync();
    expect(await rows(q!.id)).toEqual([
      { name: 'Ada Lovelace', orders: 2 },
      { name: 'Alan Turing', orders: 1 },
    ]);
    const before = sourceTableName(q!);
    const past = useProjectStore.getState().history.past.length;
    useProjectStore.getState().apply((p) => updateConnectionSource(p, q!.id, { limit: undefined }));
    expect(useProjectStore.getState().history.past.length).toBe(past + 1);
    expect(connectionReady(project(), q!.id)).toBe(false);
    await sync();
    expect(await rows(q!.id)).toHaveLength(3);
    // The table read with the old limit is gone.
    expect(await tables()).not.toContain(before);

    const at = (useConnectionReads.getState().reads[q!.id] as { at: number }).at;
    await new Promise((r) => setTimeout(r, 2));
    refreshConnectionSource(q!.id);
    await sync();
    expect((useConnectionReads.getState().reads[q!.id] as { at: number }).at).toBeGreaterThan(at);
  });

  it('says what went wrong with a query, and stays failed until the source changes', async () => {
    const c = connect('sqlite');
    const [q] = addConnectionSources(c, { query: 'SELECT * FROM nowhere' });
    await sync();
    expect(useConnectionReads.getState().reads[q!.id]).toMatchObject({ state: 'failed', message: expect.stringContaining('nowhere') });
    expect(connectionReady(project(), q!.id)).toBe(false);
    await sync();
    expect(useConnectionReads.getState().reads[q!.id]!.state).toBe('failed');
    useProjectStore.getState().apply((p) => updateConnectionSource(p, q!.id, { query: 'SELECT 1 AS one' }));
    await sync();
    expect(await rows(q!.id)).toEqual([{ one: 1 }]);
  });

  it('waits for the file in a new tab, and drops the table of a removed source', async () => {
    const c = connect('sqlite');
    const [s] = addConnectionSources(c, { tables: [{ name: 'orders', kind: 'table', columns: [] }] });
    await sync();
    const table = sourceTableName(s!);
    expect(await tables()).toContain(table);
    // The project opened again: the source needs no attaching, but the connection's file is chosen again.
    resetConnectionFiles();
    resetConnectionSources();
    useAttachments.setState({ sources: {} });
    await attachProject(project());
    expect(useAttachments.getState().sources[s!.id]).toBe('attached');
    // Nothing is tried until the file is chosen: the inspector asks for it.
    await sync();
    expect(useConnectionReads.getState().reads[s!.id]).toBeUndefined();
    expect(connectionNeeds(project().connections[0]!)).toBe('file');
    expect(connectionReady(project(), s!.id)).toBe(false);
    rememberConnectionFile(c.id, fixture('shop.sqlite'));
    expect(connectionNeeds(project().connections[0]!)).toBeUndefined();
    await sync();
    expect(useConnectionReads.getState().reads[s!.id]).toMatchObject({ state: 'ok', rows: 4 });

    useProjectStore.getState().apply((p) => removeNodes(p, [nodeOf(p, s!.id)]));
    await sync();
    expect(await tables()).not.toContain(table);
    expect(useConnectionReads.getState().reads[s!.id]).toBeUndefined();
  });

  it('previews a table’s first rows without loading a source, and places a dropped table where it landed', async () => {
    const c = connect('sqlite');
    const before = await tables();
    expect(await previewTable(c, { name: 'orders' }, 2)).toEqual({
      columns: ['id', 'customer_id', 'total', 'placed_at'],
      rows: [
        { id: 101, customer_id: 1, total: 19.99, placed_at: '2024-04-01 09:30:00' },
        { id: 102, customer_id: 1, total: 5.5, placed_at: '2024-04-02 14:00:00' },
      ],
    });
    // Nothing was loaded into DuckDB for it.
    expect(await tables()).toEqual(before);
    await expect(previewTable(c, { name: 'nowhere' })).rejects.toThrow('nowhere');
    const [s] = addConnectionSources(c, { tables: [{ name: 'orders', kind: 'table', columns: [] }], at: { x: 300, y: 500 } });
    expect(project().nodes.find((n) => n.type === 'source' && n.sourceId === s!.id)!.position).toEqual({ x: 300, y: 500 });
  });

  it('reads a LibSQL file as a SQLite file', async () => {
    const c = connect('libsql');
    const [s] = addConnectionSources(c, { tables: [{ name: 'customers', kind: 'table', columns: [] }] });
    await sync();
    expect(await rows(s!.id)).toHaveLength(3);
  });
});

describe('DuckDB file connection sources', () => {
  it('attaches the file read-only, catalogues it with DuckDB types, and reads a table and a query as relations', async () => {
    const c = connect('duckdb');
    const connector = await connectorFor(c);
    expect(await connector.test(contextFor(c))).toEqual({ ok: true, server: 'DuckDB file, 2 tables' });
    const catalog = await readCatalog(c);
    expect(catalog.tables.map((t) => [t.schema, t.name, t.kind])).toEqual([
      [undefined, 'customers', 'table'],
      [undefined, 'orders', 'table'],
      [undefined, 'order_totals', 'view'],
    ]);
    expect(catalog.tables[1]!.columns).toEqual([
      { name: 'id', type: 'INTEGER', nullable: false },
      { name: 'customer_id', type: 'INTEGER', nullable: false },
      { name: 'total', type: 'DECIMAL(10,2)', nullable: true },
      { name: 'placed_at', type: 'TIMESTAMP', nullable: true },
    ]);
    const [orders, q] = addConnectionSources(c, { tables: [catalog.tables[1]!], query: 'SELECT name, total FROM order_totals ORDER BY total DESC', limit: 2 });
    await sync();
    expect(await types(orders!.id)).toEqual(['id INTEGER', 'customer_id INTEGER', 'total DECIMAL(10,2)', 'placed_at TIMESTAMP']);
    const p = project();
    const [{ n }] = tableRows((await engine.query(compileCount(p, { nodeId: nodeOf(p, orders!.id) }))).table) as [{ n: number }];
    expect(n).toBe(2);
    expect(await types(q!.id)).toEqual(['name VARCHAR', 'total DECIMAL(38,2)']);
    expect(await rows(q!.id)).toHaveLength(2);
    // The query ran with the file as the default database, and the in-memory one is the default again.
    expect(tableRows((await engine.query('SELECT current_database() AS db')).table)).toEqual([{ db: 'memory' }]);
    expect(await tables()).toContain(sourceTableName(orders!));
    expect(await previewTable(c, { name: 'customers' }, 1)).toMatchObject({ columns: ['id', 'name', 'email', 'signed_up', 'active'], rows: [{ id: 1, name: 'Ada Lovelace' }] });
  });
});
