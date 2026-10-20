// Access sources end to end below the UI: mdb-reader (the worker's service, run in process), the Arrow table it
// makes, the typed load and real DuckDB-WASM (Node build) reading it through the compiler.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { inProcessClient, setAccessClient, type AccessClient } from '../../src/access/client';
import { AccessService } from '../../src/access/service';
import { useEngineStore } from '../../src/app/engine';
import { compile, compileCount, sourceTableName } from '../../src/compiler';
import { EngineClient, tableRows } from '../../src/engine/client';
import { evaluateFlow, useFlowStore } from '../../src/flow/status';
import { createProject, removeNodes, setParseOptions, useProjectStore, type Project } from '../../src/model';
import { accessReady, addAccessTables, resetAccessSources, syncAccessSources, tablesNotAdded, useAccessReads } from '../../src/sources/access';
import { addFileSource, sourceFile } from '../../src/sources/add';
import { attachProject, chooseFilesFor } from '../../src/sources/attach';
import { useAttachments } from '../../src/sources/attachments';
import { createNodeBackend } from '../helpers/nodeBackend';

const database = (name = 'shop.accdb', data: BlobPart = readFileSync(join(__dirname, '../fixtures', name.endsWith('.mdb') ? 'shop.mdb' : 'shop.accdb'))) => new File([data], name);

let engine: EngineClient;
let client: AccessClient & { reads: number };

beforeAll(async () => {
  engine = new EngineClient(await createNodeBackend());
  useEngineStore.setState({ engine, status: { state: 'ready', info: engine.info } });
});
afterAll(() => engine.close());
beforeEach(() => {
  const inner = inProcessClient(new AccessService());
  client = {
    reads: 0,
    call(op, args) {
      if (op === 'read') client.reads++;
      return inner.call(op, args);
    },
  };
  setAccessClient(client);
  resetAccessSources();
  useAttachments.setState({ sources: {} });
  useProjectStore.getState().load(createProject('Access'));
});
afterEach(() => setAccessClient(undefined));

const project = () => useProjectStore.getState().history.present;
const sourceOf = (id: string) => project().sources.find((s) => s.id === id)!;
const nodeOf = (p: Project, sourceId: string) => p.nodes.find((n) => n.type === 'source' && n.sourceId === sourceId)!.id;
const sync = () => syncAccessSources(engine, project(), client);
const rows = async (sourceId: string) => tableRows((await engine.query(compile(project(), { nodeId: nodeOf(project(), sourceId) }).sql)).table);
const types = async (sourceId: string) => (await engine.describe(compile(project(), { nodeId: nodeOf(project(), sourceId) }).sql)).map((c) => `${c.name} ${c.type}`);
const tables = async () => tableRows((await engine.query(`SELECT table_name AS t FROM duckdb_tables() ORDER BY t`)).table).map((r) => String(r.t));
const chooseTable = (id: string, table: string) => useProjectStore.getState().apply((p) => setParseOptions(p, id, { ...sourceOf(id).parseOptions, table }));

