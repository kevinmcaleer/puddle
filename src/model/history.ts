/** Undo and redo as a history of immutable snapshots (plan D11). Covers canvas and step edits alike. */
export interface History<T> {
  past: T[];
  present: T;
  future: T[];
}

export const HISTORY_LIMIT = 200;

export const initHistory = <T>(present: T): History<T> => ({ past: [], present, future: [] });

export function pushHistory<T>(h: History<T>, next: T, limit = HISTORY_LIMIT): History<T> {
  if (Object.is(next, h.present)) return h;
  const past = [...h.past, h.present];
  return { past: past.length > limit ? past.slice(past.length - limit) : past, present: next, future: [] };
}

/**
 * Record changes made in place since `before` (typing into a text field, saved as you go without undo steps) as
 * one undoable step: undo returns to `before`.
 */
export function checkpoint<T>(h: History<T>, before: T, limit = HISTORY_LIMIT): History<T> {
  if (Object.is(before, h.present) || Object.is(before, h.past[h.past.length - 1])) return h;
  const past = [...h.past, before];
  return { past: past.length > limit ? past.slice(past.length - limit) : past, present: h.present, future: [] };
}

export function undo<T>(h: History<T>): History<T> {
  if (!h.past.length) return h;
  return { past: h.past.slice(0, -1), present: h.past[h.past.length - 1]!, future: [h.present, ...h.future] };
}

export function redo<T>(h: History<T>): History<T> {
  if (!h.future.length) return h;
  return { past: [...h.past, h.present], present: h.future[0]!, future: h.future.slice(1) };
}

export const canUndo = (h: History<unknown>) => h.past.length > 0;
export const canRedo = (h: History<unknown>) => h.future.length > 0;
