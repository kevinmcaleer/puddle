// The remaining rule types on real DuckDB-WASM (Node build): known failure counts on fixtures, failing rows, and
// rules that read another node (referential, in set from a node, row count against a node), which re-run when that
// node changes and show an error, never a pass, when it can't run.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { compile, compileCount, compileRules, sourceFileName } from '../../src/compiler';
import { EngineClient, tableRows } from '../../src/engine/client';
import { exportGate } from '../../src/flow/gate';
import { checkRules, evaluateRules, useRuleStore } from '../../src/flow/rules';
import { evaluateFlow, invalidateCaches } from '../../src/flow/status';
import { removeNodes, type Project, type Rule } from '../../src/model';
import { createNodeBackend } from '../helpers/nodeBackend';
import { flow, src, step } from '../helpers/projects';

const orders = src({ id: 'orders', format: 'csv' });
const customers = src({ id: 'customers', format: 'csv' });
const types = src({ id: 'types', format: 'csv' });

const log: string[] = [];
let engine: EngineClient;
beforeAll(async () => {
  engine = new EngineClient(await createNodeBackend({ beforeQuery: async (sql) => void log.push(sql) }));
  for (const [s, file] of [[orders, 'shop-orders.csv'], [customers, 'shop-customers.csv'], [types, 'types.csv']] as const)
    await engine.registerBuffer(sourceFileName(s), new Uint8Array(readFileSync(join(__dirname, '../fixtures', file))));
});
afterAll(() => engine.close());
beforeEach(() => {
  invalidateCaches();
  useRuleStore.setState({ nodes: {} });
  log.length = 0;
});

const rule = (id: string, type: string, params: Record<string, unknown>, severity: 'warn' | 'fail' = 'fail'): Rule => ({ id, type, label: id, enabled: true, severity, params });

/**
 * Orders (5 rows; customer 4 doesn't exist) checked against Customers (5 rows, customer 5 twice), with the
 * rules on the Orders transform `ord`, then an Output. `customerSteps` change the Customers branch.
 */
function shop(rules: Rule[], customerSteps = [] as ReturnType<typeof step>[]): Project {
  const p = flow({
    sources: [orders, customers, types],
    nodes: [
      { id: 'o', type: 'source', sourceId: 'orders' },
      { id: 'ord', type: 'transform' },
      { id: 'c', type: 'source', sourceId: 'customers' },
      { id: 'cust', type: 'transform', steps: customerSteps },
      { id: 'loose', type: 'transform' },
      { id: 'ty', type: 'source', sourceId: 'types' },
      { id: 'out', type: 'output' },
    ],
    wires: [['o', 'ord'], ['c', 'cust'], ['ord', 'out']],
  });
  return { ...p, nodes: p.nodes.map((n) => (n.id === 'ord' ? { ...n, rules } : n.id === 'cust' ? { ...n, name: 'Customers' } : n)) };
}

async function failures(nodeId: string, type: string, params: Record<string, unknown>) {
  const r = rule('r', type, params);
  const p = shop([]);
  const withRule = { ...p, nodes: p.nodes.map((n) => (n.id === nodeId ? { ...n, rules: [r] } : n)) };
  const row = tableRows((await engine.query(compileRules(withRule, nodeId, [r]))).table)[0]!;
  return { failures: Number(row.f0), total: Number(row.total) };
}

describe('remaining rule types: known failure counts', () => {
  it.each([
    ['ord', 'length', { column: 'status', op: 'exactly', n: 7 }, 0, 5],
    ['ord', 'length', { column: 'status', op: 'exactly', n: 6 }, 5, 5],
    ['cust', 'length', { column: 'name', op: 'atMost', n: 6 }, 2, 5],
    ['cust', 'length', { column: 'name', op: 'atLeast', n: 5 }, 1, 5],
    ['ty', 'readsAs', { column: 'value', as: 'number' }, 1, 7],
    ['ty', 'readsAs', { column: 'value', as: 'integer' }, 3, 7],
    ['ty', 'readsAs', { column: 'value', as: 'decimal' }, 2, 7],
    ['ty', 'readsAs', { column: 'flag', as: 'boolean' }, 1, 7],
    ['ord', 'expression', { expression: "total >= 5 AND status <> 'pending'" }, 3, 5],
    ['ord', 'referential', { column: 'customer_id', node: 'cust', nodeColumn: 'customer_id' }, 1, 5],
    ['ord', 'inSet', { column: 'customer_id', from: 'node', node: 'cust', nodeColumn: 'customer_id' }, 1, 5],
    ['cust', 'inSet', { column: 'status', from: 'node', node: 'ord', nodeColumn: 'status' }, 5, 5],
    ['ord', 'rowCount', { mode: 'atLeast', n: 6 }, 1, 5],
    ['ord', 'rowCount', { mode: 'atLeast', n: 5 }, 0, 5],
    ['ord', 'rowCount', { mode: 'sameAs', node: 'cust' }, 0, 5],
    ['ord', 'rowCount', { mode: 'sameAs', node: 'ty' }, 1, 5],
  ] as const)('%s %s %j fails %d', async (nodeId, type, params, expected, total) => {
    expect(await failures(nodeId, type, params)).toEqual({ failures: expected, total });
  });

  it('shows the failing rows of row rules, including those that read another node', async () => {
    const p = shop([
      rule('ref', 'referential', { column: 'customer_id', node: 'cust', nodeColumn: 'customer_id' }),
      rule('expr', 'expression', { expression: "total >= 5 AND status <> 'pending'" }),
      rule('len', 'length', { column: 'status', op: 'atMost', n: 6 }),
    ]);
    const ids = async (ruleId: string) => tableRows((await engine.query(compile(p, { nodeId: 'ord', failingRuleId: ruleId }).sql)).table).map((r) => Number(r.order_id));
    expect(await ids('ref')).toEqual([103]);
    expect(await ids('expr')).toEqual([101, 102, 104]);
    expect(await ids('len')).toEqual([100, 101, 102, 103, 104]);
    expect(Number(tableRows((await engine.query(compileCount(p, { nodeId: 'ord', failingRuleId: 'ref' }))).table)[0]!.n)).toBe(1);
  });

  it('explains that a row count has no failing rows to show', () => {
    const p = shop([rule('rc', 'rowCount', { mode: 'atLeast', n: 6 })]);
    expect(() => compile(p, { nodeId: 'ord', failingRuleId: 'rc' })).toThrow(/about the whole table, so there are no failing rows to show/);
  });
});

