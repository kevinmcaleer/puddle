// Lookup nodes on real DuckDB-WASM (Node build): customer names brought onto orders, with an order whose customer
// is missing (4) and a customer id that appears twice (5), so the row count must hold.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { compileDisplayPage, sourceFileName } from '../../src/compiler';
import { EngineClient, tableRows } from '../../src/engine/client';
import { checkLookup } from '../../src/flow/lookup';
import { countRows, evaluateFlow, invalidateCaches, schemaCacheFor, useFlowStore } from '../../src/flow/status';
import { groupNodes, swapLookupInputs, ungroupNode, type LookupSpec, type Project } from '../../src/model';
import { createNodeBackend } from '../helpers/nodeBackend';
import { flow, src, step } from '../helpers/projects';

const orders = src({ id: 'orders', format: 'csv' });
const customers = src({ id: 'customers', format: 'csv' });

let engine: EngineClient;
beforeAll(async () => {
  engine = new EngineClient(await createNodeBackend());
  for (const [s, file] of [[orders, 'shop-orders.csv'], [customers, 'shop-customers.csv']] as const)
    await engine.registerBuffer(sourceFileName(s), new Uint8Array(readFileSync(join(__dirname, '../fixtures', file))));
});
afterAll(() => engine.close());
beforeEach(() => invalidateCaches());

const shop = (spec: Partial<LookupSpec>, mainSteps = [] as ReturnType<typeof step>[], lookupSteps = [] as ReturnType<typeof step>[]): Project =>
  flow({
    sources: [orders, customers],
    nodes: [
      { id: 'o', type: 'source', sourceId: 'orders' },
      { id: 'c', type: 'source', sourceId: 'customers' },
      { id: 'mo', type: 'transform', steps: mainSteps },
      { id: 'lc', type: 'transform', steps: lookupSteps },
      { id: 'k', type: 'lookup', lookupSpec: { keys: [{ main: 'customer_id', lookup: 'customer_id' }], columns: ['name'], ...spec } },
      { id: 'out', type: 'output' },
    ],
    wires: [['o', 'mo'], ['c', 'lc'], ['mo', 'k', 'main'], ['lc', 'k', 'lookup'], ['k', 'out']],
  });

/** Column names, then every row as DuckDB prints it, in the order the lookup gives them. */
async function run(p: Project, nodeId = 'out') {
  const columns = (await schemaCacheFor(engine).get(p, { nodeId })).map((c) => c.name);
  const rows = tableRows((await engine.query(compileDisplayPage(p, { nodeId }, columns, 0))).table).map((r) => columns.map((c) => r[c] ?? null));
  return { columns, rows };
}

const states = () => Object.fromEntries(Object.entries(useFlowStore.getState().nodes).map(([id, e]) => [id, e.status.state]));

describe('lookup', () => {
  it('brings a column across, first match in file order, empty where the key is missing, every main row once in its own order', async () => {
    const { columns, rows } = await run(shop({}));
    expect(columns).toEqual(['order_id', 'customer_id', 'total', 'status', 'name']);
    expect(rows.map((r) => [r[0], r[4]])).toEqual([
      ['100', 'Ada'],
      ['101', 'Grace'],
      ['102', 'Ada'],
      ['103', null],
      ['104', 'Barbara'],
    ]);
  });

  it('keeps the main input’s row count, even when the lookup has the same key many times', async () => {
    // Stack customers on themselves so every key appears at least twice.
    const p = shop({ columns: ['name', 'status'] });
    await evaluateFlow(engine, p);
    expect(await countRows(engine, p, 'k')).toBe(5);
    const doubled = shop({}, [], [step('d', 'customSql', { query: 'SELECT * FROM input UNION ALL SELECT * FROM input' })]);
    await evaluateFlow(engine, doubled);
    expect(states()).toMatchObject({ lc: 'ok', k: 'ok' });
    expect(await countRows(engine, doubled, 'k')).toBe(5);
  });

  it('suffixes a brought column the main input already has', async () => {
    const { columns, rows } = await run(shop({ columns: ['name', 'status'] }));
    expect(columns).toEqual(['order_id', 'customer_id', 'total', 'status', 'name', 'status_lookup']);
    expect(rows[4]!.slice(4)).toEqual(['Barbara', 'active']);
  });

  it('fills unmatched rows with a default, and only those', async () => {
    const text = await run(shop({ columns: ['name'], useDefault: true, defaultValue: 'Unknown' }));
    expect(text.rows.map((r) => r[4])).toEqual(['Ada', 'Grace', 'Ada', 'Unknown', 'Barbara']);
    // A number column takes a number as its default, typed as a number.
    const p = shop({ columns: ['customer_id'], useDefault: true, defaultValue: '0' });
    const schema = await schemaCacheFor(engine).get(p, { nodeId: 'k' });
    expect(schema.at(-1)).toEqual({ name: 'customer_id_lookup', type: 'BIGINT' });
    expect((await run(p)).rows.map((r) => r[4])).toEqual(['1', '2', '1', '0', '5']);
  });

  it('matches on several keys', async () => {
    // Customer 5 is in the lookup twice, once active: an order marked active for customer 5 takes that row.
    const active = step('a', 'customSql', { query: "SELECT * REPLACE (CASE WHEN order_id = 104 THEN 'lapsed' ELSE status END AS status) FROM input" });
    const { rows } = await run(shop({ keys: [{ main: 'customer_id', lookup: 'customer_id' }, { main: 'status', lookup: 'status' }] }, [active]));
    expect(rows.map((r) => r[4])).toEqual([null, null, null, null, 'Barbara L']);
  });

  it('counts matches, duplicate keys and missing keys', async () => {
    const p = shop({});
    await evaluateFlow(engine, p);
    expect(await checkLookup(engine, p, 'k')).toEqual({ rows: 5, matched: 4, dupKeys: 1, dupRows: 1, dupExample: '5', missingKeys: 1, missingExample: '4' });
  });
});

