// Quality reports on real DuckDB-WASM (Node build): counts from the rules check, source rows and hashes, failing-row samples.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { sourceFileName } from '../../src/compiler';
import { EngineClient } from '../../src/engine/client';
import { evaluateRules, useRuleStore } from '../../src/flow/rules';
import { evaluateFlow, invalidateCaches } from '../../src/flow/status';
import type { Project, Rule } from '../../src/model';
import { buildReport, reportMarkdown, reportNodeIds, writeReport } from '../../src/report';
import { collectSamples, collectSources } from '../../src/report/collect';
import { headHash } from '../../src/sources/hash';
import { createNodeBackend } from '../helpers/nodeBackend';
import { flow, src } from '../helpers/projects';

const bytes = new Uint8Array(readFileSync(join(__dirname, '../fixtures', 'customers.csv')));
const cust = src({ id: 'cust', name: 'customers.csv', format: 'csv', file: { originalName: 'customers.csv', size: bytes.length, lastModified: 0, headHash: 'filled in below' } });
const pasted = src({ id: 'pasted', name: 'Pasted', kind: 'clipboard', format: 'csv', clipboard: { text: 'code\nA\nB\n' } });

let engine: EngineClient;
beforeAll(async () => {
  engine = new EngineClient(await createNodeBackend());
  await engine.registerBuffer(sourceFileName(cust), bytes);
  await engine.registerBuffer(sourceFileName(pasted), new TextEncoder().encode(pasted.clipboard!.text));
  cust.file!.headHash = await headHash(new Blob([bytes]));
});
afterAll(() => engine.close());
beforeEach(() => invalidateCaches());

const rule = (id: string, type: string, params: Record<string, unknown>, severity: 'warn' | 'fail' = 'fail'): Rule => ({ id, type, label: id, enabled: true, severity, params });

function project(): Project {
  const p = flow({
    sources: [cust, pasted],
    nodes: [
      { id: 'in', type: 'source', sourceId: 'cust' },
      { id: 'out', type: 'output' },
      { id: 'codes', type: 'source', sourceId: 'pasted' },
    ],
    wires: [['in', 'out']],
  });
  const rules: Record<string, Rule[]> = {
    in: [rule('spaces', 'noEdgeSpaces', { column: 'name' }), rule('email', 'notEmpty', { column: 'email' }, 'warn'), rule('ids', 'unique', { columns: ['id'] }), rule('rows', 'rowCount', { mode: 'atLeast', n: 10 })],
    codes: [rule('code', 'notEmpty', { column: 'code' })],
  };
  return { ...p, name: 'Customers', nodes: p.nodes.map((n) => ({ ...n, rules: rules[n.id] ?? [] })) };
}

async function checked(p: Project) {
  await evaluateFlow(engine, p);
  await evaluateRules(engine, p);
  return useRuleStore.getState().nodes;
}

it('reports the rules check’s own counts, with every source’s rows and head hash', async () => {
  const p = project();
  const results = await checked(p);
  const nodeIds = reportNodeIds(p, 'out', 'node');
  const sources = await collectSources(engine, p, nodeIds);
  expect(sources).toEqual([{ id: 'cust', name: 'customers.csv', kind: 'file', format: 'csv', rows: 4, headHash: cust.file!.headHash }]);
  const all = await collectSources(engine, p, reportNodeIds(p, 'out', 'all'));
  expect(all[1]).toEqual({ id: 'pasted', name: 'Pasted', kind: 'clipboard', format: 'csv', rows: 2, headHash: await headHash(new Blob([pasted.clipboard!.text])) });

  const report = buildReport({ project: p, nodeIds, scope: 'node', results, sample: null, sources, sampleLimit: 0, generatedAt: '2026-10-16T00:00:00.000Z' });
  const rules = report.nodes.find((n) => n.id === 'in')!.rules;
  // The same numbers the rules panel shows.
  for (const r of rules) {
    const res = results.in!.results[r.id]!;
    expect(res.state).toBe('ok');
    if (res.state === 'ok') expect(r.total).toBe(res.total);
  }
  expect(rules.map((r) => [r.id, r.status, r.failed, r.passed])).toEqual([
    ['spaces', 'fail', 2, 2],
    ['email', 'warn', 1, 3],
    ['ids', 'pass', 0, 4],
    ['rows', 'fail', null, null],
  ]);
});

it('samples failing rows from the failing-rows view, up to the limit, as text', async () => {
  const p = project();
  const results = await checked(p);
  const samples = await collectSamples(engine, p, 'in', results.in!.results, 1);
  // Only failing row rules: unique passes, and a row count has no rows to show.
  expect(Object.keys(samples).sort()).toEqual(['email', 'spaces']);
  expect(samples.spaces).toEqual({ columns: ['id', 'name', 'email', 'joined'], rows: [['1', '  Ada Lovelace ', 'ADA@example.com', '2024-01-31']] });
  const more = await collectSamples(engine, p, 'in', results.in!.results, 10);
  expect(more.spaces!.rows.map((r) => r[0])).toEqual(['1', '4']);
  expect(more.email!.rows).toEqual([['3', 'Edsger W. Dijkstra', null, '2024-03-01']]);

  const report = buildReport({ project: p, nodeIds: ['in'], scope: 'node', results, sample: null, sources: [], samples: { in: more }, sampleLimit: 10, generatedAt: '2026-10-16T00:00:00.000Z' });
  expect(reportMarkdown(report)).toContain('Ada Lovelace');
  const none = buildReport({ project: p, nodeIds: ['in'], scope: 'node', results, sample: null, sources: [], samples: { in: more }, sampleLimit: 0, generatedAt: '2026-10-16T00:00:00.000Z' });
  for (const format of ['markdown', 'json'] as const) {
    const text = await writeReport(none, format);
    for (const v of ['Ada Lovelace', 'Dijkstra', 'example.com', '2024-']) expect(text).not.toContain(v);
  }
});
