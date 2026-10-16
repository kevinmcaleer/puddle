// Join nodes on real DuckDB-WASM (Node build): every join type on orders and customers, with an order whose
// customer is missing, a customer with no orders and a customer id that appears twice.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { compileDisplayPage, sourceFileName } from '../../src/compiler';
import { EngineClient, tableRows } from '../../src/engine/client';
import { checkJoin, multiplied } from '../../src/flow/join';
import { evaluateFlow, invalidateCaches, schemaCacheFor, useFlowStore } from '../../src/flow/status';
import { canGroup, connect, groupNodes, removeNodes, swapJoinInputs, ungroupNode, type JoinSpec, type Project } from '../../src/model';
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

const shop = (spec: Partial<JoinSpec>, leftSteps = [] as ReturnType<typeof step>[], rightSteps = [] as ReturnType<typeof step>[]): Project =>
  flow({
    sources: [orders, customers],
    nodes: [
      { id: 'o', type: 'source', sourceId: 'orders' },
      { id: 'c', type: 'source', sourceId: 'customers' },
      { id: 'lo', type: 'transform', steps: leftSteps },
      { id: 'rc', type: 'transform', steps: rightSteps },
      { id: 'j', type: 'join', joinSpec: { keys: [{ left: 'customer_id', right: 'customer_id' }], ...spec } },
      { id: 'out', type: 'output' },
    ],
    wires: [['o', 'lo'], ['c', 'rc'], ['lo', 'j', 'left'], ['rc', 'j', 'right'], ['j', 'out']],
  });

/** Column names, then every row as DuckDB prints it, sorted so join order doesn't matter. */
async function run(p: Project, nodeId = 'out') {
  const columns = (await schemaCacheFor(engine).get(p, { nodeId })).map((c) => c.name);
  const rows = tableRows((await engine.query(compileDisplayPage(p, { nodeId }, columns, 0))).table).map((r) => columns.map((c) => r[c] ?? null));
  const key = (r: unknown[]) => JSON.stringify(r);
  return { columns, rows: rows.sort((a, b) => (key(a) < key(b) ? -1 : 1)) };
}

const states = () => Object.fromEntries(Object.entries(useFlowStore.getState().nodes).map(([id, e]) => [id, e.status.state]));

