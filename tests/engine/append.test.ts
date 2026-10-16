// Append nodes on real DuckDB-WASM (Node build): customers stacked with more customers that have an extra
// column, by name and by position, with a source column, and a file whose id is text.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { compileDisplayPage, sourceFileName } from '../../src/compiler';
import { EngineClient, tableRows } from '../../src/engine/client';
import { countRows, evaluateFlow, invalidateCaches, schemaCacheFor, useFlowStore } from '../../src/flow/status';
import { groupNodes, swapAppendInputs, ungroupNode, type AppendSpec, type Project } from '../../src/model';
import { createNodeBackend } from '../helpers/nodeBackend';
import { flow, src, step } from '../helpers/projects';

const cust = src({ id: 'cust', format: 'csv', name: 'customers.csv' });
const more = src({ id: 'more', format: 'csv', name: 'customers-more.csv' });
const codes = src({ id: 'codes', format: 'csv', name: 'customers-codes.csv' });

let engine: EngineClient;
beforeAll(async () => {
  engine = new EngineClient(await createNodeBackend());
  for (const [s, file] of [[cust, 'customers.csv'], [more, 'customers-more.csv'], [codes, 'customers-codes.csv']] as const)
    await engine.registerBuffer(sourceFileName(s), new Uint8Array(readFileSync(join(__dirname, '../fixtures', file))));
});
afterAll(() => engine.close());
beforeEach(() => invalidateCaches());

/** Sources stacked into one Append in the order given, then an Output. */
const stack = (spec: Partial<AppendSpec>, ...inputs: Array<{ id: string; sourceId: string; steps?: ReturnType<typeof step>[] }>): Project =>
  flow({
    sources: [cust, more, codes],
    nodes: [
      ...inputs.flatMap((i) => [
        { id: `s_${i.id}`, type: 'source' as const, sourceId: i.sourceId },
        { id: i.id, type: 'transform' as const, steps: i.steps ?? [] },
      ]),
      { id: 'a', type: 'append', appendSpec: spec },
      { id: 'out', type: 'output' },
    ],
    wires: [...inputs.flatMap((i, n) => [[`s_${i.id}`, i.id], [i.id, 'a', n]] as Array<[string, string, number?]>), ['a', 'out']],
  });

async function run(p: Project, nodeId = 'out') {
  const schema = await schemaCacheFor(engine).get(p, { nodeId });
  const columns = schema.map((c) => c.name);
  const rows = tableRows((await engine.query(compileDisplayPage(p, { nodeId }, columns, 0))).table).map((r) => columns.map((c) => r[c] ?? null));
  return { columns, types: schema.map((c) => c.type), rows };
}

const states = () => Object.fromEntries(Object.entries(useFlowStore.getState().nodes).map(([id, e]) => [id, e.status.state]));

describe('append by name', () => {
  it('stacks rows in input order and fills a column missing from one input with empty values', async () => {
    const { columns, rows } = await run(stack({}, { id: 'c', sourceId: 'cust' }, { id: 'm', sourceId: 'more' }));
    expect(columns).toEqual(['id', 'name', 'email', 'joined', 'phone']);
    expect(rows.map((r) => r[0])).toEqual(['1', '2', '3', '4', '5', '6']);
    expect(rows[0]![4]).toBeNull();
    expect(rows[4]).toEqual(['5', 'Barbara Liskov', 'barbara@example.com', '2024-04-01', '0113 496 0000']);
  });

  it('keeps the input order when the extra column comes first', async () => {
    const { columns, rows } = await run(stack({}, { id: 'm', sourceId: 'more' }, { id: 'c', sourceId: 'cust' }));
    expect(columns).toEqual(['id', 'name', 'email', 'joined', 'phone']);
    expect(rows.map((r) => r[0])).toEqual(['5', '6', '1', '2', '3', '4']);
  });

  it('matches names without regard to case and in any column order', async () => {
    const p = stack({}, { id: 'c', sourceId: 'cust' }, { id: 'm', sourceId: 'more', steps: [step('r', 'renameColumns', { renames: [{ from: 'name', to: 'NAME' }] }), step('o', 'reorderColumns', { columns: ['email', 'id'] })] });
    const { columns, rows } = await run(p);
    expect(columns).toEqual(['id', 'name', 'email', 'joined', 'phone']);
    expect(rows[4]!.slice(0, 3)).toEqual(['5', 'Barbara Liskov', 'barbara@example.com']);
  });

  it('widens numbers of different kinds', async () => {
    const p = stack({}, { id: 'c', sourceId: 'cust' }, { id: 'm', sourceId: 'more', steps: [step('t', 'changeType', { columns: ['id'], to: 'decimal', onError: 'empty' })] });
    const { types } = await run(p);
    expect(types[0]).toMatch(/DOUBLE|DECIMAL/);
  });

  it('adds a source column naming each row’s input', async () => {
    const { columns, rows } = await run(stack({ tagRows: true, tagColumn: 'from' }, { id: 'c', sourceId: 'cust' }, { id: 'm', sourceId: 'more' }));
    expect(columns).toEqual(['id', 'name', 'email', 'joined', 'phone', 'from']);
    expect(rows.map((r) => r[5])).toEqual(['c', 'c', 'c', 'c', 'm', 'm']);
  });

  it('stacks three inputs, skipping an empty input between them', async () => {
    const p = stack({}, { id: 'c', sourceId: 'cust' }, { id: 'm', sourceId: 'more' }, { id: 'c2', sourceId: 'cust' });
    const gap = { ...p, edges: p.edges.map((e) => (e.to.nodeId === 'a' && e.to.port === 2 ? { ...e, to: { ...e.to, port: 4 } } : e)) };
    expect((await run(gap)).rows).toHaveLength(10);
  });
});