describe('rules that read another node, evaluated with the flow', () => {
  const referential = rule('ref', 'referential', { column: 'customer_id', node: 'cust', nodeColumn: 'customer_id' });
  const results = () => useRuleStore.getState().nodes.ord?.results;
  async function evaluate(p: Project) {
    await evaluateFlow(engine, p);
    await evaluateRules(engine, p);
  }

  it('batches the node’s own rules and runs each rule that reads another node as its own query', async () => {
    await evaluate(shop([rule('n', 'notEmpty', { column: 'status' }), rule('rc', 'rowCount', { mode: 'atLeast', n: 6 }), referential, rule('same', 'rowCount', { mode: 'sameAs', node: 'cust' })]));
    expect(results()).toEqual({
      n: { state: 'ok', failures: 0, total: 5 },
      rc: { state: 'ok', failures: 1, total: 5 },
      ref: { state: 'ok', failures: 1, total: 5 },
      same: { state: 'ok', failures: 0, total: 5 },
    });
    const ruleQueries = log.filter((q) => q.startsWith('SELECT count(*) AS total'));
    expect(ruleQueries).toHaveLength(3);
    expect(ruleQueries.filter((q) => q.includes('src_customers.csv'))).toHaveLength(2);
  });

  it('re-runs when the node it reads changes, though its own node didn’t', async () => {
    await evaluate(shop([referential]));
    expect(results()?.ref).toEqual({ state: 'ok', failures: 1, total: 5 });
    // Customers loses customer 1: orders 100 and 102 now point nowhere too.
    const without1 = shop([referential], [step('f', 'filterRows', { mode: 'remove', conditions: [{ column: 'customer_id', op: 'equals', value: '1' }] })]);
    log.length = 0;
    await evaluate(without1);
    expect(results()?.ref).toEqual({ state: 'ok', failures: 3, total: 5 });
    expect(log.some((q) => q.startsWith('SELECT count(*) AS total'))).toBe(true);
  });

  it('shows an error, not a pass, when the node it reads breaks, isn’t connected or is gone', async () => {
    await evaluate(shop([referential], [step('bad', 'removeColumns', { columns: ['phone'] })]));
    expect(results()?.ref).toEqual({ state: 'error', message: 'Customers has an error, so this rule can’t be checked.' });

    await evaluate(shop([rule('ref', 'referential', { column: 'customer_id', node: 'loose', nodeColumn: 'customer_id' })]));
    expect(results()?.ref).toEqual({ state: 'error', message: 'loose isn’t connected yet, so this rule can’t be checked.' });

    await evaluate(removeNodes(shop([referential]), ['cust']));
    expect(results()?.ref).toEqual({ state: 'error', message: 'The node this rule reads is no longer in the project.' });
  });

  it('an error in the other node blocks export like a failure; a warning doesn’t', async () => {
    const broken = shop([referential], [step('bad', 'removeColumns', { columns: ['phone'] })]);
    await evaluate(broken);
    const gate = exportGate(broken, 'out', useRuleStore.getState().nodes);
    expect(gate).toMatchObject({ state: 'blocked', blocking: [{ ruleId: 'ref', error: 'Customers has an error, so this rule can’t be checked.' }] });

    const warned = shop([{ ...referential, severity: 'warn' }]);
    await evaluate(warned);
    expect(results()?.ref).toEqual({ state: 'ok', failures: 1, total: 5 });
    expect(exportGate(warned, 'out', useRuleStore.getState().nodes)).toEqual({ state: 'clear' });
  });

  it('checks the other node on the full data in sample mode, as the export gate does', async () => {
    const p = shop([referential]);
    const sampled = { ...p, sources: p.sources.map((s) => ({ ...s, sampleRows: 2 })) };
    // The sample of Customers has only customers 1 and 2; read in full, only order 103's customer is missing.
    const r = await checkRules(engine, sampled, 'ord', [referential], { priority: 'background', label: 'Checking rules' });
    expect(r?.ref).toEqual({ state: 'ok', failures: 0, total: 2 });
    const full = await checkRules(engine, p, 'ord', [referential], { priority: 'background', label: 'Checking rules' });
    expect(full?.ref).toEqual({ state: 'ok', failures: 1, total: 5 });
  });
});
