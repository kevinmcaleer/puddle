// Descriptions: one short line, in the user's own words, saying what a node or a group is for ("combine into a
// single list", "touchless rate per month"), so a messy flow reads at a glance on the canvas. Longer thoughts go in
// a node's notes. A description is canvas text only: nothing compiles from it.
import type { Project } from './schema';

/** The longest description kept; the canvas shows two lines of it and the rest on hover. */
export const DESCRIPTION_MAX = 140;

/** A description as saved: on one line, spaces collapsed, trimmed and cut to DESCRIPTION_MAX; nothing when blank. */
export function cleanDescription(text: string | undefined): string | undefined {
  const one = (text ?? '').replace(/\s+/g, ' ').trim().slice(0, DESCRIPTION_MAX).trim();
  return one || undefined;
}

/** Describe a node, or clear its description with blank text. */
export function setNodeDescription(project: Project, nodeId: string, text: string): Project {
  const description = cleanDescription(text);
  const node = project.nodes.find((n) => n.id === nodeId);
  if (!node || node.description === description) return project;
  return { ...project, nodes: project.nodes.map((n) => (n.id === nodeId ? { ...n, description } : n)) };
}

/** Describe a group, or clear its description with blank text. */
export function setGroupDescription(project: Project, groupId: string, text: string): Project {
  const description = cleanDescription(text);
  const group = project.groups.find((g) => g.id === groupId);
  if (!group || group.description === description) return project;
  return { ...project, groups: project.groups.map((g) => (g.id === groupId ? { ...g, description } : g)) };
}
