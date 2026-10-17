/**
 * Marks a field that has nothing of its own to undo (a text field with no uncommitted typing), so Ctrl+Z and redo
 * there undo the app's last change instead of the field's text (see src/app/useShortcuts.ts).
 */
export const UNDO_ATTRIBUTE = 'data-app-undo';

/** Props for a text field: pass undo to the app while `committed` (the field holds what is saved). */
export const appUndo = (committed: boolean) => (committed ? { [UNDO_ATTRIBUTE]: '' } : {});
