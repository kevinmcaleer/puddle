// Pure edits to a Join node: its settings, and which input is left and which is right.
import { nodeById } from './graph';
import type { JoinNode, JoinSpec, Project } from './schema';

const join = (project: Project, nodeId: string): JoinNode | undefined => {
  const n = nodeById(project, nodeId);
  return n?.type === 'join' ? n : undefined;
};

export function setJoinSpec(project: Project, nodeId: string, patch: Partial<JoinSpec>): Project {
  const node = join(project, nodeId);
  if (!node) return project;
  return { ...project, nodes: project.nodes.map((n) => (n.id === nodeId ? { ...node, joinSpec: { ...node.joinSpec, ...patch } } : n)) };
}

/**
 * Swap the left and right inputs: the wires change ports and each key pair turns round, so the join still
 * matches on the same columns. The join type stays, so a left join now keeps every row of the other table.
 */
export function swapJoinInputs(project: Project, nodeId: string): Project {
  const node = join(project, nodeId);
  if (!node) return project;
  const flip = { left: 'right', right: 'left' } as const;
  const joinSpec = { ...node.joinSpec, keys: node.joinSpec.keys.map((k) => ({ left: k.right, right: k.left })) };
  return {
    ...project,
    nodes: project.nodes.map((n) => (n.id === nodeId ? { ...node, joinSpec } : n)),
    edges: project.edges.map((e) => (e.to.nodeId === nodeId && (e.to.port === 'left' || e.to.port === 'right') ? { ...e, to: { ...e.to, port: flip[e.to.port] } } : e)),
  };
}
