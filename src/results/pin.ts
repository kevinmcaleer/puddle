// Pinning the results table, and comparing two results side by side. Both are part of the project's view: saved
// with it, never undo steps.
import { nodeById, useProjectStore, type Project } from '../model';

const view = () => useProjectStore.getState().history.present.view;
const setView = (v: Parameters<ReturnType<typeof useProjectStore.getState>['setView']>[0]) => useProjectStore.getState().setView(v);

/** Pin the table to what it shows now, or unpin it (which also ends a comparison) so it follows clicks again. */
export function togglePin() {
  const v = view();
  if (v.pinned) setView({ pinned: false, compare: undefined, failingRuleId: v.failingRuleId });
  else if (v.viewedNodeId) setView({ pinned: true, failingRuleId: v.failingRuleId });
}

/** Show a node in the table: unless the table is pinned, in which case the node is only selected. */
export function viewNode(nodeId: string) {
  if (view().pinned) return;
  setView({ viewedNodeId: nodeId, viewedStepIndex: undefined });
}

/** With the table pinned: move the pin to this node. */
export function viewHere(nodeId: string) {
  setView({ viewedNodeId: nodeId, viewedStepIndex: undefined, compare: undefined, pinned: true });
}

/** With the table pinned: show this node next to the pinned one. */
export function compareWith(nodeId: string) {
  if (!view().pinned || nodeId === view().viewedNodeId) return;
  setView({ compare: { nodeId }, failingRuleId: view().failingRuleId });
}

export function closeCompare() {
  setView({ compare: undefined, failingRuleId: view().failingRuleId });
}

/** The node being compared, when it still exists. */
export const comparedNode = (project: Project) => (project.view.compare ? nodeById(project, project.view.compare.nodeId) : undefined);

/**
 * With the table pinned, a node selected elsewhere that could be viewed or compared instead; undefined otherwise.
 */
export function offeredNode(project: Project, selectedId: string | null) {
  const v = project.view;
  if (!v.pinned || !selectedId || selectedId === v.viewedNodeId || selectedId === v.compare?.nodeId) return undefined;
  return nodeById(project, selectedId);
}
