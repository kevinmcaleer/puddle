// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Menu } from './Menu';

afterEach(cleanup);

const items = (pick = vi.fn()) => [
  { label: 'Trim spaces', hint: 'Text', onSelect: () => pick('trim') },
  { label: 'Parse dates', hint: 'Dates', onSelect: () => pick('parse') },
  { label: 'Keep rows', hint: 'Rows', shortcut: 'K', onSelect: () => pick('keep') },
];

describe('Menu', () => {
  it('shows each item’s shortcut in mono', () => {
    render(<Menu label="Add" items={items()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    const kbd = screen.getByRole('menuitem', { name: /Keep rows/ }).querySelector('kbd')!;
    expect(kbd.textContent).toBe('K');
    expect(kbd.className).toContain('font-mono');
  });

  it('filters by label or hint as you type, and Enter picks the first left', () => {
    const pick = vi.fn();
    render(<Menu label="Add step" items={items(pick)} search="Search steps" />);
    fireEvent.click(screen.getByRole('button', { name: 'Add step' }));
    const box = screen.getByLabelText('Search steps');
    expect(document.activeElement).toBe(box);
    fireEvent.change(box, { target: { value: 'date' } });
    expect(screen.getAllByRole('menuitem').map((b) => b.textContent)).toEqual(['Parse datesDates']);
    fireEvent.keyDown(box, { key: 'Enter' });
    expect(pick).toHaveBeenCalledWith('parse');
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('says so when nothing matches', () => {
    render(<Menu label="Add step" items={items()} search="Search steps" />);
    fireEvent.click(screen.getByRole('button', { name: 'Add step' }));
    fireEvent.change(screen.getByLabelText('Search steps'), { target: { value: 'zzz' } });
    expect(screen.getByText('No matches')).toBeTruthy();
  });

  it('can be opened from outside, and reports closing', () => {
    const onOpenChange = vi.fn();
    const { rerender } = render(<Menu label="Add" items={items()} open={false} onOpenChange={onOpenChange} />);
    expect(screen.queryByRole('menu')).toBeNull();
    rerender(<Menu label="Add" items={items()} open onOpenChange={onOpenChange} />);
    expect(screen.getByRole('menu')).toBeTruthy();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