describe('append by position', () => {
  it('takes names from the first input and lines columns up by place', async () => {
    const p = stack({ match: 'position' }, { id: 'c', sourceId: 'cust' }, { id: 'm', sourceId: 'more', steps: [step('r', 'renameColumns', { renames: [{ from: 'name', to: 'full_name' }] })] });
    const { columns, rows } = await run(p);
    expect(columns).toEqual(['id', 'name', 'email', 'joined', 'phone']);
    expect(rows[4]!.slice(0, 2)).toEqual(['5', 'Barbara Liskov']);
    expect(rows[0]![4]).toBeNull();
  });
});

describe('append in the flow', () => {
  it('is unwired until two inputs are wired', async () => {
    const p = stack({}, { id: 'c', sourceId: 'cust' }, { id: 'm', sourceId: 'more' });
    await evaluateFlow(engine, { ...p, edges: p.edges.filter((e) => !(e.to.nodeId === 'a' && e.to.port === 1)) });
    expect(states()).toMatchObject({ c: 'ok', a: 'unwired', out: 'unwired' });
    await evaluateFlow(engine, p);
    expect(states()).toMatchObject({ a: 'ok', out: 'ok' });
  });

  it('explains a type clash before running, naming the input', async () => {
    await evaluateFlow(engine, stack({}, { id: 'c', sourceId: 'cust' }, { id: 'k', sourceId: 'codes' }));
    expect(useFlowStore.getState().nodes.a!.status).toEqual({ state: 'error', message: 'id is a number in c and text in k; change one with Change type.', ports: [1] });
    // Changing the type on one side fixes it.
    const fixed = stack({}, { id: 'c', sourceId: 'cust', steps: [step('t', 'changeType', { columns: ['id'], to: 'text', onError: 'empty' })] }, { id: 'k', sourceId: 'codes' });
    await evaluateFlow(engine, fixed);
    expect(states()).toMatchObject({ a: 'ok' });
    expect((await run(fixed)).rows.map((r) => r[0])).toEqual(['1', '2', '3', '4', 'C7']);
  });

  it('a row count for a node that no longer stacks rejects instead of throwing', async () => {
    // The results table counts the viewed node in an effect, which can run before the canvas marks it broken.
    const p = stack({ tagRows: true, tagColumn: 'phone' }, { id: 'c', sourceId: 'cust' }, { id: 'm', sourceId: 'more' });
    await evaluateFlow(engine, p);
    let counted: Promise<number> | undefined;
    expect(() => (counted = countRows(engine, p, 'a'))).not.toThrow();
    await expect(counted).rejects.toThrow('There’s already a column called phone. Pick another name for the source column.');
  });

  it('reorders its rows when inputs swap, and renaming an input changes the source column', async () => {
    const p = stack({ tagRows: true, tagColumn: 'from' }, { id: 'c', sourceId: 'cust' }, { id: 'm', sourceId: 'more' });
    const swapped = swapAppendInputs(p, 'a', 0, 1);
    expect((await run(swapped)).rows.map((r) => r[0])).toEqual(['5', '6', '1', '2', '3', '4']);
    const renamed = { ...p, nodes: p.nodes.map((n) => (n.id === 'm' ? { ...n, name: 'More' } : n)) };
    expect((await run(renamed)).rows.map((r) => r[5])).toEqual(['c', 'c', 'c', 'c', 'More', 'More']);
  });

  it('grouping and ungrouping a branch keeps its input number', async () => {
    const p = stack({}, { id: 'c', sourceId: 'cust' }, { id: 'm', sourceId: 'more', steps: [step('u', 'changeCase', { columns: ['name'], mode: 'upper' })] });
    // Add a node after m so m and it form a line, then group them.
    const extra = { ...p, nodes: [...p.nodes, { id: 'm2', type: 'transform' as const, name: 'm2', position: { x: 0, y: 0 }, rules: [], steps: [step('t', 'trimWhitespace', { columns: ['name'] })] }] };
    const lined = { ...extra, edges: [...extra.edges.filter((e) => !(e.from.nodeId === 'm' && e.to.nodeId === 'a')), { id: 'x1', from: { nodeId: 'm' }, to: { nodeId: 'm2', port: 0 } }, { id: 'x2', from: { nodeId: 'm2' }, to: { nodeId: 'a', port: 1 } }] };
    const expected = await run(lined);
    const grouped = groupNodes(lined, ['m', 'm2']);
    expect(grouped.edges.find((e) => e.to.nodeId === 'a' && e.to.port === 1)?.from.nodeId).toBe('m');
    expect(await run(grouped)).toEqual(expected);
    expect(await run(ungroupNode(grouped, 'm'))).toEqual(expected);
  });
});
