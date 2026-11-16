import { describe, expect, it } from 'vitest';
import { step } from '../../tests/helpers/projects';
import type { GraphNode, Step } from '../model';
import { cardHeading, cardKind, tableTag } from './kind';

const transform = (steps: Step[]): GraphNode => ({ id: 't', type: 'transform', name: 'Transform 1', position: { x: 0, y: 0 }, rules: [], steps });

describe('cardKind', () => {
  it('draws a Lookup as a Join and every other node as itself', () => {
    expect(cardKind('lookup')).toBe('join');
    expect(cardKind('transform')).toBe('transform');
  });
});

describe('cardHeading', () => {
  it('heads a one-step Transform by what the step does, with the node name under it', () => {
    const one = transform([{ ...step('a', 'trimWhitespace', { columns: ['name'] }), label: 'Trimmed name' }]);
    expect(cardHeading(one)).toEqual({ name: 'Trimmed name', detail: 'Transform 1' });
    // A detail given (such as a group's) still wins over the node name.
    expect(cardHeading(one, 'In Group 1')).toEqual({ name: 'Trimmed name', detail: 'In Group 1' });
  });

  it('heads an empty or stacked Transform, and any other node, by its name', () => {
    expect(cardHeading(transform([]))).toEqual({ name: 'Transform 1', detail: undefined });
    const two = transform([step('a', 'trimWhitespace', { columns: ['name'] }), step('b', 'removeColumns', { columns: ['email'] })]);
    expect(cardHeading(two)).toEqual({ name: 'Transform 1', detail: undefined });
    const out: GraphNode = { id: 'o', type: 'output', name: 'Output 1', position: { x: 0, y: 0 }, rules: [], outputSpec: { format: 'csv', options: {} } };
    expect(cardHeading(out, 'CSV')).toEqual({ name: 'Output 1', detail: 'CSV' });
  });
});

describe('tableTag', () => {
  const base = { position: { x: 0, y: 0 }, rules: [] };

  it('tags a table a script creates and a source as tables, saying how each came to be', () => {
    const made: GraphNode = { ...base, id: 's', type: 'scriptTable', name: 'users', scriptTable: { table: 'users' } };
    expect(tableTag(made)).toEqual({ label: 'SQL table', title: expect.stringContaining('CREATE TABLE') });
    const source: GraphNode = { ...base, id: 'c', type: 'source', name: 'customers.csv', sourceId: 'src' };
    expect(tableTag(source)).toEqual({ label: 'Imported table', title: expect.stringContaining('imported') });
  });

  it('leaves the nodes that work on tables untagged, the SQL node that holds the script among them', () => {
    expect(tableTag(transform([]))).toBeUndefined();
    expect(tableTag({ ...base, id: 'q', type: 'sql', name: 'SQL 1', sqlSpec: { query: 'CREATE TABLE users AS SELECT 1' } })).toBeUndefined();
  });
});
