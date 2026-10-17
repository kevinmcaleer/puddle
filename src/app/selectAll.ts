import { isTyping } from './useShortcuts';

/** Text the user may select and copy: an answer, a preview, a code sample. Everything else is app chrome. */
export const SELECTABLE = '.ui-selectable, pre, code';

/** Is this Ctrl+A (Cmd+A on macOS, either is fine) with no other modifier? */
const isSelectAll = (e: KeyboardEvent) => e.key.toLowerCase() === 'a' && (e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey;

/**
 * Select all, as in an app rather than a web page. In a text field it selects the field's text, as ever, and a widget
 * that handles the key itself (the results grid selecting every cell) is left to it. Elsewhere it never selects the
 * whole page: with the selection inside selectable text (a console answer, the notes preview), it selects just that
 * text, and otherwise it does nothing.
 */
export function onSelectAll(e: KeyboardEvent) {
  if (e.defaultPrevented || !isSelectAll(e) || isTyping(e.target)) return;
  e.preventDefault();
  const selection = window.getSelection();
  const anchor = selection?.anchorNode;
  const region = (anchor instanceof Element ? anchor : anchor?.parentElement)?.closest(SELECTABLE);
  if (selection && region) selection.selectAllChildren(region);
}

/** Install `onSelectAll` for the whole app; returns a function that removes it. */
export function blockPageSelectAll() {
  window.addEventListener('keydown', onSelectAll);
  return () => window.removeEventListener('keydown', onSelectAll);
}