describe('join types', () => {
  it('inner keeps matching rows, one per match, and suffixes the clashing right column', async () => {
    const { columns, rows } = await run(shop({ kind: 'inner' }));
    expect(columns).toEqual(['order_id', 'customer_id', 'total', 'status', 'name', 'status_right']);
    expect(rows).toEqual([
      ['100', '1', '12.5', 'shipped', 'Ada', 'active'],
      ['101', '2', '8.0', 'pending', 'Grace', 'active'],
      ['102', '1', '3.25', 'shipped', 'Ada', 'active'],
      ['104', '5', '1.0', 'pending', 'Barbara L', 'lapsed'],
      ['104', '5', '1.0', 'pending', 'Barbara', 'active'],
    ]);
  });

  it('left keeps every order, with empty customer columns where none matches', async () => {
    const { rows } = await run(shop({ kind: 'left' }));
    expect(rows).toHaveLength(6);
    expect(rows).toContainEqual(['103', '4', '9.99', 'shipped', null, null]);
  });

  it('right keeps every customer, taking the key from the right where no order matches', async () => {
    const { columns, rows } = await run(shop({ kind: 'right' }));
    expect(columns).toEqual(['order_id', 'customer_id', 'total', 'status', 'name', 'status_right']);
    expect(rows).toHaveLength(6);
    expect(rows).toContainEqual([null, '3', null, null, 'Edsger', 'lapsed']);
    expect(rows.some((r) => r[0] === '103')).toBe(false);
  });

  it('full keeps every row from both sides', async () => {
    const { rows } = await run(shop({ kind: 'full' }));
    expect(rows).toHaveLength(7);
    expect(rows).toContainEqual(['103', '4', '9.99', 'shipped', null, null]);
    expect(rows).toContainEqual([null, '3', null, null, 'Edsger', 'lapsed']);
  });

  it('anti keeps the orders with no customer, with only the order columns', async () => {
    expect(await run(shop({ kind: 'anti' }))).toEqual({ columns: ['order_id', 'customer_id', 'total', 'status'], rows: [['103', '4', '9.99', 'shipped']] });
  });

  it('semi keeps the orders with a customer, once each even when the key repeats', async () => {
    const { columns, rows } = await run(shop({ kind: 'semi' }));
    expect(columns).toEqual(['order_id', 'customer_id', 'total', 'status']);
    expect(rows.map((r) => r[0])).toEqual(['100', '101', '102', '104']);
  });

  it('keeps both keys when their names differ, and uses the suffix it is given', async () => {
    const p = shop({ kind: 'inner', keys: [{ left: 'customer_id', right: 'cid' }], suffix: '_c' }, [], [step('r', 'renameColumns', { renames: [{ from: 'customer_id', to: 'cid' }] })]);
    const { columns, rows } = await run(p);
    expect(columns).toEqual(['order_id', 'customer_id', 'total', 'status', 'cid', 'name', 'status_c']);
    expect(rows).toHaveLength(5);
  });

  it('matches on several key pairs at once', async () => {
    const p = shop({ kind: 'inner', keys: [{ left: 'customer_id', right: 'customer_id' }, { left: 'status', right: 'want' }] }, [], [step('a', 'addColumn', { name: 'want', expression: "CASE WHEN status = 'active' THEN 'shipped' ELSE 'pending' END" })]);
    const { rows } = await run(p);
    // Orders 100 and 102 (Ada, active, shipped) and 104 with Barbara L (lapsed, pending).
    expect(rows.map((r) => [r[0], r[4]])).toEqual([
      ['100', 'Ada'],
      ['102', 'Ada'],
      ['104', 'Barbara L'],
    ]);
  });
});

describe('join in the flow', () => {
  it('evaluates both branches and the join, and counts its rows', async () => {
    const p = shop({ kind: 'left' });
    await evaluateFlow(engine, p);
    expect(states()).toEqual({ o: 'ok', c: 'ok', lo: 'ok', rc: 'ok', j: 'ok', out: 'ok' });
    await vi.waitFor(() => {
      const s = useFlowStore.getState().nodes.j!.status;
      expect(s.state === 'ok' && s.rows).toBe(6);
    });
  });

  it('marks the join unwired when either input loses its wire', async () => {
    const p = shop({ kind: 'left' });
    for (const port of ['left', 'right']) {
      await evaluateFlow(engine, { ...p, edges: p.edges.filter((e) => !(e.to.nodeId === 'j' && e.to.port === port)) });
      expect(states()).toMatchObject({ j: 'unwired', out: 'unwired' });
    }
  });

  it('breaks the join, naming the right input, when a key column disappears upstream on the right', async () => {
    await evaluateFlow(engine, shop({ kind: 'left' }, [], [step('r', 'removeColumns', { columns: ['customer_id'] })]));
    expect(states()).toMatchObject({ rc: 'ok', lo: 'ok', j: 'error', out: 'blocked' });
    const j = useFlowStore.getState().nodes.j!.status;
    expect(j).toEqual({ state: 'error', message: 'customer_id isn’t in the right input any more.', ports: ['right'] });
  });

  it('explains a key type mismatch before running anything', async () => {
    await evaluateFlow(engine, shop({ kind: 'left' }, [], [step('t', 'changeType', { columns: ['customer_id'], to: 'text', onError: 'empty' })]));
    const j = useFlowStore.getState().nodes.j!.status;
    expect(j).toEqual({ state: 'error', message: 'customer_id is a number on the left and text on the right; change one with Change type.' });
  });

  it('a change on either branch changes the join’s key, and only that', async () => {
    const p = shop({ kind: 'left' });
    await evaluateFlow(engine, p);
    const before = useFlowStore.getState().nodes;
    const changed = shop({ kind: 'left' }, [], [step('u', 'changeCase', { columns: ['name'], mode: 'upper' })]);
    await evaluateFlow(engine, changed);
    const after = useFlowStore.getState().nodes;
    expect(after.lo).toBe(before.lo);
    expect(after.j!.key).not.toBe(before.j!.key);
    expect((await run(changed)).rows[0]![4]).toBe('ADA');
  });

  it('counts the rows a join multiplies', async () => {
    const p = shop({ kind: 'left' });
    await evaluateFlow(engine, p);
    const counts = await checkJoin(engine, p, 'j');
    expect(counts).toEqual({ leftRows: 5, rightRows: 5, rows: 6, pairs: 5, matchedLeft: 4, matchedRight: 4 });
    expect(multiplied('left', counts)).toEqual({ side: 'left', before: 5, after: 6 });
    expect(multiplied('semi', counts)).toBeUndefined();
    // Without the repeated customer, nothing multiplies.
    const unique = shop({ kind: 'left' }, [], [step('d', 'duplicateRows', { columns: ['customer_id'], keep: 'first' })]);
    await evaluateFlow(engine, unique);
    expect(multiplied('left', await checkJoin(engine, unique, 'j'))).toBeUndefined();
  });

  it('swapping the inputs joins customers to orders instead', async () => {
    const { columns, rows } = await run(swapJoinInputs(shop({ kind: 'anti' }), 'j'));
    expect(columns).toEqual(['customer_id', 'name', 'status']);
    expect(rows).toEqual([['3', 'Edsger', 'lapsed']]);
  });
});

