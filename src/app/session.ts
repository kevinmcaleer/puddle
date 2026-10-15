import { create } from 'zustand';

/** Per-tab UI state that isn't part of the saved project and isn't undoable. */
interface SessionState {
  /** The node the inspector shows: the last one clicked. */
  selectedNodeId: string | null;
  /** Every selected node (Shift or Cmd/Ctrl+click adds to it), e.g. for grouping. */
  selectedNodeIds: string[];
  /** The step selected in the inspector's applied-steps list. */
  selectedStepId: string | null;
  /** Column names selected in the results table; quick fixes and step defaults act on these. */
  selectedColumns: string[];
  /** A short message shown over the canvas, e.g. why a wire was refused. */
  notice: { tone: 'info' | 'warn' | 'fail'; text: string } | null;
  select: (id: string | null) => void;
  toggleSelected: (id: string) => void;
  selectStep: (id: string | null) => void;
  setSelectedColumns: (cols: string[]) => void;
  notify: (notice: SessionState['notice']) => void;
}

export const useSession = create<SessionState>((set) => ({
  selectedNodeId: null,
  selectedNodeIds: [],
  selectedStepId: null,
  selectedColumns: [],
  notice: null,
  select: (id) => set({ selectedNodeId: id, selectedNodeIds: id ? [id] : [], selectedStepId: null }),
  toggleSelected: (id) =>
    set((s) => {
      const has = s.selectedNodeIds.includes(id);
      const ids = has ? s.selectedNodeIds.filter((x) => x !== id) : [...s.selectedNodeIds, id];
      return { selectedNodeIds: ids, selectedNodeId: has ? (ids.at(-1) ?? null) : id, selectedStepId: null };
    }),
  selectStep: (selectedStepId) => set({ selectedStepId }),
  setSelectedColumns: (selectedColumns) => set({ selectedColumns }),
  notify: (notice) => set({ notice }),
}));
