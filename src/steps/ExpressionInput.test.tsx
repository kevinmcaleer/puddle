// @vitest-environment jsdom
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ExpressionInput } from './ExpressionInput';
import { markedPieces, type TextMark } from './marks';

const columns = [{ name: 'email', type: 'VARCHAR' }];

describe('ExpressionInput', () => {
  afterEach(() => vi.useRealTimers());

  // Regression: the caret was moved a frame after inserting, so keys typed quickly landed in the wrong place.
  it('puts the caret after an inserted column before the next key arrives', () => {
    vi.useFakeTimers({ toFake: ['requestAnimationFrame'] });
    render(<ExpressionInput id="x" value="" columns={columns} onCommit={() => {}} />);
    const box = screen.getByRole<HTMLTextAreaElement>('combobox');
    act(() => {
      box.focus();
      fireEvent.change(box, { target: { value: 'upper(em', selectionStart: 8 } });
    });
    expect(screen.getByRole('option', { name: 'email' })).toBeTruthy();
    act(() => void fireEvent.keyDown(box, { key: 'Tab' }));
    expect(box.value).toBe('upper(email');
    expect(box.selectionStart).toBe(11);
    // Keep typing, then let any pending frame run: the caret must stay where the typing left it.
    act(() => {
      box.setRangeText(')', 11, 11, 'end');
      fireEvent.change(box, { target: { value: 'upper(email)' } });
    });
    act(() => void vi.runAllTimers());
    expect(box.selectionStart).toBe(12);
  });

  it('commits on blur, and Escape closes the suggestions', () => {
    const onCommit = vi.fn();
    render(<ExpressionInput id="x" value="" columns={columns} onCommit={onCommit} />);
    const box = screen.getByRole<HTMLTextAreaElement>('combobox');
    act(() => void fireEvent.change(box, { target: { value: 'e', selectionStart: 1 } }));
    act(() => void fireEvent.keyDown(box, { key: 'Escape' }));
    expect(screen.queryByRole('option')).toBeNull();
    act(() => void fireEvent.blur(box));
    expect(onCommit).toHaveBeenCalledWith('e');
  });

  it('cuts the text at its marks, dropping any that overlap or run past the end', () => {
    const marks: TextMark[] = [
      { start: 14, end: 20, found: true, nodeId: 'n1' },
      { start: 16, end: 18, found: false },
      { start: 30, end: 40, found: false },
    ];
    expect(markedPieces('SELECT * FROM orders o', marks)).toEqual([{ text: 'SELECT * FROM ' }, { text: 'orders', mark: marks[0] }, { text: ' o' }]);
  });

  it('draws marked text coloured under the textarea as it is typed, and points at the mark the caret is in', () => {
    const onPoint = vi.fn();
    const marks = (text: string): TextMark[] => [...text.matchAll(/\b(orders|nowhere)\b/g)].map((m) => ({ start: m.index, end: m.index + m[0].length, found: m[0] === 'orders', nodeId: m[0] === 'orders' ? 'n1' : undefined }));
    render(<ExpressionInput id="q" value="SELECT * FROM orders" columns={[]} onCommit={() => {}} marks={marks} onPoint={onPoint} />);
    const box = screen.getByRole<HTMLTextAreaElement>('combobox');
    const drawn = () => [...screen.getByTestId('q-marks').querySelectorAll('[data-mark]')].map((s) => [s.textContent, s.className]);
    expect(drawn()).toEqual([['orders', 'sql-table-found']]);
    act(() => void fireEvent.change(box, { target: { value: 'SELECT * FROM orders JOIN nowhere', selectionStart: 16 } }));
    expect(drawn()).toEqual([
      ['orders', 'sql-table-found'],
      ['nowhere', 'sql-table-missing'],
    ]);
    expect(screen.getByTestId('q-marks').textContent).toBe('SELECT * FROM orders JOIN nowhere');
    // The caret in a table's name points at it while the editor has focus, and stops when it leaves.
    act(() => void fireEvent.focus(box));
    expect(onPoint).toHaveBeenLastCalledWith(expect.objectContaining({ nodeId: 'n1' }));
    expect(drawn()[0]).toEqual(['orders', 'sql-table-found is-pointed']);
    act(() => void fireEvent.blur(box));
    expect(onPoint).toHaveBeenLastCalledWith(undefined);
  });

  it('is a plain textarea, with nothing drawn under it, when nothing asks for marks', () => {
    render(<ExpressionInput id="p" value="upper(email)" columns={columns} onCommit={() => {}} />);
    expect(screen.queryByTestId('p-marks')).toBeNull();
    expect(screen.getByRole('combobox').className).not.toContain('puddle-sql__text');
  });
});
