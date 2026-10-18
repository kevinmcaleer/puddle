// Inserting a template: one edit, so one undo step, that adds its steps wired after the chosen node. With each step
// as a node (the project's default), the steps arrive as a chain of Transform nodes gathered in a group named after
// the template, the way the Add menu would have made them; otherwise as one Transform holding them all.
import { addNode, addStep, makeGroup, newId, nextGroupName, renameGroup, type Project, type Step } from '../model';

type Position = { x: number; y: number };

/** The template's name, or "Name 2", "Name 3"... when a node or a group already has it. */
function freeName(project: Project, name: string): string {
  const used = new Set([...project.nodes.map((n) => n.name), ...project.groups.map((g) => g.name)]);
  if (!used.has(name)) return name;
  for (let i = 2; ; i++) if (!used.has(`${name} ${i}`)) return `${name} ${i}`;
}

/** Add a Transform node named after the template holding `steps` (already mapped for its input), wired after `after`. */
export function insertTemplate(project: Project, name: string, steps: Step[], position: Position, after?: string, nodeId = newId('n')): Project {
  const added = addNode(project, 'transform', position, after, nodeId);
  const named = freeName(project, name);
  return { ...added, nodes: added.nodes.map((n) => (n.id === nodeId && n.type === 'transform' ? { ...n, name: named, steps } : n)) };
}

/** How far apart the nodes of a chain sit, as the Add menu places them. */
const STRIDE = 296;

/**
 * Add the template's steps as a chain of one-step Transform nodes, the first wired after `after`, each after the one
 * before, gathered into a collapsed group named after the template. `ids` names the nodes, in step order, and
 * `groupId` the group; a template of one step gets one node named after the template and no group.
 */
export function insertTemplateChain(project: Project, name: string, steps: Step[], position: Position, after?: string, ids: string[] = steps.map(() => newId('n')), groupId = newId('g')): Project {
  if (steps.length < 2) return insertTemplate(project, name, steps, position, after, ids[0]);
  let next = project;
  let feed = after;
  for (const [i, step] of steps.entries()) {
    const id = ids[i]!;
    next = addStep(addNode(next, 'transform', { x: position.x + i * STRIDE, y: position.y }, feed, id), id, step);
    feed = id;
  }
  const named = freeName(project, name);
  // makeGroup names the group "Group N"; the template's own name replaces it.
  const grouped = makeGroup(next, ids, groupId);
  return nextGroupName(next) === named ? grouped : renameGroup(grouped, groupId, named);
}
