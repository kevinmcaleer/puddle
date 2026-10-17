// Node groups, as in Blender: nodes gathered into a group that the canvas can collapse to one card showing only the
// wires into it and the results out of it. Pure edits; what runs is the same whether a group is open or not.
import { hasOutput, nodeById } from './graph';
import { newId } from './ids';
import type { NodeGroup, Project } from './schema';

export type GroupCheck = { ok: true } | { ok: false; reason: string };

/** The group a node is in, if any. */
export const groupOf = (project: Project, nodeId: string): NodeGroup | undefined => project.groups.find((g) => g.nodeIds.includes(nodeId));

export const groupById = (project: Project, groupId: string): NodeGroup | undefined => project.groups.find((g) => g.id === groupId);

/** Whether these nodes can make a group: two or more, none of them in a group already. */
export function canMakeGroup(project: Project, ids: string[]): GroupCheck {
  const nodes = [...new Set(ids)].flatMap((id) => nodeById(project, id) ?? []);
  if (nodes.length < 2) return { ok: false, reason: 'Select two or more nodes to group them.' };
  const grouped = nodes.find((n) => groupOf(project, n.id));
  if (grouped) return { ok: false, reason: `${grouped.name} is in a group already. Ungroup it first.` };
  return { ok: true };
}

/** "Group 1", or the next number not taken. */
export function nextGroupName(project: Project): string {
  const taken = new Set(project.groups.map((g) => g.name));
  let i = 1;
  while (taken.has(`Group ${i}`)) i++;
  return `Group ${i}`;
}

/** Gather the nodes into a new group, collapsed, its card where the top-left node was. */
export function makeGroup(project: Project, ids: string[], id = newId('g')): Project {
  if (!canMakeGroup(project, ids).ok) return project;
  const nodes = [...new Set(ids)].flatMap((nid) => nodeById(project, nid) ?? []);
  const position = { x: Math.min(...nodes.map((n) => n.position.x)), y: Math.min(...nodes.map((n) => n.position.y)) };
  const group: NodeGroup = { id, name: nextGroupName(project), nodeIds: nodes.map((n) => n.id), collapsed: true, position };
  return { ...project, groups: [...project.groups, group] };
}

/** Undo a group: its nodes stay where they are, wired as they were. */
export const ungroup = (project: Project, groupId: string): Project => ({ ...project, groups: project.groups.filter((g) => g.id !== groupId) });

const updateGroup = (project: Project, groupId: string, patch: Partial<NodeGroup>): Project => ({
  ...project,
  groups: project.groups.map((g) => (g.id === groupId ? { ...g, ...patch } : g)),
});

/** Close a group to its card, or open it round its nodes, making room for them first if anything sits in the way. */
export function setGroupCollapsed(project: Project, groupId: string, collapsed: boolean): Project {
  const next = updateGroup(project, groupId, { collapsed });
  return collapsed ? next : makeRoom(next, groupId);
}

// A node's size on the canvas, and the space kept round an opened group, for making room.
const NODE_W = 232;
const NODE_H = 96;
const ROOM = 64;

/**
 * A collapsed group's card takes less room than its nodes, so a layout made while it was closed (such as Auto layout)
 * can put other nodes where its nodes are. Opening it then moves whatever lies to its right further right, by as much
 * as the nearest one in the way needs, so nothing is hidden under the group and the flow keeps its shape.
 */
