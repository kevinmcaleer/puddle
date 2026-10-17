import { describe, expect, it } from 'vitest';
import { flow, src } from '../../tests/helpers/projects';
import { placeSources, sourceCandidates } from './sources';

const file = (over: Partial<NonNullable<ReturnType<typeof src>['file']>> = {}) => ({ originalName: 'customers.csv', size: 1, lastModified: 0, headHash: 'x', ...over });

describe('placing a project’s sources for the runner', () => {
  it('looks at the runner path first, then the original name beside the project and under sources/', () => {
    const s = src({ id: 'a', format: 'csv' });
    expect(sourceCandidates({ ...s, file: file() }, '/projects')).toEqual(['/projects/customers.csv', '/projects/sources/customers.csv']);
    expect(sourceCandidates({ ...s, file: file({ path: 'data/c.csv' }) }, '/projects')).toEqual(['/projects/data/c.csv', '/projects/customers.csv', '/projects/sources/customers.csv']);
    expect(sourceCandidates({ ...s, file: file({ path: '/data/c.csv', originalName: '../../etc/passwd' }) }, '/projects')).toEqual(['/data/c.csv', '/projects/passwd', '/projects/sources/passwd']);
  });

  it('says which file was found, and why one wasn’t', () => {
    const a = { ...src({ id: 'a', format: 'csv' }), file: file() };
    const b = { ...src({ id: 'b', format: 'csv' }), file: file({ originalName: 'orders.csv' }) };
    const x = { ...src({ id: 'x', format: 'xlsx' }), file: file({ originalName: 'sales.xlsx' }) };
    const u = { ...src({ id: 'u', format: 'json' }), kind: 'url' as const, url: { href: 'https://example.com/items.json' } };
    const c = { ...src({ id: 'c', format: 'csv' }), kind: 'clipboard' as const, clipboard: { text: 'a,b\n1,2' } };
    const w = { ...src({ id: 'w', format: 'csv' }), kind: 'url' as const, url: { href: 'https://example.com/page', table: { index: 0, label: 'Prices' } } };
    const project = flow({ sources: [a, b, x, u, c, w], nodes: [], wires: [] });
    const places = placeSources(project, '/p', (path) => path === '/p/sources/customers.csv');
    expect(places.map((p) => [p.source.id, p.path ?? p.reason])).toEqual([
      ['a', '/p/sources/customers.csv'],
      ['b', 'was not found at /p/orders.csv or /p/sources/orders.csv'],
      ['x', 'is an Excel workbook, which the runner can’t read yet'],
      ['u', 'https://example.com/items.json'],
      ['c', ''],
      ['w', 'is a table on a web page, which the runner can’t read yet'],
    ]);
  });
});
