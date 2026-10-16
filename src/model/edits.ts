// Pure project edits used by the canvas, sources and inspector. Each returns a new project.
import { freePort, hasOutput, nodeById, removeNode } from './graph';
import { newId } from './ids';
import { DEFAULT_APPEND_SPEC, DEFAULT_JOIN_SPEC, DEFAULT_LOOKUP_SPEC, type GraphNode, type NodeType, type ParseOptions, type Project, type Source } from './schema';

type Position = { x: number; y: number };

const KIND_NAME: Record<NodeType, string> = { source: 'Source', transform: 'Transform', join: 'Join', append: 'Append', lookup: 'Lookup', output: 'Output' };

/** "Transform 3": the next free number for a node type. */
export function nextNodeName(project: Project, type: NodeType): string {
  const base = KIND_NAME[type];
  const used = new Set(project.nodes.map((n) => n.name));
  for (let i = 1; ; i++) if (!used.has(`${base} ${i}`)) return `${base} ${i}`;
}

/** Add a source and the Source node that reads it. */
export function addSource(project: Project, source: Source, position: Position, nodeId = newId('n')): Project {
  const node: GraphNode = { id: nodeId, type: 'source', name: source.name, sourceId: source.id, position, rules: [] };
  return { ...project, sources: [...project.sources, source], nodes: [...project.nodes, node], view: { ...project.view, viewedNodeId: nodeId, viewedStepIndex: undefined } };
}

export type AddableNodeType = Exclude<NodeType, 'source'>;

function newNode(type: AddableNodeType, base: { id: string; name: string; position: Position; rules: [] }): GraphNode {
  switch (type) {
    case 'transform':
      return { ...base, type, steps: [] };
    case 'join':
      return { ...base, type, joinSpec: { ...DEFAULT_JOIN_SPEC, keys: [] } };
    case 'append':
      return { ...base, type, appendSpec: { ...DEFAULT_APPEND_SPEC } };
    case 'lookup':
      return { ...base, type, lookupSpec: { ...DEFAULT_LOOKUP_SPEC, keys: [], columns: [] } };
    case 'output':
      return { ...base, type, outputSpec: { format: 'csv', options: {} } };
  }
}

/**
 * Add a Transform, Join, Append, Lookup or Output node. `after` names the nodes that feed it, wired into its free
 * inputs in order (a Join's left, then its right; an Append's 1, 2, 3...; a Lookup's main, then its lookup); nodes with no output, and any
 * beyond its inputs, are left unwired.
 */
export function addNode(project: Project, type: AddableNodeType, position: Position, after?: string | string[], nodeId = newId('n')): Project {
  const node = newNode(type, { id: nodeId, name: nextNodeName(project, type), position, rules: [] });
  let next: Project = { ...project, nodes: [...project.nodes, node] };
  const feeds = (Array.isArray(after) ? after : after ? [after] : []).map((id) => nodeById(project, id)).filter((n) => !!n && hasOutput(n));
  for (const from of feeds) {
    const port = freePort(next, nodeId);
    if (port == null) break;
    next = { ...next, edges: [...next.edges, { id: newId('e'), from: { nodeId: from!.id }, to: { nodeId, port } }] };
  }
  return next;
}

export function moveNodes(project: Project, positions: Record<string, Position>): Project {
  if (!Object.keys(positions).length) return project;
  return { ...project, nodes: project.nodes.map((n) => (positions[n.id] ? { ...n, position: positions[n.id]! } : n)) };
}

export function setCollapsed(project: Project, nodeId: string, collapsed: boolean): Project {
  return { ...project, nodes: project.nodes.map((n) => (n.id === nodeId ? { ...n, collapsed } : n)) };
}

/** Keep a node's result in memory (a pinned result), or stop keeping it. An Output node has nothing to keep. */
export function setKeepResult(project: Project, nodeId: string, keep: boolean): Project {
  return {
    ...project,
    nodes: project.nodes.map((n) => {
      if (n.id !== nodeId || n.type === 'output') return n;
      if (keep) return { ...n, pinnedResult: true };
      const { pinnedResult: _, ...rest } = n;
      return rest as typeof n;
    }),
  };
}

/** Remove nodes and their wires, plus sources no longer read by any node. Clears the view if it pointed at one. */
export function removeNodes(project: Project, ids: string[]): Project {
  let p = project;
  for (const id of ids) p = removeNode(p, id);
  const used = new Set(p.nodes.flatMap((n) => (n.type === 'source' ? [n.sourceId] : [])));
  const viewGone = p.view.viewedNodeId && !p.nodes.some((n) => n.id === p.view.viewedNodeId);
  return {
    ...p,
    sources: p.sources.filter((s) => used.has(s.id)),
    view: viewGone ? { ...p.view, viewedNodeId: undefined, viewedStepIndex: undefined } : p.view,
  };
}

export function updateSource(project: Project, sourceId: string, patch: Partial<Pick<Source, 'parseOptions' | 'detectedSchema' | 'name' | 'file' | 'url'>>): Project {
  return { ...project, sources: project.sources.map((s) => (s.id === sourceId ? { ...s, ...patch } : s)) };
}

export function setParseOptions(project: Project, sourceId: string, parseOptions: ParseOptions): Project {
  return updateSource(project, sourceId, { parseOptions });
}
