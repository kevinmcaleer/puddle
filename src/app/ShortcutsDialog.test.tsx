// @vitest-environment jsdom
import { act, cleanup, render, renderHook, screen } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { useSession } from './session';
import { SHORTCUTS, type GlobalShortcutId, type Shortcut } from './shortcuts';
import { ShortcutsDialog } from './ShortcutsDialog';
import { useShortcuts } from './useShortcuts';

beforeAll(() => {
  // jsdom has <dialog> but not its modal methods.
  HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) {
    this.removeAttribute('open');
  };
});

afterEach(() => {
  cleanup();
  useSession.setState({ shortcutsOpen: false });
});

describe('the shortcuts dialog', () => {
  it('lists exactly the registry, by area, in order', () => {
    useSession.setState({ shortcutsOpen: true });
    render(<ShortcutsDialog />);
    const listed = [...screen.getByTestId('shortcuts-list').querySelectorAll('[data-shortcut]')].map((el) => el.getAttribute('data-shortcut'));
    const areas = ['General', 'Canvas', 'Results', 'Steps'];
    const expected = areas.flatMap((a) => (SHORTCUTS as readonly Shortcut[]).filter((s) => s.area === a).map((s) => s.id));
    expect(listed).toEqual(expected);
    expect(listed).toHaveLength(SHORTCUTS.length);
  });

  it('prints each key in mono', () => {
    useSession.setState({ shortcutsOpen: true });
    render(<ShortcutsDialog />);
    const row = screen.getByText('Auto layout').nextElementSibling!;
    const keys = [...row.querySelectorAll('kbd')];
    expect(keys.map((k) => k.textContent)).toEqual(['L']);
    expect(keys[0]!.className).toContain('font-mono');
  });

  it('renders nothing while closed', () => {
    render(<ShortcutsDialog />);
    expect(screen.queryByTestId('shortcuts-list')).toBeNull();
  });
});

describe('useShortcuts', () => {
  const setup = () => {
    const actions = Object.fromEntries((SHORTCUTS as readonly Shortcut[]).filter((s) => !s.handledBy).map((s) => [s.id, vi.fn()])) as unknown as Record<GlobalShortcutId, ReturnType<typeof vi.fn>>;
    const paste = vi.fn();
    renderHook(() => useShortcuts(actions, paste));
    return { actions, paste };
  };
  const key = (target: EventTarget, init: KeyboardEventInit) => {
    const e = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
    act(() => void target.dispatchEvent(e));
    return e;
  };

  it('runs a shortcut pressed outside a text field', () => {
    const { actions } = setup();
    const e = key(document.body, { key: 'l' });
    expect(actions.layout).toHaveBeenCalledOnce();
    expect(e.defaultPrevented).toBe(true);
  });

  it('never runs while typing in a field', () => {
    const { actions } = setup();
    for (const tag of ['input', 'textarea', 'select']) {
      const field = document.body.appendChild(document.createElement(tag));
      key(field, { key: 'l' });
      key(field, { key: 'z', ctrlKey: true });
      field.remove();
    }
    const editable = document.body.appendChild(document.createElement('div'));
    editable.setAttribute('contenteditable', 'true');
    key(editable, { key: 'l' });
    editable.remove();
    expect(actions.layout).not.toHaveBeenCalled();
    expect(actions.undo).not.toHaveBeenCalled();
  });

  it('never runs while a dialog is open', () => {
    const { actions } = setup();
    const dialog = document.body.appendChild(document.createElement('dialog'));
    dialog.setAttribute('open', '');
    key(document.body, { key: 'l' });
    dialog.remove();
    expect(actions.layout).not.toHaveBeenCalled();
  });

  it('moves the canvas selection with arrows only from the canvas or the page', () => {
    const { actions } = setup();
    const canvas = document.body.appendChild(document.createElement('main'));
    canvas.setAttribute('aria-label', 'Canvas');
    const nodeEl = canvas.appendChild(document.createElement('div'));
    const elsewhere = document.body.appendChild(document.createElement('div'));
    key(nodeEl, { key: 'ArrowRight' });
    key(document.body, { key: 'ArrowLeft' });
    key(elsewhere, { key: 'ArrowRight' });
    expect(actions['select-downstream']).toHaveBeenCalledOnce();
    expect(actions['select-upstream']).toHaveBeenCalledOnce();
    canvas.remove();
    elsewhere.remove();
  });

  it('leaves arrows to a menu or the query designer on the canvas', () => {
    const { actions } = setup();
    const canvas = document.body.appendChild(document.createElement('main'));
    canvas.setAttribute('aria-label', 'Canvas');
    const menu = canvas.appendChild(document.createElement('div'));
    menu.setAttribute('role', 'menu');
    const item = menu.appendChild(document.createElement('button'));
    const designer = canvas.appendChild(document.createElement('div'));
    designer.className = 'puddle-qd';
    const head = designer.appendChild(document.createElement('div'));
    expect(key(item, { key: 'ArrowDown' }).defaultPrevented).toBe(false);
    expect(key(head, { key: 'ArrowLeft' }).defaultPrevented).toBe(false);
    expect(actions['select-below']).not.toHaveBeenCalled();
    expect(actions['select-upstream']).not.toHaveBeenCalled();
    canvas.remove();
  });

  it('opens a node with Enter only from a node, the canvas or the page, never from a button', () => {
    const { actions } = setup();
    const canvas = document.body.appendChild(document.createElement('main'));
    canvas.setAttribute('aria-label', 'Canvas');
    const nodeEl = canvas.appendChild(document.createElement('div'));
    nodeEl.className = 'react-flow__node';
    const button = canvas.appendChild(document.createElement('button'));
    key(button, { key: 'Enter' });
    expect(actions['open-node']).not.toHaveBeenCalled();
    key(nodeEl, { key: 'Enter' });
    key(canvas, { key: 'Enter' });
    expect(actions['open-node']).toHaveBeenCalledTimes(2);
    canvas.remove();
  });

  it('lets Escape through when there was no wiring to cancel', () => {
    const { actions } = setup();
    actions.cancel.mockReturnValue(false);
    expect(key(document.body, { key: 'Escape' }).defaultPrevented).toBe(false);
    actions.cancel.mockReturnValue(true);
    expect(key(document.body, { key: 'Escape' }).defaultPrevented).toBe(true);
    expect(actions.cancel).toHaveBeenCalledTimes(2);
  });

  it('ignores a held-down letter repeating', () => {
    const { actions } = setup();
    key(document.body, { key: 't', repeat: true });
    expect(actions['add-transform']).not.toHaveBeenCalled();
  });
});
