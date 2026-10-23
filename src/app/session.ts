import { create } from 'zustand';

export type InspectorTab = 'node' | 'project' | 'notes';

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
  /** Which of the inspector's tabs shows: the selected node, the project (settings, display) or the project notes. */
  inspectorTab: InspectorTab;
  /** The Query node whose designer fills the canvas area, in place of the canvas. */
  designerNodeId: string | null;
  /** The Schema view (DBML and its diagram) fills the canvas area, in place of the canvas. */
  schemaOpen: boolean;
  /** The relationships view fills the canvas area, in place of the canvas. */
  relationshipsOpen: boolean;
  /** The right-hand dock (the inspector) is showing. */
  inspectorOpen: boolean;
  /** The database browser pane shows this connection in the inspector's place; null shows the inspector. */
  browsingConnectionId: string | null;
  /** The results dock is showing its table. */
  resultsOpen: boolean;
  /** The scratch SQL console is open under the results table. */
  consoleOpen: boolean;
  /** The keyboard shortcuts dialog is open. */
  shortcutsOpen: boolean;
  /** The inspector's Add step menu should open with its search focused (the shortcut asked while it may not be showing). */
  addStepPending: boolean;
  /** The toolbar's Add menu should open with its search focused (a shortcut asked for a step after the selected node). */
  addMenuPending: boolean;
  /** Wiring from the keyboard (C): the node a wire starts from, until another node is chosen or Escape cancels. */
  connectFrom: string | null;
  /** The menu a click on a node's output connector opened: the node, and where on screen the menu sits. */
  connectorMenu: { nodeId: string; x: number; y: number } | null;
  select: (id: string | null) => void;
  toggleSelected: (id: string) => void;
  selectStep: (id: string | null) => void;
  setSelectedColumns: (cols: string[]) => void;
  notify: (notice: SessionState['notice']) => void;
  /** Show a tab of the inspector, opening the dock if it was hidden. */
  setInspectorTab: (tab: InspectorTab) => void;
  /** Open a Query node's designer (selecting the node, so the inspector shows it too), or close it with null. */
  openDesigner: (nodeId: string | null) => void;
  /** Show the Schema view in place of the canvas (closing any query designer), or go back to the canvas. */
  setSchemaOpen: (open: boolean) => void;
  /** Show the relationships view in place of the canvas (closing any query designer), or go back to the canvas. */
  setRelationshipsOpen: (open: boolean) => void;
  setInspectorOpen: (open: boolean) => void;
  /** Show the database browser for a connection in the inspector's place (opening the dock), or close it with null. */
  browseConnection: (connectionId: string | null) => void;
  setResultsOpen: (open: boolean) => void;
  /** Show or hide the console; showing it also shows the results dock it sits in. */
  setConsoleOpen: (open: boolean) => void;
  setShortcutsOpen: (open: boolean) => void;
  requestAddStep: () => void;
  clearAddStep: () => void;
  requestAddMenu: () => void;
  clearAddMenu: () => void;
  setConnectFrom: (id: string | null) => void;
  /** Open the connector menu for a node (selecting it, since what it adds goes after the selection), or close it with null. */
  openConnectorMenu: (menu: SessionState['connectorMenu']) => void;
}

export const useSession = create<SessionState>((set) => ({
  selectedNodeId: null,
  selectedNodeIds: [],
  selectedStepId: null,
  selectedColumns: [],
  notice: null,
  inspectorTab: 'project',
  designerNodeId: null,
  schemaOpen: false,
  relationshipsOpen: false,
  inspectorOpen: true,
  browsingConnectionId: null,
  resultsOpen: true,
  consoleOpen: false,
  shortcutsOpen: false,
  addStepPending: false,
  addMenuPending: false,
  connectFrom: null,
  connectorMenu: null,
  // Picking a node shows it in the inspector's Node tab.
  select: (id) => set((s) => ({ selectedNodeId: id, selectedNodeIds: id ? [id] : [], selectedStepId: null, inspectorTab: id ? 'node' : s.inspectorTab })),
  toggleSelected: (id) =>
    set((s) => {
      const has = s.selectedNodeIds.includes(id);
      const ids = has ? s.selectedNodeIds.filter((x) => x !== id) : [...s.selectedNodeIds, id];
      return { selectedNodeIds: ids, selectedNodeId: has ? (ids.at(-1) ?? null) : id, selectedStepId: null };
    }),
  selectStep: (selectedStepId) => set({ selectedStepId }),
  setSelectedColumns: (selectedColumns) => set({ selectedColumns }),
  notify: (notice) => set({ notice }),
  setInspectorTab: (inspectorTab) => set({ inspectorTab, inspectorOpen: true, browsingConnectionId: null }),
  openDesigner: (designerNodeId) =>
    set((s) => (designerNodeId ? { designerNodeId, schemaOpen: false, relationshipsOpen: false, selectedNodeId: designerNodeId, selectedNodeIds: [designerNodeId], selectedStepId: null, inspectorTab: 'node' } : { designerNodeId: null, selectedNodeIds: s.selectedNodeIds })),
  setSchemaOpen: (schemaOpen) => set(schemaOpen ? { schemaOpen, relationshipsOpen: false, designerNodeId: null } : { schemaOpen }),
  setRelationshipsOpen: (relationshipsOpen) => set(relationshipsOpen ? { relationshipsOpen, schemaOpen: false, designerNodeId: null } : { relationshipsOpen }),
  setInspectorOpen: (inspectorOpen) => set({ inspectorOpen }),
  browseConnection: (browsingConnectionId) => set(browsingConnectionId ? { browsingConnectionId, inspectorOpen: true } : { browsingConnectionId }),
  setResultsOpen: (resultsOpen) => set({ resultsOpen }),
  setConsoleOpen: (consoleOpen) => set(consoleOpen ? { consoleOpen, resultsOpen: true } : { consoleOpen }),
  setShortcutsOpen: (shortcutsOpen) => set({ shortcutsOpen }),
  requestAddStep: () => set({ addStepPending: true, inspectorOpen: true, inspectorTab: 'node', browsingConnectionId: null }),
  clearAddStep: () => set({ addStepPending: false }),
  requestAddMenu: () => set({ addMenuPending: true }),
  clearAddMenu: () => set({ addMenuPending: false }),
  setConnectFrom: (connectFrom) => set({ connectFrom }),
  openConnectorMenu: (connectorMenu) => set(connectorMenu ? { connectorMenu, selectedNodeId: connectorMenu.nodeId, selectedNodeIds: [connectorMenu.nodeId], selectedStepId: null, inspectorTab: 'node' } : { connectorMenu }),
}));