describe('grouping and undo around a join', () => {
  const grouped = () =>
    flow({
      sources: [orders, customers],
      nodes: [
        { id: 'o', type: 'source', sourceId: 'orders' },
        { id: 'c', type: 'source', sourceId: 'customers' },
        { id: 'a', type: 'transform', steps: [step('u', 'changeCase', { columns: ['name'], mode: 'upper' })] },
        { id: 'b', type: 'transform', steps: [step('d', 'removeColumns', { columns: ['status'] })] },
        { id: 'j', type: 'join', joinSpec: { kind: 'inner', keys: [{ left: 'customer_id', right: 'customer_id' }] } },
        { id: 'out', type: 'output' },
      ],
      wires: [['o', 'j', 'left'], ['c', 'a'], ['a', 'b'], ['b', 'j', 'right'], ['j', 'out']],
    });

  it('grouping the right branch keeps it in the right input, and ungrouping gives the same flow back', async () => {
    const p = grouped();
    const expected = await run(p);
    expect(expected.columns).toEqual(['order_id', 'customer_id', 'total', 'status', 'name']);
    const g = groupNodes(p, ['a', 'b']);
    expect(g.edges.find((e) => e.to.nodeId === 'j' && e.to.port === 'right')?.from.nodeId).toBe('a');
    expect(await run(g)).toEqual(expected);
    const back = ungroupNode(g, 'a');
    expect(back.edges.find((e) => e.to.nodeId === 'j' && e.to.port === 'right')?.from.nodeId).toBe('b');
    expect(await run(back)).toEqual(expected);
  });

  it('refuses to group a Join node', () => {
    expect(canGroup(grouped(), ['b', 'j'])).toEqual({ ok: false, reason: 'Only Transform nodes can be grouped.' });
  });

  it('deleting an input and wiring it back gives the same rows', async () => {
    const p = grouped();
    const expected = await run(p);
    const gone = removeNodes(p, ['o']);
    await evaluateFlow(engine, gone);
    expect(states()).toMatchObject({ j: 'unwired' });
    const back = connect({ ...gone, nodes: [...gone.nodes, p.nodes[0]!], sources: p.sources }, { id: 'x', from: { nodeId: 'o' }, to: { nodeId: 'j', port: 'left' } });
    expect(await run(back)).toEqual(expected);
  });
});
