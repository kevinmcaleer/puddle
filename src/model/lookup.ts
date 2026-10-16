// Pure edits to a Lookup node: its settings, and which input is the main one.
import { nodeById } from './graph';
import type { LookupNode, LookupSpec, Project } from './schema';

const lookup = (project: Project, nodeId: string): LookupNode | undefined => {
  const n = nodeById(project, nodeId);
  return n?.type === 'lookup' ? n : undefined;
};

export function setLookupSpec(project: Project, nodeId: string, patch: Partial<LookupSpec>): Project {
  const node = lookup(project, nodeId);
  if (!node) return project;
  return { ...project, nodes: project.nodes.map((n) => (n.id === nodeId ? { ...node, lookupSpec: { ...node.lookupSpec, ...patch } } : n)) };
}

/**
 * Swap the main and lookup inputs: the wires change ports and each key pair turns round. The columns brought
 * across came from the old lookup input, so they're cleared to be picked again from the new one.
 */
export function swapLookupInputs(project: Project, nodeId: string): Project {
  const node = lookup(project, nodeId);
  if (!node) return project;
  const flip = { main: 'lookup', lookup: 'main' } as const;
  const lookupSpec = { ...node.lookupSpec, keys: node.lookupSpec.keys.map((k) => ({ main: k.lookup, lookup: k.main })), columns: [] };
  return {
    ...project,
    nodes: project.nodes.map((n) => (n.id === nodeId ? { ...node, lookupSpec } : n)),
    edges: project.edges.map((e) => (e.to.nodeId === nodeId && (e.to.port === 'main' || e.to.port === 'lookup') ? { ...e, to: { ...e.to, port: flip[e.to.port] } } : e)),
  };
}
