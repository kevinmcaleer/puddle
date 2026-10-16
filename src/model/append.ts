// Pure edits to an Append node: its settings, and the order of its inputs.
import { nodeById } from './graph';
import type { AppendNode, AppendSpec, Project } from './schema';

const append = (project: Project, nodeId: string): AppendNode | undefined => {
  const n = nodeById(project, nodeId);
  return n?.type === 'append' ? n : undefined;
};

export function setAppendSpec(project: Project, nodeId: string, patch: Partial<AppendSpec>): Project {
  const node = append(project, nodeId);
  if (!node) return project;
  return { ...project, nodes: project.nodes.map((n) => (n.id === nodeId ? { ...node, appendSpec: { ...node.appendSpec, ...patch } } : n)) };
}

/** Swap the wires in two inputs of an Append (either may be empty), so its rows stack in a different order. */
export function swapAppendInputs(project: Project, nodeId: string, a: number, b: number): Project {
  if (!append(project, nodeId) || a === b || a < 0 || b < 0) return project;
  const into = (port: number) => project.edges.some((e) => e.to.nodeId === nodeId && e.to.port === port);
  if (!into(a) && !into(b)) return project;
  const swap = (port: unknown) => (port === a ? b : port === b ? a : port);
  return { ...project, edges: project.edges.map((e) => (e.to.nodeId === nodeId ? { ...e, to: { ...e.to, port: swap(e.to.port) as number } } : e)) };
}
