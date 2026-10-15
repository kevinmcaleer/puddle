// Node statuses, results pages and profiles on real DuckDB-WASM (Node build) against fixture files.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { compileDisplayPage, compileProfile, sourceFileName } from '../../src/compiler';
import { EngineClient, tableRows } from '../../src/engine/client';
import { countRows, evaluateFlow, invalidateCaches, useFlowStore } from '../../src/flow/status';
import { groupNodes, splitNode, ungroupNode, type Project, type Source } from '../../src/model';
import { createNodeBackend } from '../helpers/nodeBackend';
import { flow, src, step } from '../helpers/projects';

const fixture = (name: string) => new Uint8Array(readFileSync(join(__dirname, '../fixtures', name)));

let engine: EngineClient;
beforeAll(async () => {
  engine = new EngineClient(await createNodeBackend());
  for (const [s, file] of [[cust, 'customers.csv'], [semi, 'semicolon.csv']] as const) await engine.registerBuffer(sourceFileName(s), fixture(file));
});
afterAll(() => engine.close());
beforeEach(() => invalidateCaches());

const cust: Source = src({ id: 'cust', format: 'csv' });
const semi: Source = src({ id: 'semi', format: 'csv' });

const chain = (steps = [] as ReturnType<typeof step>[], source = cust): Project =>
  flow({
    sources: [source],
    nodes: [
      { id: 'in', type: 'source', sourceId: source.id },
      { id: 't', type: 'transform', steps },
      { id: 'out', type: 'output' },
      { id: 'loose', type: 'output' },
    ],
    wires: [['in', 't'], ['t', 'out']],
  });

const states = () => Object.fromEntries(Object.entries(useFlowStore.getState().nodes).map(([id, e]) => [id, e.status.state]));

describe('flow status', () => {
  it('marks every wired node ok with its columns, and an unwired node as unwired', async () => {
    await evaluateFlow(engine, chain());
    expect(states()).toEqual({ in: 'ok', t: 'ok', out: 'ok', loose: 'unwired' });
    const out = useFlowStore.getState().nodes.out!.status;
    expect(out.state === 'ok' && out.columns.map((c) => c.name)).toEqual(['id', 'name', 'email', 'joined']);
  });

  it('breaks the node with a bad step and dims everything after it', async () => {
    await evaluateFlow(engine, chain([step('r', 'removeColumns', { columns: ['phone'] })]));
    expect(states()).toMatchObject({ in: 'ok', t: 'error', out: 'blocked' });
    const t = useFlowStore.getState().nodes.t!.status;
    expect(t.state === 'error' && t.message).toMatch(/phone/);
  });

  it('keeps the status of nodes whose upstream did not change', async () => {
    const p = chain();
    await evaluateFlow(engine, p);
    const before = useFlowStore.getState().nodes.in;
    await evaluateFlow(engine, { ...p, name: 'Renamed', nodes: p.nodes.map((n) => (n.id === 'out' ? { ...n, position: { x: 9, y: 9 } } : n)) });
    expect(useFlowStore.getState().nodes.in).toBe(before);
  });

  it('counts rows in the background and records them on the node', async () => {
    const p = chain();
    await evaluateFlow(engine, p);
    expect(await countRows(engine, p, 'out')).toBe(4);
    await vi.waitFor(() => {
      const s = useFlowStore.getState().nodes.out!.status;
      expect(s.state === 'ok' && s.rows).toBe(4);
    });
  });
});

describe('results pages and profiles', () => {
  it('returns every value as DuckDB prints it, with nulls kept', async () => {
    const p = chain();
    const rows = tableRows((await engine.query(compileDisplayPage(p, { nodeId: 'out' }, ['id', 'email', 'joined'], 0, 2))).table);
    expect(rows).toEqual([
      { id: '1', email: 'ADA@example.com', joined: '2024-01-31' },
      { id: '2', email: 'grace@example.com ', joined: '2024-02-29' },
    ]);
    const page2 = tableRows((await engine.query(compileDisplayPage(p, { nodeId: 'out' }, ['email'], 1, 2))).table);
    expect(page2).toEqual([{ email: null }, { email: 'null@example.com' }]);
  });

  it('profiles the share of empty values per column', async () => {
    const r = tableRows((await engine.query(compileProfile(chain(), { nodeId: 'out' }))).table);
    const pct = Object.fromEntries(r.map((row) => [row.column_name, row.null_pct]));
    expect(pct).toMatchObject({ id: 0, email: 25 });
  });

  it('reads with the chosen delimiter and treat-as-empty values', async () => {
    const page = async (s: Source) => tableRows((await engine.query(compileDisplayPage(chain([], s), { nodeId: 'out' }, [], 0))).table);
    expect(Object.keys((await page(semi))[0]!)).toEqual(['id', 'city']);
    expect(Object.keys((await page({ ...semi, parseOptions: { delimiter: ',' } }))[0]!)).toEqual(['id;city']);
    const nulls = await page({ ...semi, parseOptions: { delimiter: ';', nullStrings: ['N/A'] } });
    expect(nulls.map((r) => r.city)).toEqual(['Leeds', null, 'York']);
  });
});

describe('detached sources', () => {
  it('marks a source whose file needs choosing again, and dims what reads from it', async () => {
    await evaluateFlow(engine, chain(), (id) => id === 'cust');
    expect(states()).toMatchObject({ in: 'detached', t: 'blocked', out: 'blocked', loose: 'unwired' });
  });

  it('re-checks every node once the file is attached again', async () => {
    const p = chain();
    await evaluateFlow(engine, p, () => true);
    await evaluateFlow(engine, p, () => false);
    expect(states()).toMatchObject({ in: 'ok', t: 'ok', out: 'ok' });
  });
});

describe('grouping', () => {
  const two = (): Project =>
    flow({
      sources: [cust],
      nodes: [
        { id: 'in', type: 'source', sourceId: cust.id },
        { id: 'a', type: 'transform', steps: [step('trim', 'trimWhitespace', { columns: ['name', 'email'] })] },
        { id: 'b', type: 'transform', steps: [step('case', 'changeCase', { columns: ['name'], mode: 'title' }), step('drop', 'removeColumns', { columns: ['joined'] })] },
        { id: 'out', type: 'output' },
      ],
      wires: [['in', 'a'], ['a', 'b'], ['b', 'out']],
    });
  const rows = async (p: Project) => tableRows((await engine.query(compileDisplayPage(p, { nodeId: 'out' }, ['id', 'name', 'email'], 0))).table);

  it('grouping, ungrouping and splitting a chain never change what reaches the output', async () => {
    const p = two();
    const expected = await rows(p);
    expect(expected.slice(0, 2)).toEqual([
      { id: '1', name: 'Ada Lovelace', email: 'ADA@example.com' },
      { id: '2', name: 'Grace Hopper', email: 'grace@example.com' },
    ]);
    const grouped = groupNodes(p, ['a', 'b']);
    expect(grouped.nodes.map((n) => n.id)).toEqual(['in', 'a', 'out']);
    expect(await rows(grouped)).toEqual(expected);
    expect(await rows(ungroupNode(grouped, 'a'))).toEqual(expected);
    expect(await rows(splitNode(grouped, 'a', 2, 'c'))).toEqual(expected);
  });
});
