import { NAMED_PORTS, type Edge, type GraphNode, type Port, type Project } from './schema';

export class GraphError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GraphError';
  }
}

/** One input of a node: the port id its wire carries, and the name people see ("Left"). */
export interface InputPort {
  id: Port;
  label: string;
  /** The node compiles without a wire here (Append's spare inputs); otherwise every input must be wired. */
  optional?: boolean;
}

const NO_PORTS: InputPort[] = [];
const ONE_PORT: InputPort[] = [{ id: 0, label: 'Input' }];
const JOIN_PORTS: InputPort[] = [
  { id: 'left', label: 'Left' },
  { id: 'right', label: 'Right' },
];

const LOOKUP_PORTS: InputPort[] = [
  { id: 'main', label: 'Main' },
  { id: 'lookup', label: 'Lookup' },
];

/** Smallest number of inputs an Append shows, so a new one offers two. */
export const APPEND_MIN_PORTS = 2;

/**
 * The inputs a node takes, in the order they sit down its left edge. Each takes at most one wire, and the
 * node compiles once every input that isn't optional is wired. An Append numbers its inputs from 0 and always
 * offers one more after the last wired one; one left empty in the middle keeps its place, so the order of the
 * others never shifts.
 */
export function inputPorts(project: Project, node: GraphNode): InputPort[] {
  switch (node.type) {
    case 'source':
      return NO_PORTS;
    case 'join':
      return JOIN_PORTS;
    case 'lookup':
      return LOOKUP_PORTS;
    case 'append': {
      const wired = project.edges.filter((e) => e.to.nodeId === node.id && typeof e.to.port === 'number').map((e) => e.to.port as number);
      const count = Math.max(APPEND_MIN_PORTS, wired.length ? Math.max(...wired) + 2 : 0);
      return Array.from({ length: count }, (_, i) => ({ id: i, label: `Input ${i + 1}`, optional: true }));
    }
    default:
      return ONE_PORT;
  }
}

/** How many wires a node accepts. */
export function inputCapacity(project: Project, node: GraphNode): number {
  return inputPorts(project, node).length;
}

export const samePort = (a: Port, b: Port) => String(a) === String(b);

/** A port id as React Flow hands it back (handle ids are strings): "0" is 0, "left" is "left". */
export function parsePort(handle: string | null | undefined): Port | undefined {
  if (handle == null || handle === '') return undefined;
  if (/^\d+$/.test(handle)) return Number(handle);
  return (NAMED_PORTS as readonly string[]).includes(handle) ? (handle as Port) : undefined;
}

export function hasOutput(node: GraphNode): boolean {
  return node.type !== 'output';
}

export function nodeById(project: Project, id: string): GraphNode | undefined {
  return project.nodes.find((n) => n.id === id);
}

/** Wires into a node, in port order (left before right, 0 before 1). */
export function inputEdges(project: Project, nodeId: string): Edge[] {
  return project.edges
    .filter((e) => e.to.nodeId === nodeId)
    .sort((a, b) => String(a.to.port).localeCompare(String(b.to.port), undefined, { numeric: true }));
}

/** The wire into one input of a node, if there is one. */
export function inputEdge(project: Project, nodeId: string, port: Port): Edge | undefined {
  return project.edges.find((e) => e.to.nodeId === nodeId && samePort(e.to.port, port));
}

/** The first input of a node with no wire in it yet. */
export function freePort(project: Project, nodeId: string): Port | undefined {
  const node = nodeById(project, nodeId);
  return node ? inputPorts(project, node).find((p) => !inputEdge(project, nodeId, p.id))?.id : undefined;
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

/** Every node upstream of nodeId, including itself, across every input. */
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

/**
 * Whether a wire from `fromId` into input `port` of `toId` is allowed, and if not, why, in words the canvas
 * can show. Without a port, the first free input is meant. Each input takes one wire; loops are refused.
 */
export function canConnect(project: Project, fromId: string, toId: string, port?: Port): ConnectCheck {
  const from = nodeById(project, fromId);
  const to = nodeById(project, toId);
  if (!from || !to) return { ok: false, reason: 'That node no longer exists.' };
  if (fromId === toId) return { ok: false, reason: "A node can't feed into itself." };
  if (!hasOutput(from)) return { ok: false, reason: `${from.name} is an Output node, so nothing can come out of it.` };
  const ports = inputPorts(project, to);
  if (!ports.length) return { ok: false, reason: `${to.name} is a Source node, so it can't take an input.` };
  const single = ports.length === 1;
  const target = port ?? freePort(project, toId);
  if (target == null) {
    if (project.edges.some((e) => e.from.nodeId === fromId && e.to.nodeId === toId)) return { ok: false, reason: 'These nodes are already connected.' };
    return { ok: false, reason: single ? `${to.name} already has an input. Remove that wire first.` : `Every input of ${to.name} already has a wire. Remove one first.` };
  }
  const spec = ports.find((p) => samePort(p.id, target));
  if (!spec) return { ok: false, reason: `${to.name} has no input called ${String(target)}.` };
  const taken = inputEdge(project, toId, target);
  if (taken?.from.nodeId === fromId) return { ok: false, reason: 'These nodes are already connected.' };
  if (taken) return { ok: false, reason: single ? `${to.name} already has an input. Remove that wire first.` : `${/input/i.test(spec.label) ? spec.label : `The ${spec.label.toLowerCase()} input`} of ${to.name} already has a wire. Remove it first.` };
  if (upstreamIds(project, fromId).has(toId)) return { ok: false, reason: `That wire would make a loop: ${to.name} already feeds into ${from.name}.` };
  return { ok: true };
}

/** Add a wire into the input its edge names, or throw GraphError with the reason it's refused. */
export function connect(project: Project, edge: Edge): Project {
  const check = canConnect(project, edge.from.nodeId, edge.to.nodeId, edge.to.port);
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
