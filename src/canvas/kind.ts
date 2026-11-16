import type { GraphNode, NodeType } from '../model';
import type { NodeKind } from '../ui';

/** The design system's node kind a node is drawn as: a Lookup combines two inputs, so it's styled as a Join. */
export const cardKind = (type: NodeType): NodeKind => (type === 'lookup' ? 'join' : type);

/**
 * What heads a node's card. A Transform with one step is that step, so the card is headed by what the step does
 * ("Trimmed name, city") with the node's name under it; every other node is headed by its name.
 */
export function cardHeading(node: GraphNode, detail?: string): { name: string; detail?: string } {
  const only = node.type === 'transform' && node.steps.length === 1 ? node.steps[0] : undefined;
  return only ? { name: only.label, detail: detail ?? node.name } : { name: node.name, detail };
}

/**
 * The tag on the card of a node that is a table in its own right, saying how it came to be: one a script created
 * with CREATE TABLE, or one imported as a source (a file, a web address, a database table, pasted rows).
 */
export function tableTag(node: GraphNode): { label: string; title: string } | undefined {
  if (node.type === 'scriptTable') return { label: 'SQL table', title: 'A table created with SQL: CREATE TABLE name AS a query' };
  if (node.type === 'source') return { label: 'Imported table', title: 'A table imported as a source' };
  return undefined;
}
