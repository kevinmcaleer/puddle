// Schema table nodes on real DuckDB-WASM (Node build): the project's DBML built as tables with keys, constraints and
// records, read by nodes, and loaded from CSV fixtures with every constraint checked before anything is let through.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { compile, compileExport, compileLoadCheck, describeFailure, FAILURE_COLUMN, LOAD_FAILURES, SchemaCache, sourceFileName } from '../../src/compiler';
import { EngineClient, tableRows } from '../../src/engine/client';
import { parseProject, type Project } from '../../src/model';
import { evaluateFlow, invalidateCaches, useFlowStore } from '../../src/flow/status';
import { buildSchema } from '../../src/schemaTables/build';
import { resetSchemaTables, syncSchemaTables, tableGate, useSchemaTables } from '../../src/schemaTables/state';
import { createNodeBackend } from '../helpers/nodeBackend';
import { flow, src } from '../helpers/projects';

const DBML = readFileSync(join(__dirname, '../fixtures/dbml/tables.dbml'), 'utf8');
const customersCsv = src({ id: 'shop-customers', format: 'csv' });
const ordersCsv = src({ id: 'shop-orders', format: 'csv' });
const badCsv = src({ id: 'bad-customers', format: 'csv' });

let engine: EngineClient;
beforeAll(async () => {
  engine = new EngineClient(await createNodeBackend());
  for (const s of [customersCsv, ordersCsv]) await engine.registerBuffer(sourceFileName(s), new Uint8Array(readFileSync(join(__dirname, `../fixtures/${s.id}.csv`))));
  // An empty name, an id already in the table's records, an id that isn't a number, and a repeated id.
  await engine.registerBuffer(sourceFileName(badCsv), new TextEncoder().encode('customer_id,name\n1,Ada\n2,\n10,Again\nx,Nobody\n1,Ada twice\n'));
});
afterAll(() => engine.close());

type TableNode = { id: string; type: 'table'; tableSpec: { schema?: string; table: string; examples?: boolean; mapping?: Record<string, string> } };

function project(nodes: Array<Parameters<typeof flow>[0]['nodes'][number] | TableNode>, wires: Array<[string, string]> = [], dbml = DBML): Project {
  const base = flow({ sources: [customersCsv, ordersCsv, badCsv], nodes: [] as never[], wires: [] });
  return parseProject({ ...base, schema: { dbml, positions: {} }, nodes: nodes.map((n) => ({ name: n.id, ...n })), edges: wires.map(([from, to], i) => ({ id: `e${i}`, from: { nodeId: from }, to: { nodeId: to, port: 0 } })) });
}

const rows = async (p: Project, nodeId: string) => {
  const cache = new SchemaCache((sql) => engine.describe(sql));
  await cache.prepare(p, { nodeId });
  // Decimals come back from Arrow raw, so they are read as doubles here.
  const sql = compile(p, { nodeId }, { schemas: cache.book }).sql;
  const columns = await engine.describe(sql);
  const select = columns.map((c) => (c.type.startsWith('DECIMAL') ? `CAST("${c.name}" AS DOUBLE) AS "${c.name}"` : `"${c.name}"`)).join(', ');
  return tableRows((await engine.query(`SELECT ${select} FROM (${sql})`)).table);
};

async function failures(p: Project, nodeId: string): Promise<string[]> {
  const cache = new SchemaCache((sql) => engine.describe(sql));
  await cache.prepare(p, { nodeId });
  for (const n of p.nodes) await cache.prepare(p, { nodeId: n.id });
  const check = compileLoadCheck(p, nodeId, { schemas: cache.book })!;
  const counts = tableRows((await engine.query(check.sql)).table)[0]!;
  return check.checks.flatMap((c, i) => (Number(counts[`f${i}`]) ? [describeFailure(c, Number(counts[`f${i}`]))] : []));
}

