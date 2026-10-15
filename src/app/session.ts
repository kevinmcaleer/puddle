import { create } from 'zustand';

/** Per-tab UI state that isn't part of the saved project and isn't undoable. */
interface SessionState {
  selectedNodeId: string | null;
  /** Column names selected in the results table; quick fixes and step defaults act on these. */
  selectedColumns: string[];
  /** A short message shown over the canvas, e.g. why a wire was refused. */
  notice: { tone: 'info' | 'warn' | 'fail'; text: string } | null;
  select: (id: string | null) => void;
  setSelectedColumns: (cols: string[]) => void;
  notify: (notice: SessionState['notice']) => void;
}

export const useSession = create<SessionState>((set) => ({
  selectedNodeId: null,
  selectedColumns: [],
  notice: null,
  select: (selectedNodeId) => set({ selectedNodeId }),
  setSelectedColumns: (selectedColumns) => set({ selectedColumns }),
  notify: (notice) => set({ notice }),
}));
