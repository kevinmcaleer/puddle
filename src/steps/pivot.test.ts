import { describe, expect, it } from 'vitest';
import { stepForm } from './forms';
import { addToZone, moveField, pivotDraft, pivotValuesChange, removeFromZone, renameOutput, setAggregate, valuesStale, zoneFields } from './pivot';
import './index';

const columns = [
  { name: 'region', type: 'VARCHAR' },
  { name: 'month', type: 'VARCHAR' },
  { name: 'total', type: 'DOUBLE' },
  { name: 'units', type: 'BIGINT' },
];
const empty = pivotDraft({});

describe('pivot editor edits', () => {
  it('fills in missing settings', () => {
    expect(empty).toEqual({ rows: [], column: '', pivotValues: [], moreValues: false, values: [], filters: [], names: {} });
  });

  it('adds fields to each zone; numbers are summed, anything else counted, and a repeat gets the next aggregate', () => {
    let d = addToZone(empty, 'region', 'rows', columns);
    d = addToZone(d, 'total', 'values', columns);
    d = addToZone(d, 'region', 'values', columns);
    d = addToZone(d, 'total', 'values', columns);
    d = addToZone(d, 'month', 'filters', columns);
    expect(d.rows).toEqual(['region']);
    expect(d.values).toEqual([
      { column: 'total', agg: 'sum' },
      { column: 'region', agg: 'count' },
      { column: 'total', agg: 'count' },
    ]);
    expect(d.filters).toEqual([{ column: 'month', op: 'notEmpty', value: '' }]);
    // A field is in Rows once.
    expect(addToZone(d, 'region', 'rows', columns)).toBe(d);
  });

  it('Rows and Columns never share a field, and a new Columns field drops the values read for the old one', () => {
    const d = { ...addToZone(empty, 'region', 'rows', columns), column: 'month', pivotValues: ['2024-01'], moreValues: true };
    const swapped = addToZone(d, 'region', 'column', columns);
    expect(swapped).toMatchObject({ rows: [], column: 'region', pivotValues: [], moreValues: false });
    expect(addToZone(swapped, 'region', 'rows', columns)).toMatchObject({ rows: ['region'], column: '', pivotValues: [] });
  });

  it('reorders within a zone and moves between zones, by drag position or up and down', () => {
    let d = ['region', 'month', 'units'].reduce((acc, c) => addToZone(acc, c, 'rows', columns), empty);
    expect(moveField(d, 'rows', 2, 'rows', columns, 0).rows).toEqual(['units', 'region', 'month']);
    // Down one is "before the field after next".
    expect(moveField(d, 'rows', 0, 'rows', columns, 2).rows).toEqual(['month', 'region', 'units']);
    expect(moveField(d, 'rows', 1, 'rows', columns).rows).toEqual(['region', 'units', 'month']);
    d = moveField(d, 'rows', 2, 'values', columns);
    expect(d.rows).toEqual(['region', 'month']);
    expect(d.values).toEqual([{ column: 'units', agg: 'sum' }]);
    d = moveField(d, 'values', 0, 'rows', columns, 0);
    expect(zoneFields(d, 'rows')).toEqual(['units', 'region', 'month']);
    expect(moveField(d, 'rows', 7, 'values', columns)).toBe(d);
  });

  it('removes, changes aggregates and renames', () => {
    let d = addToZone(addToZone(empty, 'total', 'values', columns), 'units', 'values', columns);
    d = setAggregate(d, 1, 'median');
    expect(d.values[1]).toEqual({ column: 'units', agg: 'median' });
    expect(removeFromZone(d, 'values', 0).values).toEqual([{ column: 'units', agg: 'median' }]);
    d = renameOutput(d, 'sum of total', ' Revenue ');
    expect(d.names).toEqual({ 'sum of total': 'Revenue' });
    expect(renameOutput(d, 'sum of total', '').names).toEqual({});
    expect(renameOutput(d, 'sum of total', 'sum of total').names).toEqual({});
  });

  it('reads values again only when the Columns field or the filters change', () => {
    const d = { ...empty, column: 'month', pivotValues: ['a'] };
    expect(valuesStale(empty, d)).toBe(true);
    expect(valuesStale(d, addToZone(d, 'total', 'values', columns))).toBe(false);
    expect(valuesStale(d, addToZone(d, 'region', 'filters', columns))).toBe(true);
    expect(valuesStale(d, removeFromZone(d, 'column', 0))).toBe(false);
  });

  it('reports what refreshing the values changed', () => {
    expect(pivotValuesChange(['a', 'b'], ['a', 'b'])).toBe('No change: the same 2 values.');
    expect(pivotValuesChange(['a'], ['a'])).toBe('No change: the same 1 value.');
    expect(pivotValuesChange(['a', 'b'], ['a', 'c'])).toBe('Added c. Removed b.');
    expect(pivotValuesChange([], ['1', '2', '3', '4', '5', '6', '7'])).toBe('Added 1, 2, 3, 4, 5 and 2 more.');
  });

  it('starts with the selected columns in Rows', () => {
    const form = stepForm('pivot')!;
    expect(form.group).toBe('Reshape');
    expect(form.defaults({ selected: ['region', 'gone'], available: columns })).toMatchObject({ rows: ['region'], column: '', values: [] });
  });
});
