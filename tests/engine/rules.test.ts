// Quality rules on real DuckDB-WASM (Node build): known failure counts on fixtures, and failing-row views.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { compile, compileCount, compileRules, sourceFileName } from '../../src/compiler';
import { EngineClient, tableRows } from '../../src/engine/client';
import { evaluateRules, useRuleStore } from '../../src/flow/rules';
import { evaluateFlow, invalidateCaches } from '../../src/flow/status';
import type { Project, Rule, Source } from '../../src/model';
import { createNodeBackend } from '../helpers/nodeBackend';
import { flow, src } from '../helpers/projects';

const cust = src({ id: 'cust', format: 'csv' });
const messy = src({ id: 'messy', format: 'csv' });

let engine: EngineClient;
beforeAll(async () => {
  engine = new EngineClient(await createNodeBackend());
  for (const [s, file] of [[cust, 'customers.csv'], [messy, 'messy.csv']] as const)
    await engine.registerBuffer(sourceFileName(s), new Uint8Array(readFileSync(join(__dirname, '../fixtures', file))));
});
afterAll(() => engine.close());
beforeEach(() => invalidateCaches());

const rule = (id: string, type: string, params: Record<string, unknown>, severity: 'warn' | 'fail' = 'fail'): Rule => ({ id, type, label: id, enabled: true, severity, params });
const withRules = (source: Source, rules: Rule[]): Project => {
  const p = flow({ sources: [source], nodes: [{ id: 'in', type: 'source', sourceId: source.id }, { id: 'out', type: 'output' }], wires: [['in', 'out']] });
  return { ...p, nodes: p.nodes.map((n) => (n.id === 'out' ? { ...n, rules } : n)) };
};

async function failures(source: Source, type: string, params: Record<string, unknown>) {
  const r = tableRows((await engine.query(compileRules(withRules(source, [rule('r', type, params)]), 'out', [rule('r', type, params)]))).table)[0]!;
  return { failures: Number(r.f0), total: Number(r.total) };
}

describe('rule types', () => {
  it.each([
    ['notEmpty', cust, { column: 'email' }, 1],
    ['notEmpty', cust, { column: 'name' }, 1],
    ['unique', cust, { columns: ['id'] }, 0],
    ['unique', messy, { columns: ['id'] }, 2],
    ['unique', messy, { columns: ['id', 'price'] }, 2],
    ['matchesPattern', cust, { column: 'email', preset: 'email' }, 1],
    ['matchesPattern', cust, { column: 'id', preset: 'digits' }, 0],
    ['matchesPattern', cust, { column: 'joined', preset: 'custom', pattern: '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' }, 1],
    ['noEdgeSpaces', cust, { column: 'name' }, 2],
    ['inSet', messy, { column: 'city', values: ['London', 'Paris'], matchCase: false }, 1],
    ['inSet', messy, { column: 'city', values: ['London', 'Paris'], matchCase: true }, 2],
    ['inRange', cust, { column: 'id', min: '2', max: '3' }, 2],
    ['inRange', cust, { column: 'id', min: '', max: '1' }, 3],
    ['readsAs', cust, { column: 'joined', as: 'date' }, 1],
    ['readsAs', cust, { column: 'id', as: 'number' }, 0],
    ['readsAs', cust, { column: 'email', as: 'date' }, 3],
    ['readsAs', messy, { column: 'price', as: 'number' }, 5],
  ] as const)('%s %j fails %#', async (type, source, params, expected) => {
    expect(await failures(source, type, params)).toEqual({ failures: expected, total: source === cust ? 4 : 5 });
  });

  it('a date range reads its bounds as dates', async () => {
    const p = flow({ sources: [cust], nodes: [{ id: 'in', type: 'source', sourceId: cust.id }, { id: 't', type: 'transform', steps: [{ id: 's', type: 'changeType', label: 's', enabled: true, params: { columns: ['joined'], to: 'date', onError: 'empty' } }] }], wires: [['in', 't']] });
    const r = rule('r', 'inRange', { column: 'joined', min: '2024-02-01', max: '' });
    const withRule = { ...p, nodes: p.nodes.map((n) => (n.id === 't' ? { ...n, rules: [r] } : n)) };
    const row = tableRows((await engine.query(compileRules(withRule, 't', [r]))).table)[0]!;
    expect(Number(row.f0)).toBe(1);
  });
});

describe('failing rows and evaluation', () => {
  it('views only the rows that fail a rule', async () => {
    const p = withRules(cust, [rule('spaces', 'noEdgeSpaces', { column: 'name' })]);
    const target = { nodeId: 'out', failingRuleId: 'spaces' };
    expect(Number(tableRows((await engine.query(compileCount(p, target))).table)[0]!.n)).toBe(2);
    const rows = tableRows((await engine.query(compile(p, target).sql)).table);
    expect(rows.map((r) => Number(r.id))).toEqual([1, 4]);
    expect(Object.keys(rows[0]!)).toEqual(['id', 'name', 'email', 'joined']);
  });

  it('checks every rule in one pass, and names a broken rule without losing the others', async () => {
    const p = withRules(cust, [rule('a', 'notEmpty', { column: 'email' }), rule('b', 'notEmpty', { column: 'phone' }), rule('c', 'unique', { columns: ['id'] }, 'warn')]);
    await evaluateFlow(engine, p);
    await evaluateRules(engine, p);
    const results = useRuleStore.getState().nodes.out!.results;
    expect(results.a).toEqual({ state: 'ok', failures: 1, total: 4 });
    expect(results.b).toMatchObject({ state: 'error', message: expect.stringMatching(/phone/) });
    expect(results.c).toEqual({ state: 'ok', failures: 0, total: 4 });
  });
});
