import { create } from 'zustand';
import { useRuleStore } from './rules';
import { invalidateCaches } from './status';

/** Bumped by Run again, so the flow is evaluated afresh even though the project hasn't changed. */
export const useRerun = create<{ tick: number }>(() => ({ tick: 0 }));

/** After Stop: forget what was stopped (statuses, counts, rule results) and run everything again. */
export function runAgain() {
  invalidateCaches();
  useRuleStore.setState({ nodes: {} });
  useRerun.setState((s) => ({ tick: s.tick + 1 }));
}
