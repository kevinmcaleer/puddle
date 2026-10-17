// Undo and redo for what is kept outside any one project: the projects on the home screen and the templates library.
// An open project has its own history of snapshots (src/model/history.ts); these are stored records, so each
// operation says how to undo and redo itself.
import { create, type StoreApi, type UseBoundStore } from 'zustand';

export interface Operation {
  /** What was done, in sentence case, for the Undo button: "Delete Sales". */
  label: string;
  undo: () => Promise<void>;
  redo: () => Promise<void>;
}

export interface OperationHistory {
  past: Operation[];
  future: Operation[];
  /** An undo or redo is running; another waits for it. */
  busy: boolean;
}

export interface Operations {
  use: UseBoundStore<StoreApi<OperationHistory>>;
  /** Record an operation just done, as one undo step. */
  record: (op: Operation) => void;
  /** Undo the last operation. Resolves false when there was nothing to undo. */
  undo: () => Promise<boolean>;
  redo: () => Promise<boolean>;
  /** Forget every step (tests). */
  clear: () => void;
}

export const OPERATIONS_LIMIT = 50;

export function createOperations(limit = OPERATIONS_LIMIT): Operations {
  const use = create<OperationHistory>(() => ({ past: [], future: [], busy: false }));
  let queue: Promise<unknown> = Promise.resolve();
  // One at a time, in order: holding Ctrl+Z undoes step after step, never two at once.
  const step = (from: 'past' | 'future') => {
    const run = queue.then(async () => {
      const s = use.getState();
      const op = s[from].at(-1);
      if (!op) return false;
      use.setState({ busy: true });
      try {
        await (from === 'past' ? op.undo() : op.redo());
      } catch (e) {
        // An operation that can't be undone any more (its record changed meanwhile) leaves the history.
        use.setState((h) => ({ [from]: h[from].slice(0, -1), busy: false }));
        throw e;
      }
      use.setState((h) =>
        from === 'past' ? { past: h.past.slice(0, -1), future: [...h.future, op], busy: false } : { future: h.future.slice(0, -1), past: [...h.past, op], busy: false },
      );
      return true;
    });
    queue = run.catch(() => undefined);
    return run;
  };
  return {
    use,
    record: (op) => use.setState((h) => ({ past: [...h.past, op].slice(-limit), future: [] })),
    undo: () => step('past'),
    redo: () => step('future'),
    clear: () => use.setState({ past: [], future: [], busy: false }),
  };
}
