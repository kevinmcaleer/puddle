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
  /** The project notes panel is open in the right-hand dock, in place of the inspector. */
  notesOpen: boolean;
  /** The Query node whose designer fills the canvas area, in place of the canvas. */
  designerNodeId: string | null;
  /** The right-hand dock (inspector or notes) is showing. */
  inspectorOpen: boolean;
  /** The results dock is showing its table. */
  resultsOpen: boolean;
  /** The keyboard shortcuts dialog is open. */
  shortcutsOpen: boolean;
  /** The inspector's Add step menu should open with its search focused (the shortcut asked while it may not be showing). */
  addStepPending: boolean;
  /** Wiring from the keyboard (C): the node a wire starts from, until another node is chosen or Escape cancels. */
  connectFrom: string | null;
  select: (id: string | null) => void;
  toggleSelected: (id: string) => void;
  selectStep: (id: string | null) => void;
  setSelectedColumns: (cols: string[]) => void;
  notify: (notice: SessionState['notice']) => void;
  setNotesOpen: (open: boolean) => void;
  /** Open a Query node's designer (selecting the node, so the inspector shows it too), or close it with null. */
  openDesigner: (nodeId: string | null) => void;
  setInspectorOpen: (open: boolean) => void;
  setResultsOpen: (open: boolean) => void;
  setShortcutsOpen: (open: boolean) => void;
  requestAddStep: () => void;
  clearAddStep: () => void;
  setConnectFrom: (id: string | null) => void;
}

export const useSession = create<SessionState>((set) => ({
  selectedNodeId: null,
  selectedNodeIds: [],
  selectedStepId: null,
  selectedColumns: [],
  notice: null,
  notesOpen: false,
  designerNodeId: null,
  inspectorOpen: true,
  resultsOpen: true,
  shortcutsOpen: false,
  addStepPending: false,
  connectFrom: null,
  // Picking a node shows it in the inspector, so the notes panel makes way.
  select: (id) => set((s) => ({ selectedNodeId: id, selectedNodeIds: id ? [id] : [], selectedStepId: null, notesOpen: id ? false : s.notesOpen })),
  toggleSelected: (id) =>
    set((s) => {
      const has = s.selectedNodeIds.includes(id);
      const ids = has ? s.selectedNodeIds.filter((x) => x !== id) : [...s.selectedNodeIds, id];
      return { selectedNodeIds: ids, selectedNodeId: has ? (ids.at(-1) ?? null) : id, selectedStepId: null };
    }),
  selectStep: (selectedStepId) => set({ selectedStepId }),
  setSelectedColumns: (selectedColumns) => set({ selectedColumns }),
  notify: (notice) => set({ notice }),
  // Opening the notes shows the dock they live in.
  setNotesOpen: (notesOpen) => set((s) => ({ notesOpen, inspectorOpen: notesOpen || s.inspectorOpen })),
  openDesigner: (designerNodeId) =>
    set((s) => (designerNodeId ? { designerNodeId, selectedNodeId: designerNodeId, selectedNodeIds: [designerNodeId], selectedStepId: null, notesOpen: false } : { designerNodeId: null, selectedNodeIds: s.selectedNodeIds })),
  setInspectorOpen: (inspectorOpen) => set({ inspectorOpen }),
  setResultsOpen: (resultsOpen) => set({ resultsOpen }),
  setShortcutsOpen: (shortcutsOpen) => set({ shortcutsOpen }),
  requestAddStep: () => set({ addStepPending: true, inspectorOpen: true, notesOpen: false }),
  clearAddStep: () => set({ addStepPending: false }),
  setConnectFrom: (connectFrom) => set({ connectFrom }),
}));
