import dagre from '@dagrejs/dagre';
import { moveGroup, moveNodes, type Project } from '../model';

const NODE_W = 232;
const NODE_H = 96;

/**
 * Lay the flow out left to right (sources on the left, outputs on the right) as one undoable edit. A collapsed group
 * is laid out as the one card it is drawn as, and its nodes move with it.
 */
export function autoLayout(project: Project): Project {
  if (!project.nodes.length) return project;
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: 'LR', nodesep: 32, ranksep: 72, marginx: 40, marginy: 40 });
  g.setDefaultEdgeLabel(() => ({}));
  const cardOf = new Map<string, string>();
  for (const group of project.groups) if (group.collapsed) for (const id of group.nodeIds) cardOf.set(id, `group:${group.id}`);
  const key = (id: string) => cardOf.get(id) ?? id;
  for (const n of project.nodes) g.setNode(key(n.id), { width: NODE_W, height: NODE_H });
  for (const e of project.edges) if (key(e.from.nodeId) !== key(e.to.nodeId)) g.setEdge(key(e.from.nodeId), key(e.to.nodeId));
  dagre.layout(g);
  const place = (id: string) => {
    const { x, y } = g.node(id);
    return { x: Math.round(x - NODE_W / 2), y: Math.round(y - NODE_H / 2) };
  };
  const positions: Record<string, { x: number; y: number }> = {};
  for (const n of project.nodes) if (!cardOf.has(n.id)) positions[n.id] = place(n.id);
  let laid = moveNodes(project, positions);
  for (const group of project.groups) if (group.collapsed) laid = moveGroup(laid, group.id, place(`group:${group.id}`));
  return laid;
}
