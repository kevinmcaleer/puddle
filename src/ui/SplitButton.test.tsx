// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SplitButton, type CheckItem } from './SplitButton';

afterEach(cleanup);

const items: CheckItem[] = [
  { id: 'trim', label: 'Spaces at either end of name', group: 'Clean', hint: 'Trim whitespace', checked: true },
  { id: 'dups', label: 'Duplicate rows', group: 'Rows', checked: true },
  { id: 'num', label: 'Numbers written as text in amount', group: 'Change type', checked: false },
];

const setup = (props: Partial<Parameters<typeof SplitButton>[0]> = {}) => {
  const onClick = vi.fn();
  const onApply = vi.fn();
  const onToggle = vi.fn();
  render(<SplitButton label="Fix 2 issues" onClick={onClick} items={items} onToggle={onToggle} applyLabel="Apply 2 fixes" onApply={onApply} menuLabel="Choose fixes" {...props} />);
  return { onClick, onApply, onToggle };
};

describe('SplitButton', () => {
  it('does the whole thing from the main part, and opens the check list from the arrow', () => {
    const { onClick } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Fix 2 issues' }));
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Choose fixes' }));
    const dialog = screen.getByRole('dialog', { name: 'Choose fixes' });
    expect(dialog).toBeTruthy();
    // Grouped under headings, in the order the groups first appear, with the hint at the end.
    expect([...dialog.querySelectorAll('[role="group"]')].map((g) => g.getAttribute('aria-labelledby') && document.getElementById(g.getAttribute('aria-labelledby')!)?.textContent)).toEqual(['Clean', 'Rows', 'Change type']);
    const trim = screen.getByLabelText('Spaces at either end of name');
    expect(trim).toHaveProperty('checked', true);
    expect(document.getElementById(trim.getAttribute('aria-describedby')!)?.textContent).toBe('Trim whitespace');
    expect(screen.getByLabelText('Numbers written as text in amount')).toHaveProperty('checked', false);
  });

  it('toggles with a click, applies from the bottom button or Enter, and closes on Escape', () => {
    const { onApply, onToggle } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Choose fixes' }));
    fireEvent.click(screen.getByLabelText('Duplicate rows'));
    expect(onToggle).toHaveBeenCalledWith('dups', false);
    fireEvent.click(screen.getByRole('button', { name: 'Apply 2 fixes' }));
    expect(onApply).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Choose fixes' }));
    fireEvent.keyDown(screen.getByLabelText('Duplicate rows'), { key: 'Enter' });
    expect(onApply).toHaveBeenCalledTimes(2);

    fireEvent.click(screen.getByRole('button', { name: 'Choose fixes' }));
    expect(screen.getByRole('dialog')).toBeTruthy();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(onApply).toHaveBeenCalledTimes(2);
  });

  it('with nothing ticked, the apply button is disabled and Enter does nothing', () => {
    const { onApply } = setup({ items: items.map((i) => ({ ...i, checked: false })), applyLabel: 'Apply' });
    fireEvent.click(screen.getByRole('button', { name: 'Choose fixes' }));
    expect(screen.getByRole('button', { name: 'Apply' })).toHaveProperty('disabled', true);
    fireEvent.keyDown(screen.getByLabelText('Duplicate rows'), { key: 'Enter' });
    expect(onApply).not.toHaveBeenCalled();
  });
});
