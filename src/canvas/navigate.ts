// Moving the selection around the canvas with the arrow keys, along the wires.
import { inputEdges, nodeById, outputEdges, type GraphNode, type Project } from '../model';

export type Direction = 'upstream' | 'downstream' | 'above' | 'below';

const byDistance = (from: GraphNode) => (a: GraphNode, b: GraphNode) =>
  Math.abs(a.position.y - from.position.y) - Math.abs(b.position.y - from.position.y) || a.position.y - b.position.y || a.position.x - b.position.x;

/** Nodes wired from the same node, or into the same node, as this one. */
function siblings(project: Project, node: GraphNode): GraphNode[] {
  const ids = new Set<string>();
  for (const e of inputEdges(project, node.id)) for (const o of outputEdges(project, e.from.nodeId)) ids.add(o.to.nodeId);
  for (const e of outputEdges(project, node.id)) for (const i of inputEdges(project, e.to.nodeId)) ids.add(i.from.nodeId);
  ids.delete(node.id);
  return [...ids].flatMap((id) => nodeById(project, id) ?? []);
}

/** With nothing wired alongside: the other nodes with no inputs (sources, side by side at the start of the flow). */
function starts(project: Project, node: GraphNode): GraphNode[] {
  if (inputEdges(project, node.id).length) return [];
  return project.nodes.filter((n) => n.id !== node.id && inputEdges(project, n.id).length === 0);
}

/** The first node to select when nothing is: the top-left one. */
export function firstNode(project: Project): GraphNode | undefined {
  return [...project.nodes].sort((a, b) => a.position.x - b.position.x || a.position.y - b.position.y)[0];
}

/**
 * The node an arrow key moves the selection to. Left and right follow the wires (nearest in height first); up and
 * down move between nodes wired alongside this one. Undefined when there is nowhere to go.
 */
export function neighbour(project: Project, fromId: string | null, direction: Direction): GraphNode | undefined {
  const from = fromId ? nodeById(project, fromId) : undefined;
  if (!from) return firstNode(project);
  if (direction === 'upstream' || direction === 'downstream') {
    const ids = direction === 'upstream' ? inputEdges(project, from.id).map((e) => e.from.nodeId) : outputEdges(project, from.id).map((e) => e.to.nodeId);
    return ids.flatMap((id) => nodeById(project, id) ?? []).sort(byDistance(from))[0];
  }
  const near = siblings(project, from);
  const pool = near.length ? near : starts(project, from);
  const side = pool.filter((n) => (direction === 'above' ? n.position.y < from.position.y : n.position.y > from.position.y));
  return side.sort(byDistance(from))[0];
}
