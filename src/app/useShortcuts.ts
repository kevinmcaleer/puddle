import { useEffect, useRef } from 'react';
import { isMac, shortcutFor, type GlobalShortcutId } from './shortcuts';

/** A text field, select or editable element: keys typed there are text, never shortcuts. */
export const isTyping = (t: EventTarget | null) =>
  t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || !!t.closest('[contenteditable=""], [contenteditable="true"]'));

const ARROWS = new Set<GlobalShortcutId>(['select-upstream', 'select-downstream', 'select-above', 'select-below']);

/**
 * Arrow keys move the canvas selection only from the canvas or the page itself; elsewhere (the results grid, the
 * step list, the results dock's resize handle) they keep their own meaning.
 */
const onCanvas = (t: EventTarget | null) => t === document.body || t === document.documentElement || (t instanceof Element && !!t.closest('main[aria-label="Canvas"]'));

/**
 * Run the registry's shortcuts, anywhere outside a text field and while no dialog is open. The listener runs in the
 * capture phase so a handled key (an arrow on a focused canvas node, say) doesn't also nudge the node.
 */
export function useShortcuts(actions: Record<GlobalShortcutId, () => void>, onPaste: (text: string) => void) {
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
      e.preventDefault();
      e.stopPropagation();
      latest.current.actions[id]();
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
