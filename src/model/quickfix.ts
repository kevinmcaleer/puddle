// Where a quick fix lands: on the viewed Transform node, or on a new one placed in line with a viewed Source, Join or Output
// (or after the viewed Transform, when the project adds each step as a node).
import { addNode } from './edits';
import { inputEdges, nodeById, outputEdges } from './graph';
import { newId } from './ids';
import type { Project, Step } from './schema';
import { addStep } from './steps';

export interface Placed {
  project: Project;
  nodeId: string;
  stepIndex: number;
}

/**
 * Add `step` where the viewed data is. On a Transform it goes after the viewed step (or at the end). On a
 * Source or a Join, a new Transform is put between it and everything it fed; on an Output, between it and
 * its input. With the project's `stepsAsNodes` setting, a Transform viewed at its last step gets a new Transform
 * after it in the same way, so each step is a node of its own; viewed at an earlier step, the step still goes in
 * there, as a node after it would come after the later steps too.
 * Returns undefined when nothing is viewed.
 */
export function placeStep(project: Project, step: Step, newNodeId = newId('n')): Placed | undefined {
  const { viewedNodeId, viewedStepIndex } = project.view;
  const node = viewedNodeId ? nodeById(project, viewedNodeId) : undefined;
  if (!node) return undefined;

  const last = node.type === 'transform' && (viewedStepIndex == null || viewedStepIndex >= node.steps.length - 1);
  const ownNode = project.settings.stepsAsNodes && node.type === 'transform' && node.steps.length > 0 && last;
  if (node.type === 'transform' && !ownNode) {
    const at = viewedStepIndex == null ? node.steps.length : viewedStepIndex + 1;
    return { project: addStep(project, node.id, step, at), nodeId: node.id, stepIndex: at };
  }

  const position = { x: node.position.x + (node.type === 'output' ? -296 : 296), y: node.position.y + 120 };
  // A Source, a Join or a Transform: Node → new Transform → everything it fed.
  if (node.type !== 'output') {
    const outs = outputEdges(project, node.id);
    const added = addNode(project, 'transform', position, node.id, newNodeId);
    const rewired = { ...added, edges: added.edges.map((e) => (outs.some((o) => o.id === e.id) ? { ...e, from: { nodeId: newNodeId } } : e)) };
    return { project: addStep(rewired, newNodeId, step), nodeId: newNodeId, stepIndex: 0 };
  }

  // Output: upstream → new Transform → Output.
  const [input] = inputEdges(project, node.id);
  const added = addNode(project, 'transform', position, input?.from.nodeId, newNodeId);
  const edges = input ? [...added.edges.filter((e) => e.id !== input.id), { id: newId('e'), from: { nodeId: newNodeId }, to: { nodeId: node.id, port: 0 as const } }] : added.edges;
  return { project: addStep({ ...added, edges }, newNodeId, step), nodeId: newNodeId, stepIndex: 0 };
}
