// @vitest-environment jsdom
import { flow, src } from '../../tests/helpers/projects';
import type { Project, Rule } from '../model';
import { buildReport, reportNodeIds, type QualityReport } from './build';
import { reportHtml } from './html';
import { reportMarkdown } from './markdown';
import { writeReport } from './run';
import { reportFileName, reportTime } from './words';

const rule = (id: string, over: Partial<Rule> = {}): Rule => ({ id, type: 'noEdgeSpaces', label: `No leading or trailing spaces in ${id}`, enabled: true, severity: 'fail', params: { column: id }, ...over });

function project(): Project {
  const p = flow({
    sources: [src({ id: 'cust', name: 'customers.csv', format: 'csv', file: { originalName: 'customers.csv', size: 9, lastModified: 0, headHash: 'f00d' } })],
    nodes: [
      { id: 'in', type: 'source', sourceId: 'cust' },
      { id: 'out', type: 'output' },
    ],
    wires: [['in', 'out']],
  });
  return {
    ...p,
    name: 'Shop | <b>',
    nodes: p.nodes.map((n) =>
      n.id === 'in'
        ? {
            ...n,
            rules: [rule('name'), rule('email', { severity: 'warn' }), rule('id', { type: 'unique', label: 'id is unique', params: { columns: ['id'] } })],
            analysis: {
              at: '2026-10-16T12:00:00.000Z',
              rows: 4,
              issues: [
                { key: 'edgeSpaces:name', kind: 'edgeSpaces', column: 'name', label: 'Spaces at either end of name', count: 2, fixed: true },
                { key: 'nearDuplicate:city:Lodnon', kind: 'nearDuplicate', column: 'city', value: 'Lodnon', label: 'Lodnon in city, probably London', count: 1 },
              ],
            },
            ignoredIssues: ['nearDuplicate:city:Lodnon'],
          }
        : n,
    ),
    exportLog: [{ id: 'x', at: '2026-10-16T12:00:00.000Z', nodeId: 'out', nodeName: 'Output 1', format: 'csv', fileName: 'Output 1.csv', rows: 4, overridden: [{ nodeName: 'in', rule: 'r', nodeId: 'in', ruleId: 'name' }] }],
  };
}

function report(sampleLimit = 0): QualityReport {
  const p = project();
  return buildReport({
    project: p,
    nodeIds: reportNodeIds(p, 'out', 'node'),
    scope: 'node',
    results: { in: { results: { name: { state: 'ok', failures: 2, total: 4 }, email: { state: 'ok', failures: 1, total: 4 }, id: { state: 'ok', failures: 0, total: 4 } } } },
    sample: null,
    sources: [{ id: 'cust', name: 'customers.csv', kind: 'file', format: 'csv', rows: 4, headHash: 'f00d' }],
    samples: { in: { name: { columns: ['id', 'name'], rows: [['1', '  Ada Lovelace '], ['4', 'a|b']] }, email: { columns: ['id', 'email'], rows: [['2', 'grace@example.com ']] } } },
    sampleLimit,
    generatedAt: '2026-10-16T17:20:00.000Z',
  });
}

const VALUES = ['Ada Lovelace', 'grace@example.com', 'a|b', 'a\\|b'];

describe('Markdown', () => {
  it('lists every rule with its counts, and the sources with rows and head hashes', () => {
    const md = reportMarkdown(report());
    expect(md).toContain('# Quality report: Shop \\| \\<b\\>');
    expect(md).toContain('Generated 16 Oct 2026, 17:20 UTC by Puddle.');
    expect(md).toContain('**3 rules: 1 pass, 1 warn, 1 overridden.**');
    expect(md).toContain('| customers.csv | csv | 4 | `f00d` |');
    expect(md).toContain('| Overridden | No leading or trailing spaces in name | No leading or trailing spaces | Fail | name | 4 | 2 | 2 | 50% |');
    expect(md).toContain('| Warn | No leading or trailing spaces in email | No leading or trailing spaces | Warn | email | 4 | 3 | 1 | 25% |');
    expect(md).toContain('| Pass | id is unique | Unique | Fail | id | 4 | 4 | 0 | 0% |');
    expect(md).toContain('overridden. Exported anyway on 16 Oct 2026, 12:00 UTC, from Output 1 to Output 1.csv.');
  });

  it('lists the issues the node’s last analysis found, with what became of each', () => {
    const md = reportMarkdown(report());
    expect(md).toContain('### Issues\n\n2 issues found 16 Oct 2026, 12:00 UTC in 4 rows: 1 fixed, 1 ignored.\n\n| Outcome | Issue | Column | Rows |\n| --- | --- | --- | --- |\n| Fixed | Spaces at either end of name | name | 2 |\n| Ignored | Lodnon in city, probably London | city | 1 |');
  });

  it('with samples at 0 contains no row values, and says so', () => {
    const md = reportMarkdown(report(0));
    for (const v of VALUES) expect(md).not.toContain(v);
    expect(md).toContain('This report contains no row values');
  });

  it('with samples includes failing rows as tables, escaped, under a note that they hold data', () => {
    const md = reportMarkdown(report(10));
    expect(md).toContain('sample failing rows, which contain data');
    expect(md).toContain('#### Failing rows: No leading or trailing spaces in name');
    expect(md).toContain('| 1 |   Ada Lovelace  |');
    expect(md).toContain('| 4 | a\\|b |');
  });
});

