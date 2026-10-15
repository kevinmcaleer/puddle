// Pure edits to a transform node's steps, and grouping nodes into one or splitting one into two.
import { inputEdges, nodeById, outputEdges } from './graph';
import { newId } from './ids';
import type { GraphNode, Project, Step, TransformNode } from './schema';

const transform = (project: Project, nodeId: string): TransformNode | undefined => {
  const n = nodeById(project, nodeId);
  return n?.type === 'transform' ? n : undefined;
};

function withSteps(project: Project, nodeId: string, edit: (steps: Step[]) => Step[]): Project {
  const node = transform(project, nodeId);
  if (!node) return project;
  const steps = edit(node.steps);
  if (steps === node.steps) return project;
  return { ...project, nodes: project.nodes.map((n) => (n.id === nodeId ? { ...node, steps } : n)) };
}

/** Insert a step (at the end by default). */
export const addStep = (project: Project, nodeId: string, step: Step, at?: number): Project =>
  withSteps(project, nodeId, (steps) => {
    const i = at == null ? steps.length : Math.max(0, Math.min(at, steps.length));
    return [...steps.slice(0, i), step, ...steps.slice(i)];
  });

export const updateStep = (project: Project, nodeId: string, stepId: string, patch: Partial<Omit<Step, 'id'>>): Project =>
  withSteps(project, nodeId, (steps) => (steps.some((s) => s.id === stepId) ? steps.map((s) => (s.id === stepId ? { ...s, ...patch } : s)) : steps));

/**
 * Remove a step. If it began an absorbed node, its origin passes to the next step so ungrouping still works;
 * an absorbed node that loses all its steps is simply forgotten.
 */
export const removeStep = (project: Project, nodeId: string, stepId: string): Project =>
  withSteps(project, nodeId, (steps) => {
    const i = steps.findIndex((s) => s.id === stepId);
    if (i < 0) return steps;
    const gone = steps[i]!;
    const next = steps[i + 1];
    const rest = steps.filter((s) => s.id !== stepId);
    if (gone.origin && next && !next.origin) return rest.map((s) => (s.id === next.id ? { ...s, origin: gone.origin } : s));
    return rest;
  });

/** Move a step from one position to another. Moving keeps origins on the step they belong to. */
export const moveStep = (project: Project, nodeId: string, from: number, to: number): Project =>
  withSteps(project, nodeId, (steps) => {
    if (from === to || from < 0 || from >= steps.length || to < 0 || to >= steps.length) return steps;
    const next = [...steps];
    const [s] = next.splice(from, 1);
    next.splice(to, 0, s!);
    return next;
  });

export const toggleStep = (project: Project, nodeId: string, stepId: string): Project => {
  const step = transform(project, nodeId)?.steps.find((s) => s.id === stepId);
  return step ? updateStep(project, nodeId, stepId, { enabled: !step.enabled }) : project;
};

export function renameNode(project: Project, nodeId: string, name: string): Project {
  const trimmed = name.trim();
  if (!trimmed) return project;
  return { ...project, nodes: project.nodes.map((n) => (n.id === nodeId ? { ...n, name: trimmed } : n)) };
}

export function setNodeNotes(project: Project, nodeId: string, notes: string): Project {
  return { ...project, nodes: project.nodes.map((n) => (n.id === nodeId ? { ...n, notes: notes || undefined } : n)) };
}

export type GroupCheck = { ok: true; chain: string[] } | { ok: false; reason: string };

/**
 * Whether these nodes can become one: transform nodes with at least one step, wired in a single line where
 * each inner wire is the only way in and out. Returns them in flow order.
 */
export function canGroup(project: Project, ids: string[]): GroupCheck {
  if (ids.length < 2) return { ok: false, reason: 'Select two or more Transform nodes to group.' };
  const set = new Set(ids);
  const nodes = ids.map((id) => nodeById(project, id));
  if (nodes.some((n) => n?.type !== 'transform')) return { ok: false, reason: 'Only Transform nodes can be grouped.' };
  if (nodes.some((n) => (n as TransformNode).steps.length === 0)) return { ok: false, reason: 'A node with no steps can’t be grouped. Add a step or leave it out.' };
  const heads = ids.filter((id) => !inputEdges(project, id).some((e) => set.has(e.from.nodeId)));
  if (heads.length !== 1) return { ok: false, reason: 'Grouped nodes must be wired one after another in a single line.' };
  const chain = [heads[0]!];
  while (chain.length < ids.length) {
    const outs = outputEdges(project, chain.at(-1)!);
    if (outs.length !== 1 || !set.has(outs[0]!.to.nodeId)) return { ok: false, reason: 'Grouped nodes must be wired one after another, with no branches in between.' };
    chain.push(outs[0]!.to.nodeId);
  }
  return { ok: true, chain };
}

