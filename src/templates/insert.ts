// Inserting a template: one edit, so one undo step, that adds its Transform node wired after the chosen node.
import { addNode, newId, type Project, type Step } from '../model';

type Position = { x: number; y: number };

/** The template's name, or "Name 2", "Name 3"... when a node already has it. */
function freeName(project: Project, name: string): string {
  const used = new Set(project.nodes.map((n) => n.name));
  if (!used.has(name)) return name;
  for (let i = 2; ; i++) if (!used.has(`${name} ${i}`)) return `${name} ${i}`;
}

/** Add a Transform node named after the template holding `steps` (already mapped for its input), wired after `after`. */
export function insertTemplate(project: Project, name: string, steps: Step[], position: Position, after?: string, nodeId = newId('n')): Project {
  const added = addNode(project, 'transform', position, after, nodeId);
  const named = freeName(project, name);
  return { ...added, nodes: added.nodes.map((n) => (n.id === nodeId && n.type === 'transform' ? { ...n, name: named, steps } : n)) };
}
