import type { Edge, GraphNode, Project } from './schema';

export class GraphError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GraphError';
  }
}

/** How many wires a node accepts. Phase 1 node types take zero or one. */
export function inputCapacity(node: GraphNode): number {
  return node.type === 'source' ? 0 : 1;
}

export function hasOutput(node: GraphNode): boolean {
  return node.type !== 'output';
}

export function nodeById(project: Project, id: string): GraphNode | undefined {
  return project.nodes.find((n) => n.id === id);
}

export function inputEdges(project: Project, nodeId: string): Edge[] {
  return project.edges
    .filter((e) => e.to.nodeId === nodeId)
    .sort((a, b) => String(a.to.port).localeCompare(String(b.to.port), undefined, { numeric: true }));
}

export function outputEdges(project: Project, nodeId: string): Edge[] {
  return project.edges.filter((e) => e.from.nodeId === nodeId);
}

function reachable(start: string, next: (id: string) => string[]): Set<string> {
  const seen = new Set<string>();
  const stack = [start];
  while (stack.length) {
    const id = stack.pop()!;
    if (seen.has(id)) continue;
    seen.add(id);
    stack.push(...next(id));
  }
  return seen;
}

/** Every node downstream of nodeId, including itself. */
export function downstreamIds(project: Project, nodeId: string): Set<string> {
  return reachable(nodeId, (id) => outputEdges(project, id).map((e) => e.to.nodeId));
}

/** Every node upstream of nodeId, including itself. */
export function upstreamIds(project: Project, nodeId: string): Set<string> {
  return reachable(nodeId, (id) => inputEdges(project, id).map((e) => e.from.nodeId));
}

/** Topological order of the given nodes (all nodes by default). Throws if the graph has a cycle. */
export function topoSort(project: Project, only?: Set<string>): string[] {
  const ids = project.nodes.map((n) => n.id).filter((id) => !only || only.has(id));
  const inSet = new Set(ids);
  const indeg = new Map(ids.map((id) => [id, 0]));
  for (const e of project.edges) if (inSet.has(e.from.nodeId) && inSet.has(e.to.nodeId)) indeg.set(e.to.nodeId, indeg.get(e.to.nodeId)! + 1);
  const queue = ids.filter((id) => indeg.get(id) === 0);
  const order: string[] = [];
  while (queue.length) {
    const id = queue.shift()!;
    order.push(id);
    for (const e of outputEdges(project, id)) {
      if (!inSet.has(e.to.nodeId)) continue;
      const d = indeg.get(e.to.nodeId)! - 1;
      indeg.set(e.to.nodeId, d);
      if (d === 0) queue.push(e.to.nodeId);
    }
  }
  if (order.length !== ids.length) throw new GraphError('The flow has a loop in it. Remove one of the wires in the loop.');
  return order;
}

export type ConnectCheck = { ok: true } | { ok: false; reason: string };

/** Whether a wire from `fromId` into `toId` is allowed, and if not, why, in words the canvas can show. */
export function canConnect(project: Project, fromId: string, toId: string): ConnectCheck {
  const from = nodeById(project, fromId);
  const to = nodeById(project, toId);
  if (!from || !to) return { ok: false, reason: 'That node no longer exists.' };
  if (fromId === toId) return { ok: false, reason: "A node can't feed into itself." };
  if (!hasOutput(from)) return { ok: false, reason: `${from.name} is an Output node, so nothing can come out of it.` };
  const capacity = inputCapacity(to);
  if (capacity === 0) return { ok: false, reason: `${to.name} is a Source node, so it can't take an input.` };
  if (project.edges.some((e) => e.from.nodeId === fromId && e.to.nodeId === toId)) return { ok: false, reason: 'These nodes are already connected.' };
  if (inputEdges(project, toId).length >= capacity) return { ok: false, reason: `${to.name} already has an input. Remove that wire first.` };
  if (upstreamIds(project, fromId).has(toId)) return { ok: false, reason: `That wire would make a loop: ${to.name} already feeds into ${from.name}.` };
  return { ok: true };
}

/** Add a wire, or throw GraphError with the reason it's refused. */
export function connect(project: Project, edge: Edge): Project {
  const check = canConnect(project, edge.from.nodeId, edge.to.nodeId);
  if (!check.ok) throw new GraphError(check.reason);
  return { ...project, edges: [...project.edges, edge] };
}

export function disconnect(project: Project, edgeId: string): Project {
  return { ...project, edges: project.edges.filter((e) => e.id !== edgeId) };
}

export function removeNode(project: Project, nodeId: string): Project {
  return {
    ...project,
    nodes: project.nodes.filter((n) => n.id !== nodeId),
    edges: project.edges.filter((e) => e.from.nodeId !== nodeId && e.to.nodeId !== nodeId),
  };
}