function makeRoom(project: Project, groupId: string): Project {
  const group = groupById(project, groupId);
  const members = group?.nodeIds.flatMap((id) => nodeById(project, id) ?? []) ?? [];
  if (!group || !members.length) return project;
  const left = Math.min(...members.map((n) => n.position.x));
  const right = Math.max(...members.map((n) => n.position.x)) + NODE_W + ROOM;
  const top = Math.min(...members.map((n) => n.position.y)) - ROOM;
  const bottom = Math.max(...members.map((n) => n.position.y)) + NODE_H + ROOM;
  // What moves: nodes on their own, and other collapsed groups as a whole (their card, with their nodes).
  const closed = project.groups.filter((g) => g.id !== groupId && g.collapsed);
  const inClosed = new Set(closed.flatMap((g) => g.nodeIds));
  const loose = project.nodes.filter((n) => !group.nodeIds.includes(n.id) && !inClosed.has(n.id) && n.position.x > left);
  const cards = closed.filter((g) => g.position.x > left);
  const inWay = [...loose.map((n) => n.position), ...cards.map((g) => g.position)].filter((p) => p.x < right && p.y + NODE_H > top && p.y < bottom);
  if (!inWay.length) return project;
  const dx = right - Math.min(...inWay.map((p) => p.x));
  const moved = new Set([...loose.map((n) => n.id), ...cards.flatMap((g) => g.nodeIds)]);
  const shifted = new Set(cards.map((g) => g.id));
  return {
    ...project,
    nodes: project.nodes.map((n) => (moved.has(n.id) ? { ...n, position: { x: n.position.x + dx, y: n.position.y } } : n)),
    groups: project.groups.map((g) => (shifted.has(g.id) ? { ...g, position: { x: g.position.x + dx, y: g.position.y } } : g)),
  };
}

export const renameGroup = (project: Project, groupId: string, name: string) => (name.trim() ? updateGroup(project, groupId, { name: name.trim() }) : project);

/** Move a collapsed group's card, and its nodes with it, so they are still round it when it opens. */
export function moveGroup(project: Project, groupId: string, to: { x: number; y: number }): Project {
  const group = groupById(project, groupId);
  if (!group) return project;
  const dx = to.x - group.position.x;
  const dy = to.y - group.position.y;
  const members = new Set(group.nodeIds);
  return {
    ...updateGroup(project, groupId, { position: to }),
    nodes: project.nodes.map((n) => (members.has(n.id) ? { ...n, position: { x: n.position.x + dx, y: n.position.y + dy } } : n)),
  };
}

/** Forget nodes that are gone, and groups left with none. */
export function pruneGroups(project: Project): Project {
  if (!project.groups.length) return project;
  const ids = new Set(project.nodes.map((n) => n.id));
  const groups = project.groups.map((g) => ({ ...g, nodeIds: g.nodeIds.filter((id) => ids.has(id)) })).filter((g) => g.nodeIds.length > 0);
  const same = groups.length === project.groups.length && groups.every((g, i) => g.nodeIds.length === project.groups[i]!.nodeIds.length);
  return same ? project : { ...project, groups };
}

export interface GroupPorts {
  /** Each wire coming in from outside the group, in the order its node sits (top to bottom). */
  inputs: { edgeId: string; fromNodeId: string; toNodeId: string }[];
  /** Each node whose result leaves the group (or goes nowhere yet), top to bottom: what the group gives out. */
  outputs: { nodeId: string }[];
}

/** What a collapsed group shows: the wires that come in, and the results that go out. */
export function groupPorts(project: Project, group: NodeGroup): GroupPorts {
  const members = new Set(group.nodeIds);
  const y = (id: string) => nodeById(project, id)?.position.y ?? 0;
  const inputs = project.edges
    .filter((e) => members.has(e.to.nodeId) && !members.has(e.from.nodeId))
    .map((e) => ({ edgeId: e.id, fromNodeId: e.from.nodeId, toNodeId: e.to.nodeId }))
    .sort((a, b) => y(a.toNodeId) - y(b.toNodeId));
  const outputs = group.nodeIds
    .filter((id) => {
      const node = nodeById(project, id);
      if (!node || !hasOutput(node)) return false;
      const outs = project.edges.filter((e) => e.from.nodeId === id);
      return outs.length === 0 || outs.some((e) => !members.has(e.to.nodeId));
    })
    .sort((a, b) => y(a) - y(b))
    .map((nodeId) => ({ nodeId }));
  return { inputs, outputs };
}
