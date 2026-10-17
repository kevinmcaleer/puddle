import type { RefObject } from 'react';
import type { Operations } from '../persistence/operations';
import { announce, Button } from '../ui';
import { withShortcut } from './shortcuts';
import { useUndoKeys } from './useShortcuts';

const lower = (label: string) => label.charAt(0).toLowerCase() + label.slice(1);

/**
 * Undo and redo buttons, and their keys, for a history of stored operations (src/persistence/operations.ts). The
 * buttons name what they would undo or redo, and what was done is announced for screen readers.
 */
export function OperationButtons({ ops, within, onError }: { ops: Operations; within?: RefObject<HTMLElement | null>; onError: (message: string) => void }) {
  const last = ops.use((s) => s.past.at(-1));
  const next = ops.use((s) => s.future.at(-1));
  const busy = ops.use((s) => s.busy);
  const run = (op: typeof last, go: () => Promise<boolean>, done: string) => {
    if (!op) return;
    go().then(
      (ran) => ran && announce(`${done} ${lower(op.label)}`),
      (e: unknown) => onError(`That can’t be undone: ${e instanceof Error ? e.message : String(e)}`),
    );
  };
  const undo = () => run(last, ops.undo, 'Undid');
  const redo = () => run(next, ops.redo, 'Redid');
  useUndoKeys(undo, redo, within);
  return (
    <>
      <Button variant="ghost" icon="undo" iconOnly aria-label="Undo" title={withShortcut(last ? `Undo ${lower(last.label)}` : 'Undo', 'undo')} disabled={!last || busy} onClick={undo} />
      <Button variant="ghost" icon="redo" iconOnly aria-label="Redo" title={withShortcut(next ? `Redo ${lower(next.label)}` : 'Redo', 'redo')} disabled={!next || busy} onClick={redo} />
    </>
  );
}
