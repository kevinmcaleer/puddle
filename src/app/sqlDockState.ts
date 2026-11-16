import { create } from 'zustand';
import { useProject } from '../model';

/** The SQL dock (see SqlDock.tsx): the element editors move into, and how many are in it. */
export const useSqlDock = create<{ slot: HTMLElement | null; owners: number }>(() => ({ slot: null, owners: 0 }));

/** True while this node's SQL is shown in the dock: its rows are the ones shown, and the results are open. */
export function useSqlDocked(nodeId: string): boolean {
  const slot = useSqlDock((s) => s.slot);
  const viewed = useProject().view.viewedNodeId === nodeId;
  return !!slot && viewed;
}
