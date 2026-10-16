import { describe, expect, it } from 'vitest';
import { fieldErrors, stepForm } from './forms';
import { mixedTypesProblem, rowsChange, transposedPreview } from './unpivot';
import './index';

const columns = [
  { name: 'region', type: 'VARCHAR' },
  { name: 'q1', type: 'BIGINT' },
  { name: 'q2', type: 'DOUBLE' },
  { name: 'manager', type: 'VARCHAR' },
  { name: 'since', type: 'DATE' },
];

describe('unpivot form', () => {
  it('warns before running when the columns hold different kinds of values', () => {
    expect(mixedTypesProblem({ columns: ['q1', 'q2'] }, columns)).toBeUndefined();
    expect(mixedTypesProblem({ columns: ['q1', 'q2', 'manager'] }, columns)).toBe(
      'The columns to unpivot hold numbers (q1, q2) and text (manager), and one value column can only hold one kind. Turn on Treat all values as text, or change their types first.',
    );
    // With "every column except", the columns it unpivots are the ones not picked.
    expect(mixedTypesProblem({ columns: ['region', 'manager'], except: true }, columns)).toBe(
      'The columns to unpivot hold numbers (q1, q2) and dates (since), and one value column can only hold one kind. Turn on Treat all values as text, or change their types first.',
    );
    expect(mixedTypesProblem({ columns: ['q1', 'manager'], asText: true }, columns)).toBeUndefined();
    expect(mixedTypesProblem({ columns: [] }, columns)).toBeUndefined();
  });

  it('starts from the selected columns, and says what is wrong with the names', () => {
    const form = stepForm('unpivot')!;
    expect(form.group).toBe('Reshape');
    const params = form.defaults({ selected: ['q1', 'q2', 'gone'], available: columns });
    expect(params).toMatchObject({ columns: ['q1', 'q2'], except: false, attribute: 'attribute', value: 'value' });
    expect(fieldErrors({ type: 'unpivot', params: { ...params, value: 'Attribute' } })).toEqual({ value: 'Name the attribute and value columns differently.' });
    expect(fieldErrors({ type: 'unpivot', params: { ...params, columns: ['region'], except: true, attribute: 'Region' } })).toEqual({ attribute: 'The column region stays as it is: give the new column another name.' });
    expect(fieldErrors({ type: 'unpivot', params: { ...params, attribute: ' ' } })).toEqual({ attribute: 'Name the attribute column.' });
  });
});

describe('transpose form', () => {
  it('starts from the rows read when it is added, or asks for them', () => {
    const form = stepForm('transpose')!;
    const read = form.defaults({ selected: [], available: columns, rows: { rowCount: 2, headerValues: ['East', 'North'] } });
    expect(read).toMatchObject({ columns: ['region', 'q1', 'q2', 'manager', 'since'], rowCount: 2, headers: false });
    expect(fieldErrors({ type: 'transpose', params: read })).toEqual({});
    const unread = form.defaults({ selected: [], available: columns });
    expect(fieldErrors({ type: 'transpose', params: unread })).toEqual({ rowCount: 'The rows haven’t been read: refresh them.' });
  });

  it('previews the new columns, naming blanks and repeats so they stay apart', () => {
    expect(transposedPreview({ rowCount: 3, headerValues: ['East', 'east', ''], headers: true })).toEqual(['East', 'east (2)', 'row 3']);
    expect(transposedPreview({ rowCount: 2, headerValues: ['Column', null], headers: true })).toEqual(['Column (2)', 'row 2']);
    expect(transposedPreview({ rowCount: 2, headerValues: ['East', 'North'], headers: false })).toEqual(['row 1', 'row 2']);
  });

  it('reports what reading the rows again changed', () => {
    expect(rowsChange(3, 3, ['a'], ['a'])).toBe('No change: still 3 rows.');
    expect(rowsChange(3, 4, ['a'], ['a'])).toBe('Now 4 rows, not 3.');
    expect(rowsChange(undefined, 1, [], ['a'])).toBe('Now 1 row. The input’s columns have changed too.');
    expect(rowsChange(1200, 1200, ['a'], ['a'])).toBe('No change: still 1,200 rows.');
  });
});
