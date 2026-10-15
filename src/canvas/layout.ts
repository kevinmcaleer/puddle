import dagre from '@dagrejs/dagre';
import { moveNodes, type Project } from '../model';

const NODE_W = 232;
const NODE_H = 96;

/** Lay the flow out left to right (sources on the left, outputs on the right) as one undoable edit. */
export function autoLayout(project: Project): Project {
  if (!project.nodes.length) return project;
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: 'LR', nodesep: 32, ranksep: 72, marginx: 40, marginy: 40 });
  g.setDefaultEdgeLabel(() => ({}));
  for (const n of project.nodes) g.setNode(n.id, { width: NODE_W, height: NODE_H });
  for (const e of project.edges) g.setEdge(e.from.nodeId, e.to.nodeId);
  dagre.layout(g);
  const positions: Record<string, { x: number; y: number }> = {};
  for (const n of project.nodes) {
    const { x, y } = g.node(n.id);
    positions[n.id] = { x: Math.round(x - NODE_W / 2), y: Math.round(y - NODE_H / 2) };
  }
  return moveNodes(project, positions);
}