describe('lookup in the flow', () => {
  it('is unwired until both inputs are wired, and explains a key type mismatch before running', async () => {
    const p = shop({});
    await evaluateFlow(engine, { ...p, edges: p.edges.filter((e) => e.to.port !== 'lookup') });
    expect(states()).toMatchObject({ mo: 'ok', k: 'unwired', out: 'unwired' });
    const text = shop({}, [], [step('t', 'changeType', { columns: ['customer_id'], to: 'text', onError: 'empty' })]);
    await evaluateFlow(engine, text);
    expect(useFlowStore.getState().nodes.k!.status).toEqual({ state: 'error', message: 'customer_id is a number in the main input and text in the lookup; change one with Change type.' });
  });

  it('says which input lost a column, and which default doesn’t fit', async () => {
    await evaluateFlow(engine, shop({}, [], [step('r', 'removeColumns', { columns: ['name'] })]));
    expect(useFlowStore.getState().nodes.k!.status).toEqual({ state: 'error', message: 'name isn’t in the lookup input any more.', ports: ['lookup'] });
    await evaluateFlow(engine, shop({ columns: ['customer_id'], useDefault: true, defaultValue: 'none' }));
    expect(useFlowStore.getState().nodes.k!.status).toMatchObject({ state: 'error', message: 'customer_id is a number, so it can’t be filled with “none”. Change the default, or leave customer_id out.' });
  });

  it('swapping the inputs turns the keys round and asks for columns again', async () => {
    const swapped = swapLookupInputs(shop({}), 'k');
    expect(swapped.edges.find((e) => e.from.nodeId === 'lc')?.to.port).toBe('main');
    await evaluateFlow(engine, swapped);
    expect(useFlowStore.getState().nodes.k!.status).toMatchObject({ state: 'error', message: 'Pick at least one column to bring across.' });
  });

  it('grouping and ungrouping the lookup branch keeps its port and its result', async () => {
    const p = shop({}, [], [step('u', 'changeCase', { columns: ['name'], mode: 'upper' })]);
    const extra = { ...p, nodes: [...p.nodes, { id: 'lc2', type: 'transform' as const, name: 'lc2', position: { x: 0, y: 0 }, rules: [], steps: [step('t', 'trimWhitespace', { columns: ['name'] })] }] };
    const lined = { ...extra, edges: [...extra.edges.filter((e) => e.to.port !== 'lookup'), { id: 'x1', from: { nodeId: 'lc' }, to: { nodeId: 'lc2', port: 0 } }, { id: 'x2', from: { nodeId: 'lc2' }, to: { nodeId: 'k', port: 'lookup' as const } }] };
    const expected = await run(lined);
    expect(expected.rows[0]![4]).toBe('ADA');
    const grouped = groupNodes(lined, ['lc', 'lc2']);
    expect(grouped.edges.find((e) => e.to.nodeId === 'k' && e.to.port === 'lookup')?.from.nodeId).toBe('lc');
    expect(await run(grouped)).toEqual(expected);
    expect(await run(ungroupNode(grouped, 'lc'))).toEqual(expected);
  });
});
