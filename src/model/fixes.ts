// Where Fix all's steps land: one after another after the node whose issues they fix (each its own Transform when the
// project adds steps as nodes, so the canvas shows Trim → Collapse spaces → …), gathered into a group named "Fixes".
// One pure edit, so the store records it as one undo step.
import { canMakeGroup, makeGroup, renameGroup } from './groups';
import { newId } from './ids';
import { placeStepAt, type Placed } from './quickfix';
import type { Project, Step } from './schema';

export const FIXES_GROUP_NAME = 'Fixes';

export interface PlacedFixes {
  project: Project;
  /** The Transform nodes the steps made, in order; empty when they stacked into an existing Transform. */
  nodeIds: string[];
  /** Where the last step went, to view and select it. */
  last: Placed;
}

/**
 * Add the steps after `nodeId`, each after the one before: on a Source, a new Transform between it and what it fed,
 * then (with steps as nodes) a chain of Transforms, grouped as "Fixes" when there are two or more; without, they stack
 * into one Transform. Returns undefined when the node doesn't exist or there are no steps.
 */
export function placeFixes(project: Project, nodeId: string, steps: Step[], ids: { nodes?: string[]; group?: string } = {}): PlacedFixes | undefined {
  if (!steps.length) return undefined;
  const before = new Set(project.nodes.map((n) => n.id));
  let at: { nodeId: string; stepIndex?: number } = { nodeId };
  let last: Placed | undefined;
  let p = project;
  steps.forEach((step, i) => {
    const placed = placeStepAt(p, at, step, ids.nodes?.[i] ?? newId('n'));
    if (!placed) return;
    p = placed.project;
    last = placed;
    at = { nodeId: placed.nodeId, stepIndex: placed.stepIndex };
  });
  if (!last) return undefined;
  const nodeIds = p.nodes.map((n) => n.id).filter((id) => !before.has(id));
  if (nodeIds.length >= 2 && canMakeGroup(p, nodeIds).ok) {
    const groupId = ids.group ?? newId('g');
    p = renameGroup(makeGroup(p, nodeIds, groupId), groupId, FIXES_GROUP_NAME);
  }
  return { project: p, nodeIds, last };
}