describe('Access sources', () => {
  it.each(['shop.accdb', 'shop.mdb'])('adds %s and loads its first table into DuckDB with Access types', async (name) => {
    const s = await addFileSource(database(name));
    expect(s).toMatchObject({ kind: 'file', format: 'access', name, parseOptions: {} });
    expect(accessReady(project(), s.id)).toBe(false);
    await sync();
    expect(accessReady(project(), s.id)).toBe(true);
    expect(useAccessReads.getState().reads[s.id]).toMatchObject({
      state: 'ok',
      table: sourceTableName(s),
      rows: 3,
      tables: [
        { name: 'Customers', rows: 3, columns: 6 },
        { name: 'Orders', rows: 4, columns: 10 },
        { name: 'Archive', rows: 0, columns: 2 },
      ],
    });
    expect(await types(s.id)).toEqual(['CustomerID INTEGER', 'Name VARCHAR', 'Email VARCHAR', 'Joined TIMESTAMP', 'Active BOOLEAN', 'CreditLimit DECIMAL(19,4)']);
    // Currency keeps its exact digits (shown as text here, as the results table shows decimals).
    const sql = `SELECT * REPLACE (CAST(CreditLimit AS VARCHAR) AS CreditLimit) FROM (${compile(project(), { nodeId: nodeOf(project(), s.id) }).sql})`;
    expect(tableRows((await engine.query(sql)).table)).toEqual([
      { CustomerID: 1, Name: 'Ann Lee', Email: 'ann@example.com', Joined: Date.UTC(2025, 2, 14), Active: true, CreditLimit: '1500.0000' },
      { CustomerID: 2, Name: 'Bob Ray', Email: null, Joined: Date.UTC(2025, 6, 1, 9, 30), Active: false, CreditLimit: '250.5000' },
      { CustomerID: 3, Name: 'Zoë Café', Email: 'zoe@example.com', Joined: Date.UTC(2026, 0, 20, 17, 45, 10), Active: true, CreditLimit: null },
    ]);
    // The Arrow rows it arrived as are dropped once the typed table is made.
    expect((await tables()).filter((t) => t.endsWith('_arrow'))).toEqual([]);
  });

  it('switches table in one undo step, and switches back without reading again', async () => {
    const s = await addFileSource(database());
    await sync();
    const past = useProjectStore.getState().history.past.length;
    chooseTable(s.id, 'Orders');
    expect(useProjectStore.getState().history.past.length).toBe(past + 1);
    expect(accessReady(project(), s.id)).toBe(false);
    await sync();
    expect(await types(s.id)).toEqual([
      'OrderID INTEGER',
      'CustomerID INTEGER',
      'OrderDate TIMESTAMP',
      'Quantity SMALLINT',
      'Weight DOUBLE',
      'Discount FLOAT',
      'Priority UTINYINT',
      'Amount DECIMAL(19,4)',
      'Notes VARCHAR',
      'Shipped BOOLEAN',
    ]);
    // Steps run on the table like on any other source.
    const p = project();
    const [{ n }] = tableRows((await engine.query(compileCount(p, { nodeId: nodeOf(p, s.id) }))).table) as [{ n: number }];
    expect(n).toBe(4);
    expect(client.reads).toBe(2);

    useProjectStore.getState().undo();
    expect(sourceOf(s.id).parseOptions).toEqual({});
    expect(accessReady(project(), s.id)).toBe(true);
    await sync();
    expect(client.reads).toBe(2);
    expect((await rows(s.id))[0]).toMatchObject({ Name: 'Ann Lee' });
  });

  it('reads an empty table as its columns', async () => {
    const s = await addFileSource(database());
    chooseTable(s.id, 'Archive');
    await sync();
    expect(await types(s.id)).toEqual(['ID INTEGER', 'Note VARCHAR']);
    expect(await rows(s.id)).toEqual([]);
  });

  it('adds the database’s other tables as sources of their own in one undo step, sharing the file', async () => {
    const s = await addFileSource(database());
    await sync();
    const read = useAccessReads.getState().reads[s.id]!;
    if (read.state !== 'ok') throw new Error('not read');
    expect(tablesNotAdded(project(), s, read.tables, useAccessReads.getState().reads).map((t) => t.name)).toEqual(['Orders', 'Archive']);
    const past = useProjectStore.getState().history.past.length;
    const added = addAccessTables(s, ['Orders', 'Archive']);
    expect(useProjectStore.getState().history.past.length).toBe(past + 1);
    expect(added.map((x) => [x.name, x.parseOptions])).toEqual([
      ['Orders', { table: 'Orders' }],
      ['Archive', { table: 'Archive' }],
    ]);
    expect(sourceFile(added[0]!.id)).toBe(sourceFile(s.id));
    await sync();
    expect(await rows(added[0]!.id)).toHaveLength(4);
    expect(tablesNotAdded(project(), s, read.tables, useAccessReads.getState().reads)).toEqual([]);
    // One database, opened once by the worker however many of its tables are read.
    expect(client.reads).toBe(3);
  });

  it('marks the source node unreadable until its table is loaded, then runs it', async () => {
    const s = await addFileSource(database());
    const id = nodeOf(project(), s.id);
    const readable = (sourceId: string) => accessReady(project(), sourceId);
    await evaluateFlow(engine, project(), (x) => !readable(x));
    expect(useFlowStore.getState().nodes[id]?.status.state).toBe('detached');
    await sync();
    await evaluateFlow(engine, project(), (x) => !readable(x));
    expect(useFlowStore.getState().nodes[id]?.status).toMatchObject({ state: 'ok', columns: expect.arrayContaining([{ name: 'CreditLimit', type: 'DECIMAL(19,4)' }]) });
  });

  it('keeps a couple of tables per source and drops a removed source’s tables', async () => {
    const s = await addFileSource(database());
    const mine = async () => (await tables()).filter((t) => t.startsWith(`src_${s.id}_`));
    await sync();
    for (const table of ['Orders', 'Archive', 'Orders']) {
      chooseTable(s.id, table);
      await sync();
    }
    expect(await mine()).toHaveLength(2);
    expect(await mine()).toContain(sourceTableName(sourceOf(s.id)));
    useProjectStore.getState().apply((p) => removeNodes(p, [nodeOf(p, s.id)]));
    await sync();
    await new Promise((r) => setTimeout(r, 10));
    expect(await mine()).toEqual([]);
    expect(useAccessReads.getState().reads[s.id]).toBeUndefined();
  });

  it('reads every table of a reopened project once the database is chosen again', async () => {
    const s = await addFileSource(database());
    addAccessTables(s, ['Orders']);
    await sync();
    const saved = project();
    resetAccessSources();
    useProjectStore.getState().load({ ...saved, id: 'reopened' });
    // A fresh tab: forget the files chosen in this one.
    useAttachments.setState({ sources: {} });
    await attachProject(project());
    const waiting = project().sources;
    await chooseFilesFor(waiting, [database()]);
    expect(waiting.map((x) => useAttachments.getState().sources[x.id])).toEqual(['attached', 'attached']);
    await sync();
    expect(await rows(waiting[1]!.id)).toHaveLength(4);
  });

  it('shows a database that can’t be read as a read failure in plain words, and doesn’t retry it until something changes', async () => {
    // A file with the Access signature and nothing else: the sniff sends it to the Access reader, which can't read it.
    // (A CSV named .accdb no longer gets here: its content wins, and it opens as CSV.)
    const s = await addFileSource(database('shop.accdb', new Uint8Array([0, 1, 0, 0, ...new TextEncoder().encode('Standard ACE DB'), ...new Array(64).fill(0)])));
    await sync();
    expect(useAccessReads.getState().reads[s.id]).toMatchObject({ state: 'failed', message: expect.stringMatching(/^This database can’t be read \(.+\)\. Open it in Access, run Compact and Repair, and add it again\.$/) });
    const reads = client.reads;
    await sync();
    expect(client.reads).toBe(reads);
  });
});
