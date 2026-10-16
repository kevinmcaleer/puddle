// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TransposeRows, type ReadTransposeRows } from './TransposeRows';

const columns = [
  { name: 'region', type: 'VARCHAR' },
  { name: 'q1', type: 'BIGINT' },
];

describe('TransposeRows', () => {
  afterEach(cleanup);

  it('says how many columns the rows make, and refresh reads the rows and the columns again', async () => {
    const read = vi.fn<ReadTransposeRows>(async () => ({ rowCount: 4, headerValues: ['a', 'b', 'c', 'd'] }));
    const onChange = vi.fn();
    render(<TransposeRows params={{ columns: ['region'], rowCount: 3, headers: true }} columns={columns} read={read} onChange={onChange} />);
    expect(screen.getByText('3 rows become 3 columns.')).toBeTruthy();
    await act(async () => void fireEvent.click(screen.getByRole('button', { name: 'Refresh rows' })));
    expect(read).toHaveBeenCalledWith('region');
    expect(onChange).toHaveBeenCalledWith({ columns: ['region', 'q1'], rowCount: 4, headerValues: ['a', 'b', 'c', 'd'], headers: true });
    expect(screen.getByRole('status').textContent).toBe('Now 4 rows, not 3. The input’s columns have changed too.');
  });

  // Regression: a Transpose added before its input's columns were known never read its rows, so it stayed unset.
  it('reads the rows by itself once the columns are known, if they haven’t been read', async () => {
    const read = vi.fn<ReadTransposeRows>(async () => ({ rowCount: 2, headerValues: ['a', 'b'] }));
    const onChange = vi.fn();
    const { rerender } = render(<TransposeRows params={{ columns: [], headers: false }} columns={[]} read={read} onChange={onChange} />);
    expect(read).not.toHaveBeenCalled();
    await act(async () => void rerender(<TransposeRows params={{ columns: [], headers: false }} columns={columns} read={read} onChange={onChange} />));
    expect(read).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith({ columns: ['region', 'q1'], headers: false, rowCount: 2, headerValues: ['a', 'b'] });
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('says when there are too many rows, and when they could not be read', async () => {
    const read = vi.fn<ReadTransposeRows>(async () => {
      throw new Error('The query was cancelled.');
    });
    render(<TransposeRows params={{ rowCount: 1500 }} columns={columns} read={read} onChange={() => {}} />);
    expect(screen.getByText('1,500 rows: too many to transpose.')).toBeTruthy();
    await act(async () => void fireEvent.click(screen.getByRole('button', { name: 'Refresh rows' })));
    expect(screen.getByRole('alert').textContent).toContain('The rows couldn’t be read. The query was cancelled.');
  });
});