describe('building the schema', () => {
  it('creates every table with its records, keys and foreign keys', async () => {
    const built = await buildSchema(engine, project([]));
    expect(Object.fromEntries(Object.entries(built.tables).map(([k, v]) => [k, v.state]))).toEqual({ 'public.customers': 'ok', 'public.orders': 'ok' });
    expect(tableRows((await engine.query('SELECT customer_id, name, status FROM dbml_public.customers')).table)).toEqual([{ customer_id: 10, name: 'Margaret', status: 'active' }]);
    // Example records stay out of the table itself.
    expect(tableRows((await engine.query('SELECT count(*) AS n FROM dbml_public.orders')).table)[0]!.n).toBe(0);
    // DuckDB itself refuses an order for a customer who isn't there, and a total below zero.
    await expect(engine.query(`INSERT INTO dbml_public.orders VALUES (1, 99, 1, 'pending')`)).rejects.toThrow();
    await expect(engine.query(`INSERT INTO dbml_public.orders VALUES (1, 10, -1, 'pending')`)).rejects.toThrow();
    await expect(engine.query(`INSERT INTO dbml_public.orders VALUES (1, 10, 1, 'lost')`)).rejects.toThrow();
  });

  it('rebuilds from scratch when the DBML changes, dropping tables no longer in it', async () => {
    const first = await buildSchema(engine, project([]));
    const next = await buildSchema(engine, project([], [], 'Table notes {\n  id int [pk]\n}'), first.schemas);
    expect(Object.keys(next.tables)).toEqual(['public.notes']);
    await expect(engine.query('SELECT * FROM dbml_public.customers')).rejects.toThrow();
    await buildSchema(engine, project([]), next.schemas);
  });

  it('builds a table DuckDB refuses a default of without it, and says so', async () => {
    const built = await buildSchema(engine, project([], [], "Table t {\n  id int [pk]\n  at timestamp [default: `now() - interval '5 days'`]\n}"));
    expect(built.tables['public.t']!.state).toBe('ok');
    expect(built.tables['public.t']!.notes.join(' ')).toContain('without its expression defaults');
    await buildSchema(engine, project([]), built.schemas);
  });

  it('fails a table whose records break its constraints, with DuckDB’s reason', async () => {
    const built = await buildSchema(engine, project([], [], "Table t {\n  id int [pk]\n}\nrecords t(id) {\n  1\n  1\n}"));
    expect(built.tables['public.t']).toMatchObject({ state: 'failed', message: expect.stringContaining('The records of t can’t be added') });
    await buildSchema(engine, project([]), built.schemas);
  });
});

describe('a Schema table node', () => {
  beforeAll(() => buildSchema(engine, project([])));

  it('holds its records, and its example records when they are shown', async () => {
    expect((await rows(project([{ id: 'c', type: 'table', tableSpec: { table: 'customers' } }]), 'c')).map((r) => r.name)).toEqual(['Margaret']);
    expect(await rows(project([{ id: 'o', type: 'table', tableSpec: { table: 'orders' } }]), 'o')).toEqual([{ order_id: 900, customer_id: 10, total: 1.5, status: 'pending' }]);
    expect(await rows(project([{ id: 'o', type: 'table', tableSpec: { table: 'orders', examples: false } }]), 'o')).toEqual([]);
  });

  it('loads a CSV by column name, cast to the designed types, defaults filling the rest', async () => {
    const p = project([{ id: 's', type: 'source', sourceId: customersCsv.id }, { id: 'c', type: 'table', tableSpec: { table: 'customers' } }], [['s', 'c']]);
    const got = await rows(p, 'c');
    expect(got.map((r) => [r.customer_id, r.name, r.status])).toEqual([
      [10, 'Margaret', 'active'],
      [1, 'Ada', 'active'],
      [2, 'Grace', 'active'],
      [3, 'Edsger', 'lapsed'],
      [5, 'Barbara', 'active'],
      [5, 'Barbara L', 'lapsed'],
    ]);
    expect(got.every((r) => r.joined != null)).toBe(true);
    // The fixture has customer 5 twice, which the key refuses.
    expect(await failures(p, 'c')).toEqual(['2 rows have a customer_id that is already in the table or repeated']);
  });

  it('maps a column by hand, or leaves it to its default', async () => {
    const p = project([{ id: 's', type: 'source', sourceId: customersCsv.id }, { id: 'c', type: 'table', tableSpec: { table: 'customers', mapping: { name: 'status', status: '' } } }], [['s', 'c']]);
    expect((await rows(p, 'c'))[1]).toMatchObject({ customer_id: 1, name: 'active', status: 'active' });
  });

  it('refuses a load that breaks not null, the key, or a type, and says which rows', async () => {
    const p = project([{ id: 's', type: 'source', sourceId: badCsv.id }, { id: 'c', type: 'table', tableSpec: { table: 'customers' } }], [['s', 'c']]);
    expect(await failures(p, 'c')).toEqual(['1 row has a customer_id that isn’t integer', '1 row has no name', '3 rows have a customer_id that is already in the table or repeated']);
    const cache = new SchemaCache((sql) => engine.describe(sql));
    await cache.prepare(p, { nodeId: 'c' });
    const failing = tableRows((await engine.query(compile(p, { nodeId: 'c', failingRuleId: LOAD_FAILURES }, { schemas: cache.book }).sql)).table);
    expect(failing.map((r) => [r.customer_id, r[FAILURE_COLUMN]])).toEqual([
      ['1', 'a customer_id that is already in the table or repeated'],
      ['2', 'no name'],
      ['10', 'a customer_id that is already in the table or repeated'],
      ['x', 'a customer_id that isn’t integer'],
      ['1', 'a customer_id that is already in the table or repeated'],
    ]);
  });

  it('checks a load’s foreign keys against the parent table’s node, loads included', async () => {
    const p = project(
      [
        { id: 'sc', type: 'source', sourceId: customersCsv.id },
        { id: 'so', type: 'source', sourceId: ordersCsv.id },
        { id: 'c', type: 'table', tableSpec: { table: 'customers' } },
        { id: 'o', type: 'table', tableSpec: { table: 'orders', examples: false } },
      ],
      [
        ['sc', 'c'],
        ['so', 'o'],
      ],
    );
    // Order 103 is for customer 4, who isn't in the customers loaded; the other orders' customers are.
    expect(await failures(p, 'o')).toContain('1 row has a customer_id that isn’t in customers');
    // Without a customers node, only the table's records count: every order's customer is missing.
    const alone = project([{ id: 'so', type: 'source', sourceId: ordersCsv.id }, { id: 'o', type: 'table', tableSpec: { table: 'orders', examples: false } }], [['so', 'o']]);
    expect(await failures(alone, 'o')).toEqual(['5 rows have a customer_id that isn’t in customers']);
  });

  it('can be joined and exported like any other node', async () => {
    const p = project(
      [
        { id: 'sc', type: 'source', sourceId: customersCsv.id },
        { id: 'c', type: 'table', tableSpec: { table: 'customers' } },
        { id: 'o', type: 'table', tableSpec: { table: 'orders' } },
        { id: 'j', type: 'join', joinSpec: { kind: 'inner', keys: [{ left: 'customer_id', right: 'customer_id' }] } } as never,
        { id: 'out', type: 'output' },
      ],
      [['sc', 'c'], ['c', 'j'], ['j', 'out']],
    );
    const withRight = { ...p, edges: [...p.edges, { id: 'right', from: { nodeId: 'o' }, to: { nodeId: 'j', port: 'right' as const } }].map((e) => (e.to.nodeId === 'j' && e.id !== 'right' ? { ...e, to: { ...e.to, port: 'left' as const } } : e)) };
    const got = await rows(withRight, 'out');
    expect(got.map((r) => [r.name, r.order_id])).toEqual([['Margaret', 900]]);
    const cache = new SchemaCache((sql) => engine.describe(sql));
    await cache.prepare(withRight, { nodeId: 'out' });
    const { blob } = await engine.exportFile('schema-join.csv', (path) => compileExport(withRight, 'out', path));
    expect((await blob.text()).trim().split('\n')[1]).toContain('Margaret');
  });
});