describe('HTML', () => {
  it('is one self-contained page with the design system inlined, light and printable', () => {
    const html = reportHtml(report());
    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html).toContain('<html lang="en" data-theme="light">');
    // The design system's own tokens and component styles, not just the report's layout.
    expect(html).toMatch(/:root \{[^}]*--surface-panel:/);
    expect(html).toContain('.ui-badge--pass {');
    expect(html).toContain('.ui-qbar {');
    expect(html).toContain('@media print');
    expect(html).not.toMatch(/<script|<link|src="http/);
    expect(html).toContain('<title>Quality report: Shop | &lt;b&gt;</title>');
  });

  it('lays rules out as the rules panel does, with the overridden rule shown as overridden', () => {
    const html = reportHtml(report());
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const rows = [...doc.querySelectorAll('.ui-rule')];
    expect(rows.map((r) => r.getAttribute('data-status'))).toEqual(['overridden', 'warn', 'pass']);
    expect(rows.map((r) => r.querySelector('.ui-badge')!.textContent)).toEqual(['Overridden', 'Warn', 'Pass']);
    expect(rows[0]!.querySelector('.ui-badge')!.className).toContain('ui-badge--fail');
    expect(rows[0]!.textContent).toContain('2 of 4 rows fail (50%); 2 pass.');
    expect(rows[0]!.textContent).toContain('Exported anyway on 16 Oct 2026, 12:00 UTC, from Output 1 to Output 1.csv.');
    expect(rows[0]!.querySelector('.ui-qbar')!.getAttribute('aria-label')).toBe('50.0% valid, 0.0% empty, 50.0% error');
    expect(doc.querySelector('.report-hash')!.textContent).toBe('f00d');
  });

  it('with samples at 0 contains no row values', () => {
    const html = reportHtml(report(0));
    for (const v of VALUES) expect(html).not.toContain(v);
  });

  it('with samples shows failing rows in a grid, escaped', () => {
    const doc = new DOMParser().parseFromString(reportHtml(report(10)), 'text/html');
    const grid = doc.querySelector('.ui-rule .ui-grid')!;
    expect([...grid.querySelectorAll('th')].map((t) => t.textContent)).toEqual(['id', 'name']);
    expect(grid.querySelectorAll('tbody tr')).toHaveLength(2);
    expect(doc.body.textContent).toContain('a|b');
  });
});

describe('JSON', () => {
  it('is the report itself, with a stable schema name', async () => {
    const json = JSON.parse(await writeReport(report(), 'json'));
    expect(json).toEqual(JSON.parse(JSON.stringify(report())));
    expect(json.schema).toBe('puddle-quality-report/1');
    expect(json.nodes[0].rules.map((r: { status: string; failed: number }) => [r.status, r.failed])).toEqual([['overridden', 2], ['warn', 1], ['pass', 0]]);
  });

  it('with samples at 0 contains no row values', async () => {
    const json = await writeReport(report(0), 'json');
    for (const v of VALUES) expect(json).not.toContain(v);
    expect(json).not.toContain('"sample"');
  });
});

describe('words', () => {
  it('names the file after the project, safely', () => {
    expect(reportFileName('Shop', 'markdown')).toBe('Shop quality report.md');
    expect(reportFileName('a/b: c?', 'html')).toBe('a-b- c- quality report.html');
    expect(reportFileName('  ', 'json')).toBe('Project quality report.json');
  });

  it('writes times in UTC', () => {
    expect(reportTime('2026-01-02T03:04:00.000Z')).toBe('2 Jan 2026, 03:04 UTC');
  });
});
