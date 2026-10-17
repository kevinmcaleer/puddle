// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Menu } from './Menu';
import { groupItems } from './menuGroups';

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

  // Regression: the search was cleared whenever the parent re-rendered with a new onOpenChange, so typing in the
  // Add step menu lost its filter if anything else updated meanwhile.
  it('keeps what was typed when the parent re-renders the open menu', () => {
    const { rerender } = render(<Menu label="Add step" items={items()} search="Search steps" open onOpenChange={() => undefined} />);
    fireEvent.change(screen.getByLabelText('Search steps'), { target: { value: 'trim' } });
    rerender(<Menu label="Add step" items={items()} search="Search steps" open onOpenChange={() => undefined} />);
    expect((screen.getByLabelText('Search steps') as HTMLInputElement).value).toBe('trim');
    expect(screen.getAllByRole('menuitem').map((b) => b.textContent)).toEqual(['Trim spacesText']);
    // Closed and opened again, it starts empty.
    rerender(<Menu label="Add step" items={items()} search="Search steps" open={false} onOpenChange={() => undefined} />);
    rerender(<Menu label="Add step" items={items()} search="Search steps" open onOpenChange={() => undefined} />);
    expect((screen.getByLabelText('Search steps') as HTMLInputElement).value).toBe('');
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

  it('puts focus on the first item when it opens, moves with the arrow keys, Home and End, and wraps', () => {
    render(<Menu label="Add" items={items()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    const [trim, parse, keep] = screen.getAllByRole('menuitem');
    expect(document.activeElement).toBe(trim);
    fireEvent.keyDown(trim!, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(parse);
    fireEvent.keyDown(parse!, { key: 'End' });
    expect(document.activeElement).toBe(keep);
    fireEvent.keyDown(keep!, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(trim);
    fireEvent.keyDown(trim!, { key: 'ArrowUp' });
    expect(document.activeElement).toBe(keep);
    fireEvent.keyDown(keep!, { key: 'Home' });
    expect(document.activeElement).toBe(trim);
  });

  it('gathers items under their group headings, ungrouped ones first, and keeps the arrow keys moving across groups', () => {
    const grouped = [
      { label: 'Choose files', group: 'Sources', onSelect: vi.fn() },
      { label: 'From URL', group: 'Sources', onSelect: vi.fn() },
      { label: 'Transform', group: 'Nodes', onSelect: vi.fn() },
      { label: 'Output', group: 'Nodes', onSelect: vi.fn() },
    ];
    expect(groupItems([{ label: 'Loose', onSelect: vi.fn() }, ...grouped]).map((g) => [g.group, g.items.map((i) => i.label)])).toEqual([
      [undefined, ['Loose']],
      ['Sources', ['Choose files', 'From URL']],
      ['Nodes', ['Transform', 'Output']],
    ]);
    render(<Menu label="Add" items={grouped} />);
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    expect(screen.getAllByRole('group').map((g) => g.getAttribute('aria-labelledby') && document.getElementById(g.getAttribute('aria-labelledby')!)?.textContent)).toEqual(['Sources', 'Nodes']);
    const [files, url, transform] = screen.getAllByRole('menuitem');
    expect(document.activeElement).toBe(files);
    fireEvent.keyDown(files!, { key: 'End' });
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'Output' }));
    url!.focus();
    fireEvent.keyDown(url!, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(transform);
  });

  it('marks a radio item that is on with a tick', () => {
    const pick = vi.fn();
    render(<Menu label="Help" items={[{ label: 'Light', group: 'Theme', checked: true, onSelect: () => pick('light') }, { label: 'Dark', group: 'Theme', checked: false, onSelect: () => pick('dark') }]} />);
    fireEvent.click(screen.getByRole('button', { name: 'Help' }));
    const light = screen.getByRole('menuitemradio', { name: 'Light' });
    expect(light.getAttribute('aria-checked')).toBe('true');
    expect(light.querySelector('svg')).not.toBeNull();
    const dark = screen.getByRole('menuitemradio', { name: 'Dark' });
    expect(dark.getAttribute('aria-checked')).toBe('false');
    expect(dark.querySelector('svg')).toBeNull();
    fireEvent.click(dark);
    expect(pick).toHaveBeenCalledWith('dark');
  });

  it('opens with the down arrow on its button', () => {
    render(<Menu label="Add" items={items()} />);
    fireEvent.keyDown(screen.getByRole('button', { name: 'Add' }), { key: 'ArrowDown' });
    expect(document.activeElement).toBe(screen.getAllByRole('menuitem')[0]);
  });

  it('gives focus back to its button on Escape and when an item is picked', () => {
    const pick = vi.fn();
    render(<Menu label="Add" items={items(pick)} />);
    const button = screen.getByRole('button', { name: 'Add' });
    fireEvent.click(button);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(button);
    fireEvent.click(button);
    let focusedWhenPicked: Element | null = null;
    pick.mockImplementation(() => (focusedWhenPicked = document.activeElement));
    fireEvent.click(screen.getByRole('menuitem', { name: /Parse dates/ }));
    expect(pick).toHaveBeenCalledWith('parse');
    // Focus is back on the button before the item runs, so a dialog it opens gives focus back there.
    expect(focusedWhenPicked).toBe(button);
  });
});
