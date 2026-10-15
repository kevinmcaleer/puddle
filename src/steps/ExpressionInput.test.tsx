// @vitest-environment jsdom
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ExpressionInput } from './ExpressionInput';

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
});
