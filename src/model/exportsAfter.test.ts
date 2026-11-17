import { describe, expect, it } from 'vitest';
import { flow, src, step } from '../../tests/helpers/projects';
import { exportNameAfter, outputAfter } from './exports';

const sales = src({ id: 's1', format: 'csv', name: 'sales.2024.csv' });
const customers = src({ id: 's2', format: 'csv', name: 'customers.xlsx' });
const project = flow({
  sources: [sales, customers],
  nodes: [
    { id: 'a', type: 'source', sourceId: 's1' },
    { id: 'b', type: 'source', sourceId: 's2' },
    { id: 't', type: 'transform', steps: [step('trim', 'trimWhitespace', { columns: ['name'] })] },
    { id: 't2', type: 'transform' },
    { id: 'j', type: 'join' },
    { id: 'out', type: 'output' },
    { id: 'sql', type: 'sql', sqlSpec: { query: 'SELECT 1 AS n' } },
  ],
  wires: [
    ['a', 't'],
    ['t', 't2'],
    ['t', 'out'],
    ['t2', 'j', 'left'],
    ['b', 'j', 'right'],
  ],
});

describe('the Output after a node', () => {
  it('is the Output wired straight from it, and none otherwise', () => {
    expect(outputAfter(project, 't')?.id).toBe('out');
    expect(outputAfter(project, 'a')).toBeUndefined();
    expect(outputAfter(project, 'out')).toBeUndefined();
  });
});

describe('a file name for an export, after the data', () => {
  it('is the source’s name without its extension, marked clean once steps follow it', () => {
    expect(exportNameAfter(project, 'a')).toBe('sales.2024');
    expect(exportNameAfter(project, 't')).toBe('sales.2024-clean');
    expect(exportNameAfter(project, 't2')).toBe('sales.2024-clean');
    expect(exportNameAfter(project, 'b')).toBe('customers');
  });

  it('is left to the Output’s own name when the rows come from several sources or none', () => {
    expect(exportNameAfter(project, 'j')).toBeUndefined();
    expect(exportNameAfter(project, 'sql')).toBeUndefined();
    expect(exportNameAfter(project, 'nope')).toBeUndefined();
  });

  it('keeps a name that is all extension', () => {
    const odd = flow({ sources: [src({ id: 's', format: 'csv', name: '.csv' })], nodes: [{ id: 'a', type: 'source', sourceId: 's' }] });
    expect(exportNameAfter(odd, 'a')).toBe('.csv');
  });
});
