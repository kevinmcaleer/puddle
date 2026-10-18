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
