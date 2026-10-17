import { useEffect, useRef } from 'react';
import { isMac, shortcutFor, type GlobalShortcutId } from './shortcuts';

/** A text field, select or editable element: keys typed there are text, never shortcuts. */
export const isTyping = (t: EventTarget | null) =>
  t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || !!t.closest('[contenteditable=""], [contenteditable="true"]'));

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
 * Run the registry's shortcuts, anywhere outside a text field and while no dialog is open. The listener runs in the
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
      if (e.defaultPrevented || e.isComposing || isTyping(e.target) || document.querySelector('dialog[open]')) return;
      const s = shortcutFor(e, mac);
      if (!s) return;
      const id = s.id as GlobalShortcutId;
      if (ARROWS.has(id) ? !onCanvas(e.target) : e.repeat) return;
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
