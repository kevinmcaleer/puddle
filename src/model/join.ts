// Pure edits to a Join node: its settings, and which input is left and which is right.
import { addNode } from './edits';
import { downstreamIds, inputEdge, nodeById } from './graph';
import { newId } from './ids';
import type { JoinNode, JoinSpec, Project, Step } from './schema';
import { addStep } from './steps';

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

/** How far apart nodes in a line sit, and how far below a node one added beside it goes. */
const COLUMN = 296;
const ROW = 160;

/**
 * Put a Transform holding `steps` on the wire into each side of a join that has some, so only the join reads the
 * changed rows; whatever else the inputs feed still reads them as they were. The join and everything after it
 * move along to make room. A side that isn't wired, or has no steps, is left alone.
 */
export function addBeforeJoin(project: Project, nodeId: string, steps: { left?: Step[]; right?: Step[] }, ids: { left?: string; right?: string } = {}): Project {
  const node = join(project, nodeId);
  if (!node) return project;
  let next = project;
  let added = false;
  for (const side of ['left', 'right'] as const) {
    const wire = inputEdge(next, nodeId, side);
    const from = wire && nodeById(next, wire.from.nodeId);
    if (!wire || !from || !steps[side]?.length) continue;
    const id = ids[side] ?? newId('n');
    next = addNode(next, 'transform', { x: node.position.x, y: from.position.y }, from.id, id);
    next = { ...next, edges: next.edges.map((e) => (e.id === wire.id ? { ...e, from: { nodeId: id } } : e)) };
    for (const step of steps[side]) next = addStep(next, id, step);
    added = true;
  }
  if (!added) return project;
  const moved = new Set([nodeId, ...downstreamIds(project, nodeId)]);
  return { ...next, nodes: next.nodes.map((n) => (moved.has(n.id) ? { ...n, position: { x: n.position.x + COLUMN, y: n.position.y } } : n)) };
}

/**
 * Add an Anti join beside a join that keeps the rows of its kept side that found no match: the same inputs and
 * keys, turned round for a right join, whose kept side is the right. Named after the join. Returns the project
 * unchanged when the join has an input missing.
 */
export function addUnmatchedJoin(project: Project, nodeId: string, newNodeId = newId('n')): Project {
  const node = join(project, nodeId);
  const [l, r] = [inputEdge(project, nodeId, 'left')?.from.nodeId, inputEdge(project, nodeId, 'right')?.from.nodeId];
  if (!node || !l || !r) return project;
  const turned = node.joinSpec.kind === 'right';
  const keys = node.joinSpec.keys.map((k) => (turned ? { left: k.right, right: k.left } : { ...k }));
  const added = addNode(project, 'join', { x: node.position.x, y: node.position.y + ROW }, turned ? [r, l] : [l, r], newNodeId);
  const used = new Set(project.nodes.map((n) => n.name));
  let name = `${node.name} unmatched`;
  for (let i = 2; used.has(name); i++) name = `${node.name} unmatched ${i}`;
  return { ...added, nodes: added.nodes.map((n) => (n.id === newNodeId && n.type === 'join' ? { ...n, name, joinSpec: { ...n.joinSpec, kind: 'anti', keys } } : n)) };
}
