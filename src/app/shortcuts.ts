// The one list of keyboard shortcuts. The shortcuts dialog, tooltips and the key handler all read it, so what the
// dialog shows is exactly what the keys do. "Mod" is Cmd on macOS and Ctrl elsewhere.

export interface KeyCombo {
  /** KeyboardEvent.key, compared without case for letters (e.g. "t", "ArrowLeft", "?", "/"). */
  key: string;
  mod?: boolean;
  shift?: boolean;
  alt?: boolean;
  /** For a symbol such as "?", which needs Shift on some keyboards and not others. */
  anyShift?: boolean;
}

export type ShortcutArea = 'General' | 'Canvas' | 'Results' | 'Steps';

export const SHORTCUT_AREAS: ShortcutArea[] = ['General', 'Canvas', 'Results', 'Steps'];

export interface Shortcut {
  id: ShortcutId;
  area: ShortcutArea;
  label: string;
  keys: KeyCombo[];
  /**
   * Where the key is handled when not by the app-wide handler: the browser's paste event, the canvas (React Flow
   * deletes selected nodes), the focused step in the applied-steps list, or the Query designer.
   */
  handledBy?: 'paste' | 'canvas' | 'step list' | 'query designer';
}

const k = (key: string, mods: Omit<KeyCombo, 'key'> = {}): KeyCombo => ({ key, ...mods });

export const SHORTCUTS = [
  { id: 'help', area: 'General', label: 'Show keyboard shortcuts', keys: [k('?', { anyShift: true })] },
  { id: 'undo', area: 'General', label: 'Undo', keys: [k('z', { mod: true })] },
  { id: 'redo', area: 'General', label: 'Redo', keys: [k('z', { mod: true, shift: true }), k('y', { mod: true })] },
  { id: 'paste', area: 'General', label: 'Paste rows as a new source', keys: [k('v', { mod: true })], handledBy: 'paste' },
  { id: 'toggle-inspector', area: 'General', label: 'Show or hide the inspector', keys: [k('i')] },

  { id: 'add-source', area: 'Canvas', label: 'Add source from files', keys: [k('a')] },
  { id: 'add-transform', area: 'Canvas', label: 'Add a step after the selected node (opens the Add menu)', keys: [k('t')] },
  { id: 'add-output', area: 'Canvas', label: 'Add Output after the selected node', keys: [k('o')] },
  { id: 'show-canvas', area: 'Canvas', label: 'Show the canvas', keys: [k('1')] },
  { id: 'show-relationships', area: 'Canvas', label: 'Show the relationships view', keys: [k('2')] },
  { id: 'show-designer', area: 'Canvas', label: 'Show the query designer', keys: [k('3')] },
  { id: 'show-schema', area: 'Canvas', label: 'Show the Schema view', keys: [k('4')] },
  { id: 'layout', area: 'Canvas', label: 'Auto layout', keys: [k('l')] },
  { id: 'group', area: 'Canvas', label: 'Group the selected nodes', keys: [k('g')] },
  { id: 'focus-canvas', area: 'Canvas', label: 'Focus the canvas', keys: [k('f')] },
  { id: 'select-upstream', area: 'Canvas', label: 'Select and view the node feeding this one', keys: [k('ArrowLeft')] },
  { id: 'select-downstream', area: 'Canvas', label: 'Select and view the node this one feeds', keys: [k('ArrowRight')] },
  { id: 'select-above', area: 'Canvas', label: 'Select and view the connected node above', keys: [k('ArrowUp')] },
  { id: 'select-below', area: 'Canvas', label: 'Select and view the connected node below', keys: [k('ArrowDown')] },
  { id: 'open-node', area: 'Canvas', label: 'Open the selected node: a Query in its designer, others in the inspector', keys: [k('Enter')] },
  { id: 'connect', area: 'Canvas', label: 'Wire the selected node into another, or unwire them: C, then Enter on the other node', keys: [k('c')] },
  { id: 'cancel', area: 'Canvas', label: 'Stop wiring', keys: [k('Escape')] },
  { id: 'delete-nodes', area: 'Canvas', label: 'Delete the selected nodes or wire', keys: [k('Delete'), k('Backspace')], handledBy: 'canvas' },
  { id: 'delete-query-join', area: 'Canvas', label: 'Delete the selected join line', keys: [k('Delete'), k('Backspace')], handledBy: 'query designer' },
  { id: 'query-field', area: 'Canvas', label: 'Add the focused field to the grid, or join it to another table', keys: [k('Enter')], handledBy: 'query designer' },
  { id: 'move-query-table', area: 'Canvas', label: 'Move the focused table', keys: [k('ArrowLeft'), k('ArrowRight'), k('ArrowUp'), k('ArrowDown')], handledBy: 'query designer' },
  { id: 'move-query-column', area: 'Canvas', label: 'Move the focused grid column left or right', keys: [k('ArrowLeft', { alt: true }), k('ArrowRight', { alt: true })], handledBy: 'query designer' },

  { id: 'view', area: 'Results', label: 'View the selected node (with the results pinned, move the pin to it)', keys: [k('v')] },
  { id: 'export', area: 'Results', label: 'Export the viewed Output', keys: [k('e')] },
  { id: 'export-all', area: 'Results', label: 'Export all', keys: [k('e', { shift: true })] },
  { id: 'toggle-results', area: 'Results', label: 'Show or hide the results', keys: [k('r')] },
  { id: 'pin', area: 'Results', label: 'Pin or unpin the results', keys: [k('p')] },

  { id: 'add-step', area: 'Steps', label: 'Search the Add step menu', keys: [k('/')] },
  { id: 'move-step', area: 'Steps', label: 'Move the focused step up or down', keys: [k('ArrowUp', { alt: true }), k('ArrowDown', { alt: true })], handledBy: 'step list' },
  { id: 'delete-step', area: 'Steps', label: 'Delete the focused step', keys: [k('Delete'), k('Backspace')], handledBy: 'step list' },
] as const satisfies ReadonlyArray<Omit<Shortcut, 'id'> & { id: string }>;

