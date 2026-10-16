import { flow, src, step } from '../../tests/helpers/projects';
import type { Project, Rule } from '../model';
import { compile, compileRules, refKeys, ruleContext, upstreamKey } from './compile';
import { CompileError } from './errors';
import { describeRule, rulePredicate, ruleRefs, ruleScope } from './rules';

const rule = (id: string, type: string, params: Record<string, unknown>): Rule => ({ id, type, label: `${type} ${id}`, enabled: true, severity: 'fail', params });

/** Orders checked against Customers: a source of orders with a transform, and customers in their own branch. */
const shop = (rules: Rule[] = [], customerSteps = [] as ReturnType<typeof step>[]): Project => {
  const p = flow({
    sources: [src({ id: 'orders', format: 'csv' }), src({ id: 'customers', format: 'csv' })],
    nodes: [
      { id: 'o', type: 'source', sourceId: 'orders' },
      { id: 'ord', type: 'transform' },
      { id: 'c', type: 'source', sourceId: 'customers' },
      { id: 'cust', type: 'transform', steps: customerSteps },
      { id: 'loose', type: 'transform' },
    ],
    wires: [['o', 'ord'], ['c', 'cust']],
  });
  return { ...p, nodes: p.nodes.map((n) => (n.id === 'ord' ? { ...n, rules } : n.id === 'cust' ? { ...n, name: 'Customers' } : n)) };
};
const names = (id: string) => ({ cust: 'Customers' })[id];

describe('rule predicates', () => {
  it.each([
    ['length', { column: 'name', op: 'exactly', n: 3 }],
    ['length', { column: 'name', op: 'atLeast', n: 1 }],
    ['length', { column: 'name', op: 'atMost', n: 50 }],
    ['readsAs', { column: 'v', as: 'integer' }],
    ['readsAs', { column: 'v', as: 'decimal' }],
    ['readsAs', { column: 'v', as: 'boolean' }],
    ['expression', { expression: "total >= 0 AND status <> 'void'" }],
    ['rowCount', { mode: 'atLeast', n: 5 }],
  ])('%s %j', (type, params) => {
    expect(rulePredicate({ type, params, label: type })).toMatchSnapshot();
  });

  it('reads another node through the context, as a subquery of its rows', () => {
    const ctx = { relation: (id: string) => `(SELECT * FROM "${id}")` };
    expect(rulePredicate({ type: 'referential', params: { column: 'customer_id', node: 'cust', nodeColumn: 'customer_id' }, label: 'r' }, ctx)).toBe(
      '"customer_id" IS NULL OR "customer_id" IN (SELECT "customer_id" FROM (SELECT * FROM "cust") WHERE "customer_id" IS NOT NULL)',
    );
    expect(rulePredicate({ type: 'inSet', params: { column: 'status', from: 'node', node: 'cust', nodeColumn: 'status', matchCase: false }, label: 'r' }, ctx)).toBe(
      '"status" IS NULL OR lower(CAST("status" AS VARCHAR)) IN (SELECT lower(CAST("status" AS VARCHAR)) FROM (SELECT * FROM "cust") WHERE "status" IS NOT NULL)',
    );
    expect(rulePredicate({ type: 'rowCount', params: { mode: 'sameAs', node: 'cust' }, label: 'r' }, ctx)).toBe('count(*) = (SELECT count(*) FROM (SELECT * FROM "cust"))');
    // Without a project there's nothing to read.
    expect(() => rulePredicate({ type: 'referential', params: { column: 'a', node: 'cust', nodeColumn: 'b' }, label: 'r' })).toThrow(/reads another node/);
  });

  it('keeps the typed list of in set as it was', () => {
    expect(rulePredicate({ type: 'inSet', params: { column: 'name', values: ['Ann'], matchCase: true }, label: 'r' })).toBe(`"name" IS NULL OR CAST("name" AS VARCHAR) IN ('Ann')`);
  });

  it('says what each rule expects, naming the node it reads', () => {
    expect(describeRule({ type: 'referential', params: { column: 'customer_id', node: 'cust', nodeColumn: 'id' } }, names)).toBe('Every customer_id exists in Customers.id');
    expect(describeRule({ type: 'referential', params: { column: 'customer_id', node: 'gone', nodeColumn: 'id' } }, names)).toBe('Every customer_id exists in a node that no longer exists.id');
    expect(describeRule({ type: 'inSet', params: { column: 'status', from: 'node', node: 'cust', nodeColumn: 'status' } }, names)).toBe('status is one of the values of Customers.status');
    expect(describeRule({ type: 'length', params: { column: 'code', op: 'exactly', n: 1 } })).toBe('code is exactly 1 character');
    expect(describeRule({ type: 'readsAs', params: { column: 'v', as: 'boolean' } })).toBe('v reads as true or false');
    expect(describeRule({ type: 'rowCount', params: { mode: 'atLeast', n: 1 } })).toBe('At least 1 row');
    expect(describeRule({ type: 'rowCount', params: { mode: 'sameAs', node: 'cust' } }, names)).toBe('Same number of rows as Customers');
    expect(describeRule({ type: 'expression', params: { expression: 'a > 0' } })).toBe('Every row: a > 0');
    expect(describeRule({ type: 'referential', params: { column: 'a', node: '', nodeColumn: '' } })).toBeUndefined();
  });

  it('knows which rules read other nodes and which are about the whole table', () => {
    expect(ruleRefs({ type: 'referential', params: { column: 'a', node: 'cust', nodeColumn: 'b' } })).toEqual(['cust']);
    expect(ruleRefs({ type: 'inSet', params: { column: 'a', values: ['x'] } })).toEqual([]);
    expect(ruleRefs({ type: 'inSet', params: { column: 'a', from: 'node', node: 'cust', nodeColumn: 'b' } })).toEqual(['cust']);
    expect(ruleRefs({ type: 'rowCount', params: { mode: 'sameAs', node: 'cust' } })).toEqual(['cust']);
    expect(ruleRefs({ type: 'rowCount', params: { mode: 'atLeast', n: 3 } })).toEqual([]);
    expect(ruleScope({ type: 'rowCount' })).toBe('table');
    expect(ruleScope({ type: 'referential' })).toBe('row');
  });

  it('refuses unsafe or incomplete settings before anything runs', () => {
    const invalid = (type: string, params: Record<string, unknown>) => () => rulePredicate({ type, params, label: 'R' });
    expect(invalid('expression', { expression: 'a > 0; DROP TABLE x' })).toThrow(/without ;/);
    expect(invalid('expression', { expression: "a = 'x" })).toThrow(/close the quote/);
    expect(invalid('expression', { expression: 'a > 0 -- note' })).toThrow(/comments/);
    expect(invalid('expression', { expression: '  ' })).toThrow(/write an expression/);
    expect(invalid('length', { column: 'a', op: 'atMost', n: -1 })).toThrow(/0 or more/);
    expect(invalid('length', { column: 'a', op: 'atMost', n: 1.5 })).toThrow(/whole number/);
    expect(invalid('inSet', { column: 'a', from: 'node', node: '', nodeColumn: '' })).toThrow(/pick a node/);
    expect(invalid('inSet', { column: 'a', from: 'list', values: [] })).toThrow(/list the allowed values/);
    expect(invalid('rowCount', { mode: 'atLeast' })).toThrow(/number of rows/);
    expect(invalid('rowCount', { mode: 'sameAs', node: '' })).toThrow(/pick a node/);
    expect(invalid('readsAs', { column: 'a', as: 'colour' })).toThrow(/invalid settings/);
  });
});

