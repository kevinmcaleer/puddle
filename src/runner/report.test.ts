import { describe, expect, it } from 'vitest';
import { flow } from '../../tests/helpers/projects';
import { reportFiles, runReport } from './report';

describe('the runner’s quality report', () => {
  const p = flow({ nodes: [{ id: 'a', type: 'transform' }, { id: 'b', type: 'transform' }, { id: 'c', type: 'transform' }], wires: [] });
  p.name = 'Shop';
  p.nodes[0]!.rules = [
    { id: 'r1', type: 'notEmpty', label: 'email is filled in', params: { column: 'email' }, severity: 'fail', enabled: true },
    { id: 'r2', type: 'unique', label: 'id | unique', params: { columns: ['id'] }, severity: 'warn', enabled: true },
  ];
  p.nodes[1]!.analysis = { at: '2026-10-21T09:00:00.000Z', rows: 5, issues: [{ key: 'duplicateRows', kind: 'duplicateRows', label: 'Duplicate rows', count: 1, fixed: true }] };
  const sources = [{ id: 's', name: 'shop.csv', kind: 'file' as const, format: 'csv' as const, rows: 10, headHash: 'abc' }];

  it('is the browser’s report over every node with rules or a kept analysis, from the run’s rule results', () => {
    const r = runReport(p, { a: { r1: { state: 'ok', failures: 3, total: 10 }, r2: { state: 'error', message: 'no such column' } } }, sources, '2026-10-21T10:00:00.000Z');
    expect(r.schema).toBe('puddle-quality-report/1');
    expect(r.scope).toBe('all');
    expect(r.nodes.map((n) => n.name)).toEqual(['a', 'b']);
    expect(r.nodes[0]!.rules.map((x) => [x.label, x.status, x.failed])).toEqual([
      ['email is filled in', 'fail', 3],
      ['id | unique', 'error', null],
    ]);
    expect(r.nodes[1]!.analysis).toMatchObject({ found: 1, fixed: 1 });
    expect(r.sources).toEqual(sources);
    expect(r.summary).toMatchObject({ rules: 2, fail: 1, error: 1 });
  });

  it('is written as Markdown, JSON and HTML, named after the project', () => {
    const files = reportFiles(runReport(p, {}, sources, '2026-10-21T10:00:00.000Z'), 'shop');
    expect(Object.keys(files)).toEqual(['shop.quality.md', 'shop.quality.json', 'shop.quality.html']);
    expect(files['shop.quality.md']).toContain('# Quality report: Shop');
    expect(files['shop.quality.md']).toContain('| Fixed | Duplicate rows |  | 1 |');
    expect(JSON.parse(files['shop.quality.json']!).nodes[1].analysis.issues[0].outcome).toBe('fixed');
    expect(files['shop.quality.html']!.startsWith('<!doctype html>')).toBe(true);
    expect(files['shop.quality.html']).toContain('data-outcome="fixed"');
  });
});
