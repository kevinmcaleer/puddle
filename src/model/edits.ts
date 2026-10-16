// Pure project edits used by the canvas, sources and inspector. Each returns a new project.
import { hasOutput, nodeById, removeNode } from './graph';
import { newId } from './ids';
import type { GraphNode, NodeType, ParseOptions, Project, Source } from './schema';

type Position = { x: number; y: number };

const KIND_NAME: Record<NodeType, string> = { source: 'Source', transform: 'Transform', output: 'Output' };

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

/**
 * Add a Transform or Output node. When `after` names a node with an output, the new node is placed to its
 * right and wired to it.
 */
export function addNode(project: Project, type: 'transform' | 'output', position: Position, after?: string, nodeId = newId('n')): Project {
  const base = { id: nodeId, name: nextNodeName(project, type), position, rules: [] };
  const node: GraphNode = type === 'transform' ? { ...base, type, steps: [] } : { ...base, type, outputSpec: { format: 'csv', options: {} } };
  const from = after ? nodeById(project, after) : undefined;
  const edges = from && hasOutput(from) ? [...project.edges, { id: newId('e'), from: { nodeId: from.id }, to: { nodeId, port: 0 as const } }] : project.edges;
  return { ...project, nodes: [...project.nodes, node], edges };
}

export function moveNodes(project: Project, positions: Record<string, Position>): Project {
  if (!Object.keys(positions).length) return project;
  return { ...project, nodes: project.nodes.map((n) => (positions[n.id] ? { ...n, position: positions[n.id]! } : n)) };
}

export function setCollapsed(project: Project, nodeId: string, collapsed: boolean): Project {
  return { ...project, nodes: project.nodes.map((n) => (n.id === nodeId ? { ...n, collapsed } : n)) };
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