describe('rules that read other nodes, compiled', () => {
  const referential = rule('ref', 'referential', { column: 'customer_id', node: 'cust', nodeColumn: 'customer_id' });

  it('batches row rules and table rules into one pass, and reads the other node as a subquery', () => {
    const p = shop([rule('n', 'notEmpty', { column: 'customer_id' }), rule('rc', 'rowCount', { mode: 'atLeast', n: 2 }), referential]);
    const sql = compileRules(p, 'ord', p.nodes.find((n) => n.id === 'ord')!.rules);
    expect(sql).toContain('CASE WHEN coalesce((count(*) >= 2), false) THEN 0 ELSE 1 END AS "f1"');
    expect(sql).toContain(`read_csv('src_customers.csv'`);
    expect(sql).toMatchSnapshot();
  });

  it('compiles a table rule alone without per-row flags', () => {
    const p = shop([rule('rc', 'rowCount', { mode: 'sameAs', node: 'cust' })]);
    expect(compileRules(p, 'ord', p.nodes[1]!.rules)).toMatch(/^SELECT count\(\*\) AS total, CASE WHEN .* FROM \(SELECT 1 AS "__puddle_row" FROM/s);
  });

  it('fails to compile, with the reason, when the other node is gone or can’t run', () => {
    const gone = shop([rule('g', 'referential', { column: 'customer_id', node: 'nope', nodeColumn: 'id' })]);
    expect(() => compileRules(gone, 'ord', gone.nodes[1]!.rules)).toThrow(new CompileError('The node this rule reads is no longer in the project.'));
    const unwired = shop([rule('u', 'referential', { column: 'customer_id', node: 'loose', nodeColumn: 'id' })]);
    expect(() => compileRules(unwired, 'ord', unwired.nodes[1]!.rules)).toThrow(/loose can’t run, so this rule can’t be checked. loose has no input/);
  });

  it('shows failing rows for a referential rule, and explains there are none for a row count', () => {
    const p = shop([referential, rule('rc', 'rowCount', { mode: 'atLeast', n: 2 })]);
    expect(compile(p, { nodeId: 'ord', failingRuleId: 'ref' }).sql).toContain('IN (SELECT "customer_id" FROM (WITH');
    expect(() => compile(p, { nodeId: 'ord', failingRuleId: 'rc' })).toThrow(/about the whole table, so there are no failing rows to show/);
  });

  it('re-keys a rule’s results and failing rows when the node it reads changes', () => {
    const before = shop([referential]);
    const after = shop([referential], [step('t', 'trimWhitespace', { columns: ['name'] })]);
    expect(upstreamKey(before, { nodeId: 'ord' })).toBe(upstreamKey(after, { nodeId: 'ord' }));
    expect(refKeys(before, referential)).not.toEqual(refKeys(after, referential));
    expect(upstreamKey(before, { nodeId: 'ord', failingRuleId: 'ref' })).not.toBe(upstreamKey(after, { nodeId: 'ord', failingRuleId: 'ref' }));
    expect(refKeys(before, rule('g', 'referential', { column: 'a', node: 'nope', nodeColumn: 'b' }))).toEqual([null]);
  });

  it('reads the other node on the full data, even in sample mode', () => {
    const p = shop([referential]);
    const sampled = { ...p, sources: p.sources.map((s) => ({ ...s, sampleRows: 10 })) };
    expect(compile(sampled, { nodeId: 'ord' }).sql).toContain('LIMIT 10');
    expect(ruleContext(sampled).relation('cust')).not.toContain('LIMIT 10');
  });
});
