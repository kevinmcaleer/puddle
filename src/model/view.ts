// What the results table shows is part of the project (saved with it) but never an undo step.
import type { Project, ProjectView } from './schema';

const has = (p: Project, id: string | undefined) => !!id && p.nodes.some((n) => n.id === id);

/**
 * The view once nodes may have gone: a viewed node that is gone clears the view and the pin, and a compared node
 * that is gone ends the comparison.
 */
export function viewWithout(p: Project): ProjectView {
  const v = p.view;
  const viewGone = !!v.viewedNodeId && !has(p, v.viewedNodeId);
  const compareGone = !!v.compare && (viewGone || !has(p, v.compare.nodeId));
  if (!viewGone && !compareGone) return v;
  const next = { ...v };
  if (viewGone) Object.assign(next, { viewedNodeId: undefined, viewedStepIndex: undefined, pinned: false });
  if (compareGone) next.compare = undefined;
  return next;
}

/**
 * Undo and redo restore an earlier project, view and all. A pinned table and a comparison are not undo steps, so
 * they carry over from `from` wherever their nodes still exist in `to`.
 */
export function carryPin(to: Project, from: Project): Project {
  const f = from.view;
  const t = to.view;
  if (f.pinned === t.pinned && f.compare?.nodeId === t.compare?.nodeId && (!f.pinned || (f.viewedNodeId === t.viewedNodeId && f.viewedStepIndex === t.viewedStepIndex))) return to;
  const view: ProjectView = { ...t, pinned: false, compare: undefined };
  if (f.pinned && has(to, f.viewedNodeId)) {
    Object.assign(view, { pinned: true, viewedNodeId: f.viewedNodeId, viewedStepIndex: f.viewedStepIndex });
    if (f.compare && has(to, f.compare.nodeId)) view.compare = f.compare;
  }
  return { ...to, view };
}
