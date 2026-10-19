import { flow, src } from '../../tests/helpers/projects';
import type { RuleResult } from '../flow/rules';
import type { Project, Rule } from '../model';
import { buildReport, lastOverride, redactValues, REPORT_SCHEMA, reportNodeIds, reportPending, reportSources, type ReportInput } from './build';

const rule = (id: string, over: Partial<Rule> = {}): Rule => ({ id, type: 'noEdgeSpaces', label: `No leading or trailing spaces in ${id}`, enabled: true, severity: 'fail', params: { column: id }, ...over });
const ok = (failures: number, total = 4): RuleResult => ({ state: 'ok', failures, total });

// cust → clean → out, and a second source feeding a side branch with its own rules.
function project(rules: Record<string, Rule[]>, extra: Partial<Project> = {}): Project {
  const p = flow({
    sources: [src({ id: 'cust', name: 'customers.csv', format: 'csv', file: { originalName: 'customers.csv', size: 9, lastModified: 0, headHash: 'abc123' } }), src({ id: 'other', format: 'csv' })],
    nodes: [
      { id: 'in', type: 'source', sourceId: 'cust' },
      { id: 'clean', type: 'transform' },
      { id: 'out', type: 'output' },
      { id: 'in2', type: 'source', sourceId: 'other' },
      { id: 'side', type: 'transform' },
    ],
    wires: [['in', 'clean'], ['clean', 'out'], ['in2', 'side']],
  });
  return { ...p, name: 'Shop', nodes: p.nodes.map((n) => ({ ...n, rules: rules[n.id] ?? [] })), ...extra };
}

const input = (p: Project, over: Partial<ReportInput> = {}): ReportInput => ({
  project: p,
  nodeIds: reportNodeIds(p, 'out', 'node'),
  scope: 'node',
  results: {},
  sample: null,
  sources: [],
  sampleLimit: 0,
  generatedAt: '2026-10-16T17:20:00.000Z',
  ...over,
});

describe('which nodes a report covers', () => {
  const p = project({ in: [rule('name')], clean: [rule('email')], side: [rule('city')] });

  it('from an Output node: it and the nodes before it that have rules, upstream first', () => {
    expect(reportNodeIds(p, 'out', 'node')).toEqual(['in', 'clean', 'out']);
  });

  it('from any other node: just that node', () => {
    expect(reportNodeIds(p, 'clean', 'node')).toEqual(['clean']);
  });

  it('every node with rules, wherever it is', () => {
    expect(reportNodeIds(p, 'clean', 'all').sort()).toEqual(['clean', 'in', 'side']);
  });

  it('lists the sources those nodes read, once each', () => {
    expect(reportSources(p, ['clean', 'out']).map((s) => [s.source.id, s.nodeId])).toEqual([['cust', 'in']]);
    expect(reportSources(p, ['in', 'side']).map((s) => s.source.id)).toEqual(['cust', 'other']);
  });
});

