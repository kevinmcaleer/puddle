// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ContextMenu } from './ContextMenu';

afterEach(cleanup);

const items = (pick = vi.fn()) => [
  { label: 'Trim', group: 'Transform', onSelect: () => pick('trim') },
  { label: 'Remove column', group: 'Columns', onSelect: () => pick('remove') },
  { label: 'Add each step as a new node', group: 'Steps', checked: true, toggle: true, onSelect: () => pick('nodes') },
];

describe('ContextMenu', () => {
  it('opens with focus on its first item, groups its items, and the arrow keys move between them', () => {
    render(<ContextMenu x={10} y={10} label="Actions for city" items={items()} onClose={() => undefined} />);
    const menu = screen.getByRole('menu', { name: 'Actions for city' });
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'Trim' }));
    expect(screen.getByRole('group', { name: 'Columns' })).toBeTruthy();
    fireEvent.keyDown(menu, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'Remove column' }));
    expect(screen.getByRole('menuitemcheckbox', { name: /new node/ }).getAttribute('aria-checked')).toBe('true');
  });

  it('closes, then runs the item picked', () => {
    const pick = vi.fn();
    const onClose = vi.fn();
    render(<ContextMenu x={10} y={10} label="Actions" items={items(pick)} onClose={onClose} />);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Remove column' }));
    expect(onClose).toHaveBeenCalled();
    expect(pick).toHaveBeenCalledWith('remove');
  });

  it('closes on Escape or a click outside, giving focus back', () => {
    const before = document.createElement('button');
    document.body.append(before);
    before.focus();
    const onClose = vi.fn();
    render(<ContextMenu x={10} y={10} label="Actions" items={items()} onClose={onClose} />);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(before);
    fireEvent.pointerDown(document.body);
    expect(onClose).toHaveBeenCalledTimes(2);
    before.remove();
  });

  it('opens a submenu with the right arrow and goes back with the left', () => {
    const pick = vi.fn();
    const withSub = [
      { label: 'Trim', onSelect: () => pick('trim') },
      { label: 'Text', onSelect: () => undefined, items: [{ label: 'UPPER CASE', onSelect: () => pick('upper') }, { label: 'lower case', onSelect: () => pick('lower') }] },
    ];
    render(<ContextMenu x={10} y={10} label="Actions" items={withSub} onClose={() => undefined} />);
    const root = screen.getByRole('menu', { name: 'Actions' });
    fireEvent.keyDown(root, { key: 'ArrowDown' });
    const text = screen.getByRole('menuitem', { name: 'Text' });
    expect(document.activeElement).toBe(text);
    fireEvent.keyDown(text, { key: 'ArrowRight' });
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'UPPER CASE' }));
    // The arrow keys stay inside the submenu.
    fireEvent.keyDown(screen.getByRole('menu', { name: 'Text' }), { key: 'ArrowDown' });
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'lower case' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'lower case' }));
    expect(pick).toHaveBeenCalledWith('lower');
  });

  it('a submenu goes back to its item with the left arrow', () => {
    const withSub = [{ label: 'Text', onSelect: () => undefined, items: [{ label: 'UPPER CASE', onSelect: () => undefined }] }];
    render(<ContextMenu x={10} y={10} label="Actions" items={withSub} onClose={() => undefined} />);
    const text = screen.getByRole('menuitem', { name: 'Text' });
    fireEvent.keyDown(text, { key: 'ArrowRight' });
    fireEvent.keyDown(screen.getByRole('menu', { name: 'Text' }), { key: 'ArrowLeft' });
    expect(screen.queryByRole('menu', { name: 'Text' })).toBeNull();
    expect(document.activeElement).toBe(text);
  });
});
