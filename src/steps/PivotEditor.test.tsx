// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fieldErrors } from './forms';
import { PivotEditor, type ReadPivotValues } from './PivotEditor';
import './index';

const columns = [
  { name: 'region', type: 'VARCHAR' },
  { name: 'month', type: 'VARCHAR' },
  { name: 'total', type: 'DOUBLE' },
];

/** The editor with its settings held in state, as the inspector holds them in the project. */
function Harness({ read, start = {}, seen }: { read?: ReadPivotValues; start?: Record<string, unknown>; seen: (p: Record<string, unknown>) => void }) {
  const [params, setParams] = useState<Record<string, unknown>>(start);
  return (
    <PivotEditor
      params={params}
      errors={fieldErrors({ type: 'pivot', params })}
      columns={columns}
      readValues={read}
      onChange={(p) => {
        seen(p);
        setParams(p);
      }}
    />
  );
}

/** A drag carrying data between elements, as the browser would hand it to each handler. */
function dataTransfer() {
  const data = new Map<string, string>();
  return {
    setData: (k: string, v: string) => void data.set(k, v),
    getData: (k: string) => data.get(k) ?? '',
    get types() {
      return [...data.keys()];
    },
    effectAllowed: 'all',
    dropEffect: 'none',
  };
}

const menu = (trigger: string, item: string) => {
  fireEvent.click(screen.getByRole('button', { name: trigger }));
  fireEvent.click(screen.getByRole('menuitem', { name: item }));
};

describe('PivotEditor', () => {
  afterEach(cleanup);

  it('builds a pivot by keyboard: fields from their menus, the aggregate from its tag, values read for Columns', async () => {
    const read = vi.fn<ReadPivotValues>(async () => ({ values: ['2024-01', '2024-02'], more: false }));
    let last: Record<string, unknown> = {};
    render(<Harness read={read} seen={(p) => (last = p)} />);
    expect(screen.getByText('Drag a column to Rows or Values.')).toBeTruthy();

    menu('Add region', 'Add to rows');
    menu('Add total', 'Add to values');
    fireEvent.click(screen.getByRole('button', { name: 'Add month' }));
    await act(async () => void fireEvent.click(screen.getByRole('menuitem', { name: 'Use as columns' })));
    expect(read).toHaveBeenCalledWith({ column: 'month', filters: [] });
    expect(last).toMatchObject({ rows: ['region'], column: 'month', pivotValues: ['2024-01', '2024-02'], values: [{ column: 'total', agg: 'sum' }] });
    expect(screen.getByText('Columns for month: 2024-01, 2024-02.')).toBeTruthy();

    menu('Summarise total: sum', 'Average');
    expect(last).toMatchObject({ values: [{ column: 'total', agg: 'average' }] });
    // Moving by keyboard: region from Rows to Filters.
    menu('Rows: region', 'Move to filters');
    expect(last).toMatchObject({ rows: [], filters: [{ column: 'region', op: 'notEmpty', value: '' }] });
    // New filters change which values there are, so they're read again.
    expect(read).toHaveBeenLastCalledWith({ column: 'month', filters: [{ column: 'region', op: 'notEmpty', value: '' }] });
  });

  it('drops a field dragged from the list into a zone, and a chip into another zone', () => {
    let last: Record<string, unknown> = {};
    render(<Harness seen={(p) => (last = p)} />);
    const dt = dataTransfer();
    fireEvent.dragStart(screen.getByRole('button', { name: 'Add total' }), { dataTransfer: dt });
    const values = screen.getByRole('group', { name: 'Values' });
    fireEvent.dragOver(values, { dataTransfer: dt });
    fireEvent.drop(values, { dataTransfer: dt });
    expect(last).toMatchObject({ values: [{ column: 'total', agg: 'sum' }] });

    const chip = within(values).getByRole('button', { name: 'Values: total' }).closest('.ui-fchip')!;
    const dt2 = dataTransfer();
    fireEvent.dragStart(chip, { dataTransfer: dt2 });
    fireEvent.drop(screen.getByRole('group', { name: 'Rows' }), { dataTransfer: dt2 });
    expect(last).toMatchObject({ rows: ['total'], values: [] });
  });

  it('refresh says what changed, and warns when there were more values than can be columns', async () => {
    const read = vi.fn<ReadPivotValues>(async () => ({ values: ['a', 'c'], more: true }));
    render(<Harness read={read} start={{ rows: ['region'], column: 'month', pivotValues: ['a', 'b'], values: [{ column: 'total', agg: 'sum' }] }} seen={() => {}} />);
    await act(async () => void fireEvent.click(screen.getByRole('button', { name: 'Refresh columns' })));
    expect(screen.getByText('Added c. Removed b.').getAttribute('role')).toBe('status');
    expect(screen.getByText('Too many values to make columns from')).toBeTruthy();
  });

  it('renames an output column', () => {
    let last: Record<string, unknown> = {};
    render(<Harness start={{ rows: ['region'], values: [{ column: 'total', agg: 'sum' }] }} seen={(p) => (last = p)} />);
    fireEvent.click(screen.getByRole('button', { name: 'Rename columns (1)' }));
    const input = screen.getByLabelText('sum of total');
    fireEvent.change(input, { target: { value: 'revenue' } });
    fireEvent.blur(input);
    expect(last).toMatchObject({ names: { 'sum of total': 'revenue' } });
  });
});