export type ShortcutId = (typeof SHORTCUTS)[number]['id'];

/** The shortcuts the app-wide key handler runs (the rest are handled where they happen). */
export type GlobalShortcutId = Exclude<ShortcutId, 'paste' | 'delete-nodes' | 'delete-query-join' | 'query-field' | 'move-query-table' | 'move-query-column' | 'move-step' | 'delete-step'>;

export const shortcut = (id: ShortcutId): Shortcut => SHORTCUTS.find((s) => s.id === id)! as Shortcut;

export const isMac = (platform: string = typeof navigator === 'undefined' ? '' : navigator.platform) => /Mac|iPhone|iPad|iPod/.test(platform);

type KeyLike = Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'shiftKey' | 'altKey'>;

/** Does this key press match the combo? Mod is Cmd on macOS and Ctrl elsewhere; the other one must be up. */
export function matches(e: KeyLike, combo: KeyCombo, mac: boolean): boolean {
  const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  if (key !== combo.key) return false;
  const mod = mac ? e.metaKey : e.ctrlKey;
  const other = mac ? e.ctrlKey : e.metaKey;
  if (mod !== !!combo.mod || other) return false;
  if (e.altKey !== !!combo.alt) return false;
  return combo.anyShift || e.shiftKey === !!combo.shift;
}

/** The app-wide shortcut a key press means, if any. */
export function shortcutFor(e: KeyLike, mac: boolean): Shortcut | undefined {
  return (SHORTCUTS as readonly Shortcut[]).find((s) => !s.handledBy && s.keys.some((c) => matches(e, c, mac)));
}

const KEY_NAME: Record<string, string> = { ArrowLeft: '←', ArrowRight: '→', ArrowUp: '↑', ArrowDown: '↓', Delete: 'Delete', Backspace: 'Backspace', Enter: 'Enter', Escape: 'Esc' };

/** The keys of one combo, each as it is printed on the keyboard: ["Ctrl", "Shift", "Z"] or ["⌘", "⇧", "Z"]. */
export function comboKeys(combo: KeyCombo, mac: boolean): string[] {
  const keys: string[] = [];
  if (combo.mod) keys.push(mac ? '⌘' : 'Ctrl');
  if (combo.alt) keys.push(mac ? '⌥' : 'Alt');
  if (combo.shift) keys.push(mac ? '⇧' : 'Shift');
  keys.push(KEY_NAME[combo.key] ?? combo.key.toUpperCase());
  return keys;
}

/** A combo as text: "Ctrl+Shift+Z" or "⌘⇧Z". */
export const formatCombo = (combo: KeyCombo, mac: boolean) => comboKeys(combo, mac).join(mac ? '' : '+');

/** A shortcut's first combo as text, for a tooltip or a menu hint. */
export const shortcutText = (id: ShortcutId, mac = isMac()) => formatCombo(shortcut(id).keys[0]!, mac);

/** A tooltip naming its shortcut: "Auto layout (L)". */
export const withShortcut = (label: string, id: ShortcutId, mac = isMac()) => `${label} (${shortcutText(id, mac)})`;