describe('schema tables in the editor', () => {
  const status = (id: string) => useFlowStore.getState().nodes[id]?.status;
  const evaluate = (p: Project) => evaluateFlow(engine, p, () => false, (node) => tableGate(p, node));
  beforeEach(() => {
    resetSchemaTables();
    invalidateCaches();
  });

  it('waits for the schema to be built, then reads the table', async () => {
    const p = project([{ id: 'c', type: 'table', tableSpec: { table: 'customers' } }, { id: 'out', type: 'output' }], [['c', 'out']]);
    await evaluate(p);
    expect([status('c')?.state, status('out')?.state]).toEqual(['pending', 'pending']);
    await syncSchemaTables(engine, p);
    expect(useSchemaTables.getState()).toMatchObject({ building: null, built: { tables: { 'public.customers': { state: 'ok' } } } });
    await evaluate(p);
    expect([status('c')?.state, status('out')?.state]).toEqual(['ok', 'ok']);
  });

  it('builds nothing for a project without schema tables, and rebuilds only when the DBML changes', async () => {
    await syncSchemaTables(engine, project([]));
    expect(useSchemaTables.getState().built).toBeNull();
    const p = project([{ id: 'c', type: 'table', tableSpec: { table: 'customers' } }]);
    await syncSchemaTables(engine, p);
    const first = useSchemaTables.getState().built;
    await syncSchemaTables(engine, p);
    expect(useSchemaTables.getState().built).toBe(first);
  });

  it('marks a node whose table can’t be built as broken', async () => {
    const p = project([{ id: 't', type: 'table', tableSpec: { table: 't' } }], [], "Table t {\n  id int [pk]\n}\nrecords t(id) {\n  1\n  1\n}");
    await syncSchemaTables(engine, p);
    await evaluate(p);
    expect(status('t')).toMatchObject({ state: 'error', message: expect.stringContaining('The records of t can’t be added') });
    await syncSchemaTables(engine, project([{ id: 'c', type: 'table', tableSpec: { table: 'customers' } }]));
  });

  it('stops a load that breaks the table, so nothing downstream reads it', async () => {
    const p = project([{ id: 's', type: 'source', sourceId: badCsv.id }, { id: 'c', type: 'table', tableSpec: { table: 'customers' } }, { id: 'out', type: 'output' }], [['s', 'c'], ['c', 'out']]);
    await syncSchemaTables(engine, p);
    await evaluate(p);
    expect(status('c')).toMatchObject({ state: 'error', failures: ['1 row has a customer_id that isn’t integer', '1 row has no name', '3 rows have a customer_id that is already in the table or repeated'] });
    expect(status('out')?.state).toBe('blocked');
  });
});
