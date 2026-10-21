import { describe, expect, it } from 'vitest';
import type { Issue } from '../analysis/issues';
import { describeAnalysis, fixWords, projectForFile, type FileAnalysis } from './analyse';

const issue = (over: Partial<Issue>): Issue => ({ key: 'edgeSpaces:name', kind: 'edgeSpaces', column: 'name', count: 2, examples: [], severity: 'fix', fix: { type: 'trimWhitespace' }, ...over });

describe('puddle-run analyse', () => {
  it('names each fix from its step, or the read option or steps it sets', () => {
    expect(fixWords(issue({}))).toBe('Trim whitespace');
    expect(fixWords(issue({ fix: { readOptions: { skip: 3 }, label: 'Skip 3 lines at the top' } }))).toBe('Skip 3 lines at the top');
    expect(fixWords(issue({ fix: { steps: [{ type: 'replaceValues' }], label: 'Replace values' } }))).toBe('Replace values');
    expect(fixWords(issue({ fix: undefined }))).toBeUndefined();
  });

  it('prints the file, its rows and columns, then one line per issue with its severity, count and fix', () => {
    const a: FileAnalysis = {
      name: 'messy.csv',
      format: 'csv',
      project: projectForFile('messy.csv', { format: 'csv', confidence: 'sure', parseOptions: {}, alternatives: [], reason: '' }).project,
      nodeId: 'in',
      columns: [{ name: 'name', type: 'VARCHAR' }, { name: 'price', type: 'VARCHAR' }],
      analysis: { columns: [], profile: {}, facts: { rows: 5, columns: {} } as FileAnalysis['analysis']['facts'] },
      issues: [issue({}), issue({ key: 'mixedCase:name', kind: 'mixedCase', count: 1, severity: 'suggest', fix: { type: 'changeCase', params: { mode: 'title' } } }), issue({ key: 'idDuplicates:price', kind: 'idDuplicates', column: 'price', count: 3, severity: 'info', fix: undefined })],
    };
    expect(describeAnalysis(a)).toEqual([
      'messy.csv: CSV, 5 rows, 2 columns',
      '  3 issues',
      '  fix     Spaces at either end of name: 2 rows. Trim whitespace',
      '  suggest Mixed capitals in name: 1 value. Change case',
      '  info    Repeated values in price: 3 rows',
    ]);
    expect(describeAnalysis({ ...a, issues: [], analysis: { ...a.analysis, facts: { ...a.analysis.facts, sample: { rows: 200_000, total: 300_000 } } } })).toEqual(['messy.csv: CSV, 5 rows, 2 columns', '  checked on the first 200,000 rows', '  no issues found']);
  });

  it('reads a file through a project of one source, with the format and read options the sniff chose', () => {
    const { project, nodeId } = projectForFile('/data/orders.tsv', { format: 'tsv', confidence: 'sure', parseOptions: { encoding: 'latin-1' }, alternatives: [], reason: '' });
    expect(nodeId).toBe('in');
    expect(project.sources[0]).toMatchObject({ name: 'orders.tsv', kind: 'file', format: 'tsv', parseOptions: { encoding: 'latin-1' }, file: { originalName: 'orders.tsv', path: '/data/orders.tsv' } });
    expect(project.nodes[0]).toMatchObject({ id: 'in', type: 'source', sourceId: project.sources[0]!.id });
  });
});
