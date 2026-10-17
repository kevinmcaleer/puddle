import { useEffect, useRef, type RefObject } from 'react';
import { UNDO_ATTRIBUTE } from '../ui/undo';
import { isMac, shortcutFor, type GlobalShortcutId } from './shortcuts';

/** A text field, select or editable element: keys typed there are text, never shortcuts. */
export const isTyping = (t: EventTarget | null) =>
  t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || !!t.closest('[contenteditable=""], [contenteditable="true"]'));

/** A field with nothing of its own to undo: a choice (select, switch, checkbox), or a text field marked as holding no uncommitted typing. */
const NO_TEXT = /^(checkbox|radio|range|color|file|button|submit|reset)$/;
export const passesUndo = (t: EventTarget | null) =>
  t instanceof HTMLElement && (t.tagName === 'SELECT' || (t instanceof HTMLInputElement && NO_TEXT.test(t.type)) || t.hasAttribute(UNDO_ATTRIBUTE));
const UNDO = new Set<GlobalShortcutId>(['undo', 'redo']);

const ARROWS = new Set<GlobalShortcutId>(['select-upstream', 'select-downstream', 'select-above', 'select-below']);
/** Enter and Escape act on the canvas only from a node, the canvas itself or the page: on a button or a wire they keep their own meaning. */
const ON_NODE = new Set<GlobalShortcutId>(['open-node', 'cancel']);

/**
 * Arrow keys move the canvas selection only from the canvas or the page itself; elsewhere (the results grid, the
 * step list, the results dock's resize handle, a menu, the query designer) they keep their own meaning.
 */
const onCanvas = (t: EventTarget | null) =>
  t === document.body ||
  t === document.documentElement ||
  (t instanceof Element && !!t.closest('main[aria-label="Canvas"]') && !t.closest('[role="menu"], .puddle-qd'));

const onNode = (t: EventTarget | null) =>
  t === document.body || t === document.documentElement || (t instanceof Element && (t.matches('main[aria-label="Canvas"], .react-flow__node, .react-flow__pane') || t.classList.contains('react-flow')));

/**
 * Run the registry's shortcuts, anywhere outside a text field and while no dialog is open (undo and redo also from a
 * field with nothing of its own to undo, see `passesUndo`). The listener runs in the
 * capture phase so a handled key (an arrow on a focused canvas node, say) doesn't also nudge the node. An action
 * that returns false had nothing to do, and the key goes on to whatever else wants it (Escape closing a menu, say).
 */
export function useShortcuts(actions: Record<GlobalShortcutId, () => void | boolean>, onPaste: (text: string) => void) {
  const latest = useRef({ actions, onPaste });
  useEffect(() => {
    latest.current = { actions, onPaste };
  });
  useEffect(() => {
    const mac = isMac();
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.isComposing || document.querySelector('dialog[open]')) return;
      const s = shortcutFor(e, mac);
      if (!s) return;
      const id = s.id as GlobalShortcutId;
      // Undo and redo reach the project from a field that has no typing of its own to undo; other keys there are text.
      if (isTyping(e.target) && !(UNDO.has(id) && passesUndo(e.target))) return;
      // Holding undo or redo steps on through the history, as holding an arrow moves on.
      if (ARROWS.has(id) ? !onCanvas(e.target) : e.repeat && !UNDO.has(id)) return;
      if (ON_NODE.has(id) && !onNode(e.target)) return;
      if (latest.current.actions[id]() === false) return;
      e.preventDefault();
      e.stopPropagation();
    };
    const paste = (e: ClipboardEvent) => {
      if (isTyping(e.target) || document.querySelector('dialog[open]')) return;
      const text = e.clipboardData?.getData('text/plain');
      if (!text) return;
      e.preventDefault();
      latest.current.onPaste(text);
    };
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('paste', paste);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('paste', paste);
    };
  }, []);
}

/**
 * Undo and redo keys for a history of its own (the home screen's projects, the templates library), with the same
 * rules as the editor's. `within` limits them to keys pressed inside an element, such as a dialog (whose own keys the
 * editor's shortcuts leave alone).
 */
export function useUndoKeys(undo: () => void, redo: () => void, within?: RefObject<HTMLElement | null>) {
  const latest = useRef({ undo, redo });
  useEffect(() => {
    latest.current = { undo, redo };
  });
  useEffect(() => {
    const mac = isMac();
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.isComposing) return;
      // Inside a dialog, anywhere in that dialog, or the page when focus has left it (a button just disabled).
      const scope = within?.current?.closest('dialog') ?? within?.current;
      const inScope = !!scope?.isConnected && (e.target === document.body || (e.target instanceof Node && scope.contains(e.target)));
      if (within ? !inScope : document.querySelector('dialog[open]')) return;
      const id = shortcutFor(e, mac)?.id;
      if ((id !== 'undo' && id !== 'redo') || (isTyping(e.target) && !passesUndo(e.target))) return;
      latest.current[id]();
      e.preventDefault();
      e.stopPropagation();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [within]);
}