/**
 * Merge a line of transform nodes into the first one. Each absorbed node's first step remembers the node, so
 * `ungroupNode` gives back the exact original graph.
 */
export function groupNodes(project: Project, ids: string[]): Project {
  const check = canGroup(project, ids);
  if (!check.ok) return project;
  const [headId, ...rest] = check.chain;
  const head = transform(project, headId!)!;
  const absorbed = new Set(rest);
  let steps = [...head.steps];
  const innerEdges = new Set<string>();
  for (const id of rest) {
    const n = transform(project, id)!;
    const edge = inputEdges(project, id)[0]!;
    innerEdges.add(edge.id);
    const [first, ...more] = n.steps;
    const origin = { nodeId: n.id, name: n.name, notes: n.notes, position: n.position, collapsed: n.collapsed, rules: n.rules, edgeId: edge.id };
    steps = [...steps, { ...first!, origin }, ...more];
  }
  const last = check.chain.at(-1)!;
  return {
    ...project,
    nodes: project.nodes.filter((n) => !absorbed.has(n.id)).map((n) => (n.id === headId ? { ...head, steps } : n)),
    edges: project.edges.filter((e) => !innerEdges.has(e.id)).map((e) => (e.from.nodeId === last ? { ...e, from: { nodeId: headId! } } : e)),
    view: absorbed.has(project.view.viewedNodeId ?? '') ? { ...project.view, viewedNodeId: headId, viewedStepIndex: undefined } : project.view,
  };
}

/** True when a node holds steps that came from grouping, so it can be ungrouped. */
export const canUngroup = (node: GraphNode | undefined) => node?.type === 'transform' && node.steps.some((s) => s.origin);

/** Undo a grouping: every step carrying an origin starts its node again, with its wires restored. */
export function ungroupNode(project: Project, nodeId: string): Project {
  const node = transform(project, nodeId);
  if (!node || !canUngroup(node)) return project;
  const parts: { node: TransformNode; edgeId?: string }[] = [{ node: { ...node, steps: [] } }];
  for (const step of node.steps) {
    if (step.origin) {
      const { origin, ...plain } = step;
      parts.push({
        node: { id: origin.nodeId, type: 'transform', name: origin.name, notes: origin.notes, position: origin.position, collapsed: origin.collapsed, rules: origin.rules, steps: [plain] },
        edgeId: origin.edgeId,
      });
    } else parts.at(-1)!.node.steps.push(step);
  }
  const lastId = parts.at(-1)!.node.id;
  const outs = outputEdges(project, nodeId);
  const inner = parts.slice(1).map((p, i) => ({ id: p.edgeId!, from: { nodeId: parts[i]!.node.id }, to: { nodeId: p.node.id, port: 0 as const } }));
  const nodes = project.nodes.flatMap((n) => (n.id === nodeId ? parts.map((p) => p.node) : [n]));
  const edges = [...project.edges.map((e) => (outs.includes(e) ? { ...e, from: { nodeId: lastId } } : e)), ...inner];
  return { ...project, nodes, edges };
}

/** Split a transform node before step `at`: steps from there on move to a new node wired after it. */
export function splitNode(project: Project, nodeId: string, at: number, newNodeId = newId('n')): Project {
  const node = transform(project, nodeId);
  if (!node || at <= 0 || at >= node.steps.length) return project;
  const moving = node.steps.slice(at);
  const first = moving[0]!;
  const origin = first.origin;
  const created: TransformNode = origin
    ? { id: origin.nodeId, type: 'transform', name: origin.name, notes: origin.notes, position: origin.position, collapsed: origin.collapsed, rules: origin.rules, steps: [{ ...first, origin: undefined }, ...moving.slice(1)] }
    : { id: newNodeId, type: 'transform', name: `${node.name} (2)`, position: { x: node.position.x + 296, y: node.position.y }, rules: [], steps: moving };
  const edgeId = origin?.edgeId ?? newId('e');
  const outs = outputEdges(project, nodeId);
  return {
    ...project,
    nodes: project.nodes.flatMap((n) => (n.id === nodeId ? [{ ...node, steps: node.steps.slice(0, at) }, created] : [n])),
    edges: [...project.edges.map((e) => (outs.includes(e) ? { ...e, from: { nodeId: created.id } } : e)), { id: edgeId, from: { nodeId }, to: { nodeId: created.id, port: 0 } }],
  };
}
