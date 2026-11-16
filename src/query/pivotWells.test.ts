import { describe, expect, it } from 'vitest';
import type { QueryField } from '../model';
import { landing, wellOf } from './pivotWells';

const field = (f: Partial<QueryField>): QueryField => ({ id: 'f', port: 0, column: 'total', show: true, sort: 'none', ...f });

describe('the Pivot view’s wells', () => {
  it('puts each grid field in the well its Total means', () => {
    expect(wellOf(field({}))).toBe('rows');
    expect(wellOf(field({ total: 'group' }))).toBe('rows');
    expect(wellOf(field({ total: 'pivot' }))).toBe('columns');
    expect(wellOf(field({ total: 'where' }))).toBe('filters');
    expect(wellOf(field({ total: 'sum' }))).toBe('values');
    expect(wellOf(field({ total: 'expression' }))).toBe('values');
    // Every column of a table is no single field to group or summarise.
    expect(wellOf(field({ column: '*' }))).toBeUndefined();
  });

  it('gives a field landing in a well its Total: numbers are summed, anything else counted', () => {
    expect(landing('rows', undefined)).toEqual({ total: undefined, show: true });
    expect(landing('columns', undefined)).toEqual({ total: 'pivot', show: true, sort: 'none' });
    expect(landing('filters', undefined)).toEqual({ total: 'where', show: false, sort: 'none' });
    expect(landing('values', { name: 'total', type: 'DOUBLE' })).toEqual({ total: 'sum', show: true });
    expect(landing('values', { name: 'status', type: 'VARCHAR' })).toEqual({ total: 'count', show: true });
    expect(landing('values', undefined)).toEqual({ total: 'count', show: true });
  });
});
