import { describe, expect, it } from 'vitest';
import { comboKeys, formatCombo, isMac, matches, shortcut, shortcutFor, SHORTCUT_AREAS, SHORTCUTS, withShortcut, type Shortcut } from './shortcuts';

const press = (key: string, mods: Partial<Record<'ctrlKey' | 'metaKey' | 'shiftKey' | 'altKey', boolean>> = {}) => ({ key, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, ...mods });
const all = SHORTCUTS as readonly Shortcut[];

describe('the shortcut registry', () => {
  it('has unique ids, a known area and at least one key for each shortcut', () => {
    expect(new Set(all.map((s) => s.id)).size).toBe(all.length);
    for (const s of all) {
      expect(SHORTCUT_AREAS).toContain(s.area);
      expect(s.keys.length).toBeGreaterThan(0);
    }
  });

  it('never gives two app-wide shortcuts the same keys', () => {
    const seen = new Map<string, string>();
    for (const s of all.filter((x) => !x.handledBy))
      for (const c of s.keys) {
        const key = formatCombo(c, false);
        expect(seen.get(key), `${key} is ${seen.get(key)} and ${s.id}`).toBeUndefined();
        seen.set(key, s.id);
      }
  });

  it('covers everything the issue lists', () => {
    const ids = all.map((s) => s.id);
    for (const id of ['add-source', 'add-transform', 'add-output', 'layout', 'view', 'export', 'export-all', 'group', 'toggle-results', 'toggle-inspector', 'focus-canvas', 'add-step', 'help', 'select-upstream', 'select-downstream', 'select-above', 'select-below'])
      expect(ids).toContain(id);
  });

  it('labels in sentence case', () => {
    for (const s of all) expect(s.label[0]).toBe(s.label[0]!.toUpperCase());
  });
});

describe('matching a key press', () => {
  it('uses Ctrl off macOS and Cmd on macOS', () => {
    const undo = shortcut('undo').keys[0]!;
    expect(matches(press('z', { ctrlKey: true }), undo, false)).toBe(true);
    expect(matches(press('z', { metaKey: true }), undo, false)).toBe(false);
    expect(matches(press('z', { metaKey: true }), undo, true)).toBe(true);
    expect(matches(press('z', { ctrlKey: true }), undo, true)).toBe(false);
  });

  it('tells plain, Shift and modified letters apart, whatever their case', () => {
    expect(shortcutFor(press('e'), false)?.id).toBe('export');
    expect(shortcutFor(press('E', { shiftKey: true }), false)?.id).toBe('export-all');
    expect(shortcutFor(press('Z', { ctrlKey: true, shiftKey: true }), false)?.id).toBe('redo');
    expect(shortcutFor(press('y', { ctrlKey: true }), false)?.id).toBe('redo');
    expect(shortcutFor(press('t', { ctrlKey: true }), false)).toBeUndefined();
    expect(shortcutFor(press('t', { altKey: true }), false)).toBeUndefined();
  });

  it('takes ? with or without Shift, since keyboards differ', () => {
    expect(shortcutFor(press('?', { shiftKey: true }), false)?.id).toBe('help');
    expect(shortcutFor(press('?'), false)?.id).toBe('help');
  });

  it('leaves keys handled elsewhere to their own handlers', () => {
    expect(shortcutFor(press('Delete'), false)).toBeUndefined();
    expect(shortcutFor(press('v', { ctrlKey: true }), false)).toBeUndefined();
    expect(shortcutFor(press('ArrowUp', { altKey: true }), false)).toBeUndefined();
    expect(shortcutFor(press('ArrowUp'), false)?.id).toBe('select-above');
  });

  it('pins with P alone, not with Ctrl, Cmd or Alt', () => {
    expect(shortcutFor(press('p'), false)?.id).toBe('pin');
    expect(shortcutFor(press('P'), false)?.id).toBe('pin');
    expect(shortcutFor(press('p'), true)?.id).toBe('pin');
    expect(shortcutFor(press('p', { ctrlKey: true }), false)).toBeUndefined();
    expect(shortcutFor(press('p', { metaKey: true }), true)).toBeUndefined();
    expect(shortcutFor(press('p', { altKey: true }), false)).toBeUndefined();
  });
});

describe('showing a shortcut', () => {
  it('prints keys as the keyboard does', () => {
    expect(comboKeys(shortcut('redo').keys[0]!, false)).toEqual(['Ctrl', 'Shift', 'Z']);
    expect(comboKeys(shortcut('redo').keys[0]!, true)).toEqual(['⌘', '⇧', 'Z']);
    expect(formatCombo(shortcut('redo').keys[0]!, false)).toBe('Ctrl+Shift+Z');
    expect(formatCombo(shortcut('redo').keys[0]!, true)).toBe('⌘⇧Z');
    expect(formatCombo(shortcut('select-upstream').keys[0]!, false)).toBe('←');
  });

  it('adds the shortcut to a tooltip', () => {
    expect(withShortcut('Auto layout', 'layout', false)).toBe('Auto layout (L)');
    expect(withShortcut('Undo', 'undo', true)).toBe('Undo (⌘Z)');
  });

  it('knows a Mac from its platform', () => {
    expect(isMac('MacIntel')).toBe(true);
    expect(isMac('Win32')).toBe(false);
    expect(isMac('Linux x86_64')).toBe(false);
  });
});
