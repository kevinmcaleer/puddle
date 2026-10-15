import { describe, expect, it } from 'vitest';
import { newStep } from '.';

const available = [
  { name: 'column0', type: 'VARCHAR' },
  { name: 'column1', type: 'VARCHAR' },
];

describe('rows step defaults', () => {
  it('promote headers takes its names from the first row, keeping blanks as they were', () => {
    const step = newStep('promoteHeaders', { selected: [], available, firstRow: { column0: 'Region', column1: null } });
    expect(step.params).toEqual({ renames: [{ from: 'column0', to: 'Region' }, { from: 'column1', to: 'column1' }] });
    expect(step.label).toBe('Promoted the first row to headers');
  });

  it('a filter starts on the selected column and is ready to run', () => {
    const step = newStep('filterRows', { selected: ['column1'], available });
    expect(step.params).toMatchObject({ conditions: [{ column: 'column1', op: 'notEmpty' }] });
    expect(step.label).toBe('Kept rows where column1 is not empty');
  });

  it('sort and duplicate steps start from the selection', () => {
    expect(newStep('sortRows', { selected: ['column1', 'column0'], available }).params).toEqual({
      keys: [
        { column: 'column1', descending: false },
        { column: 'column0', descending: false },
      ],
    });
    expect(newStep('duplicateRows', { selected: [], available }).label).toBe('Removed duplicate rows');
  });
});