describe('buildReport', () => {
  it('lists every rule with the rules panel’s counts, kind, severity and columns', () => {
    const p = project({ in: [rule('name'), rule('id', { type: 'unique', label: 'id is unique', params: { columns: ['id'] }, severity: 'warn' })], clean: [rule('email', { severity: 'warn' })] });
    const r = buildReport(input(p, { results: { in: { results: { name: ok(2), id: ok(0) } }, clean: { results: { email: ok(1) } } } }));
    expect(r.schema).toBe(REPORT_SCHEMA);
    expect(r.project).toEqual({ id: 'p1', name: 'Shop' });
    expect(r.nodes.map((n) => n.name)).toEqual(['in', 'clean', 'out']);
    expect(r.nodes[0]!.rules[0]).toEqual({
      id: 'name',
      label: 'No leading or trailing spaces in name',
      kind: 'noEdgeSpaces',
      kindLabel: 'No leading or trailing spaces',
      severity: 'fail',
      enabled: true,
      scope: 'row',
      columns: ['name'],
      status: 'fail',
      total: 4,
      passed: 2,
      failed: 2,
      failedPercent: 50,
    });
    expect(r.nodes[0]!.rules[1]).toMatchObject({ kind: 'unique', kindLabel: 'Unique', severity: 'warn', status: 'pass', passed: 4, failed: 0, failedPercent: 0 });
    expect(r.nodes[1]!.rules[0]).toMatchObject({ status: 'warn', failed: 1, failedPercent: 25 });
    expect(r.summary).toEqual({ rules: 3, pass: 1, warn: 1, fail: 1, overridden: 0, error: 0, off: 0, pending: 0 });
  });

  it('rounds the failing share to two decimals', () => {
    const p = project({ in: [rule('name')] });
    const r = buildReport(input(p, { results: { in: { results: { name: ok(1, 3) } } } }));
    expect(r.nodes[0]!.rules[0]!.failedPercent).toBe(33.33);
  });

  it('names the schema table a derived rule comes from', () => {
    const p = project({ in: [rule('id', { id: 'schema-unique-id', type: 'unique', label: 'id is unique', params: { columns: ['id'] }, fromSchema: { schema: 'public', table: 'customers' } }), rule('name')] });
    const r = buildReport(input(p, { results: { in: { results: { 'schema-unique-id': ok(0), name: ok(0) } } } }));
    expect(r.nodes[0]!.rules.map((x) => x.label)).toEqual(['Schema customers: id is unique', 'No leading or trailing spaces in name']);
  });

  it('gives a table rule its row count but no pass or fail rows', () => {
    const p = project({ in: [{ id: 'n', type: 'rowCount', label: 'At least 10 rows', enabled: true, severity: 'fail', params: { mode: 'atLeast', n: 10 } }] });
    const r = buildReport(input(p, { results: { in: { results: { n: ok(1, 4) } } } }));
    expect(r.nodes[0]!.rules[0]).toMatchObject({ scope: 'table', status: 'fail', total: 4, passed: null, failed: null, failedPercent: null, columns: [] });
  });

  it('marks rules that are off, still checking, or can’t run', () => {
    const p = project({ in: [rule('a', { enabled: false }), rule('b'), rule('c')] });
    const r = buildReport(input(p, { results: { in: { results: { a: ok(3), c: { state: 'error', message: 'Binder Error: no column "c"' } } } } }));
    expect(r.nodes[0]!.rules.map((x) => x.status)).toEqual(['off', 'pending', 'error']);
    expect(r.nodes[0]!.rules[0]).toMatchObject({ total: null, failed: null });
    expect(r.nodes[0]!.rules[2]!.error).toBe('Binder Error: no column "c"');
  });

  it('reports the rules of a node that can’t run as not checked, rather than waiting for them', () => {
    const p = project({ clean: [rule('email')] });
    expect(reportPending(p, ['clean'], {})).toBe(true);
    expect(reportPending(p, ['clean'], {}, ['clean'])).toBe(false);
    const r = buildReport(input(p, { nodeIds: ['clean'], cantRun: ['clean'] }));
    expect(r.nodes[0]!.rules[0]).toMatchObject({ status: 'error', error: 'clean can’t run, so this rule wasn’t checked.' });
  });

  it('shows a failed fail rule that was exported past as overridden, with when and where, never as passing', () => {
    const log = [
      { id: 'x2', at: '2026-10-16T12:00:00.000Z', nodeId: 'out', nodeName: 'Output 1', format: 'csv' as const, fileName: 'Output 1.csv', rows: 4, overridden: [{ nodeName: 'in', rule: 'old label', nodeId: 'in', ruleId: 'name' }] },
      { id: 'x1', at: '2026-10-15T09:00:00.000Z', nodeId: 'out', nodeName: 'Output 1', format: 'csv' as const, fileName: 'old.csv', rows: 4, overridden: [{ nodeName: 'in', rule: 'old label', nodeId: 'in', ruleId: 'name' }] },
    ];
    const p = project({ in: [rule('name'), rule('email')] }, { exportLog: log });
    const r = buildReport(input(p, { results: { in: { results: { name: ok(2), email: ok(1) } } } }));
    expect(r.nodes[0]!.rules[0]).toMatchObject({ status: 'overridden', failed: 2, override: { at: '2026-10-16T12:00:00.000Z', outputName: 'Output 1', fileName: 'Output 1.csv' } });
    // Only the rule exported past is overridden.
    expect(r.nodes[0]!.rules[1]).toMatchObject({ status: 'fail' });
    expect(r.nodes[0]!.rules[1]!.override).toBeUndefined();
    expect(r.summary).toMatchObject({ overridden: 1, fail: 1, pass: 0 });
  });

  it('ignores an override once the rule passes, and one on a stopped export', () => {
    const entry = { id: 'x', at: '2026-10-16T12:00:00.000Z', nodeId: 'out', nodeName: 'Output 1', format: 'csv' as const, fileName: 'a.csv', rows: 0, overridden: [{ nodeName: 'in', rule: 'r', nodeId: 'in', ruleId: 'name' }] };
    const passing = buildReport(input(project({ in: [rule('name')] }, { exportLog: [entry] }), { results: { in: { results: { name: ok(0) } } } }));
    expect(passing.nodes[0]!.rules[0]).toMatchObject({ status: 'pass' });
    expect(passing.nodes[0]!.rules[0]!.override).toBeUndefined();
    const stopped = buildReport(input(project({ in: [rule('name')] }, { exportLog: [{ ...entry, cancelled: true }] }), { results: { in: { results: { name: ok(2) } } } }));
    expect(stopped.nodes[0]!.rules[0]!.status).toBe('fail');
  });

  it('matches overrides logged before rule ids were kept by node and rule name', () => {
    const r = rule('name');
    const p = project({ in: [r] }, { exportLog: [{ id: 'x', at: '2026-01-01T00:00:00.000Z', nodeId: 'out', nodeName: 'Output 1', format: 'csv', fileName: 'a.csv', rows: 1, overridden: [{ nodeName: 'in', rule: r.label }] }] });
    expect(lastOverride(p, p.nodes[0]!, r)?.fileName).toBe('a.csv');
    expect(lastOverride(p, p.nodes[0]!, { ...r, label: 'renamed' })).toBeUndefined();
  });

  it('keeps sample rows only when asked for, cut to the limit, and only for failing row rules', () => {
    const p = project({ in: [rule('name'), rule('id')] });
    const samples = { in: { name: { columns: ['id', 'name'], rows: [['1', '  Ada '], ['4', '  '], ['5', null]] }, id: { columns: ['id'], rows: [['9']] } } };
    const results = { in: { results: { name: ok(3), id: ok(0) } } };
    const none = buildReport(input(p, { results, samples, sampleLimit: 0 }));
    expect(none.sampleLimit).toBe(0);
    expect(none.nodes[0]!.rules.every((x) => x.sample === undefined)).toBe(true);
    const two = buildReport(input(p, { results, samples, sampleLimit: 2 }));
    expect(two.sampleLimit).toBe(2);
    expect(two.nodes[0]!.rules[0]!.sample).toEqual({ columns: ['id', 'name'], rows: [['1', '  Ada '], ['4', '  ']] });
    expect(two.nodes[0]!.rules[1]!.sample).toBeUndefined();
  });

  it('without samples, takes quoted values out of error messages', () => {
    const p = project({ in: [rule('name')] });
    const results = { in: { results: { name: { state: 'error' as const, message: 'Could not convert string \'Ada Lovelace\' to INT32' } } } };
    expect(buildReport(input(p, { results })).nodes[0]!.rules[0]!.error).toBe('Could not convert string ‘…’ to INT32');
    expect(buildReport(input(p, { results, sampleLimit: 5 })).nodes[0]!.rules[0]!.error).toBe('Could not convert string \'Ada Lovelace\' to INT32');
    expect(redactValues("a 'it''s' b")).toBe('a ‘…’ b');
  });

  it('says when rules were checked on a sample', () => {
    const p = project({ in: [rule('name')] });
    const r = buildReport(input(p, { results: { in: { results: { name: ok(1) } } }, sample: { rows: 100, sources: { cust: 5000 } } }));
    expect(r.sampleRows).toBe(100);
    // The Output node has no rules of its own, so nothing on it was checked on the sample.
    expect(r.nodes.map((n) => [n.id, n.onSample])).toEqual([['in', true], ['out', false]]);
    expect(buildReport(input(p, { results: { in: { results: { name: ok(1) } } } })).sampleRows).toBeNull();
  });
});
