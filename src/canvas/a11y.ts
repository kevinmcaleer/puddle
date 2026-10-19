// What a screen reader hears on the canvas: each node and wire by name, and how to work them from the keyboard.
import type { NodeStatus } from '../flow/status';
import type { GraphNode } from '../model';
import { fullCount } from '../ui/format';

const TYPE_LABEL: Record<GraphNode['type'], string> = { source: 'Source', transform: 'Transform', join: 'Join', append: 'Append', lookup: 'Lookup', query: 'Query', sql: 'SQL', table: 'Schema table', output: 'Output' };

const plural = (n: number, one: string) => `${fullCount(n)} ${one}${n === 1 ? '' : 's'}`;

/**
 * A node's name, kind, size and state in one line: "Transform 1, Transform, 4 rows, 3 columns, viewed". The detail
 * under a node's name already starts with its kind ("Join · Inner"), so it stands in for the kind when there is one.
 */
export function nodeLabel(node: GraphNode, { detail, status, viewed }: { detail?: string; status?: NodeStatus; viewed?: boolean }): string {
  const parts = [node.name, detail?.replace(/ · /g, ', ') ?? TYPE_LABEL[node.type]];
  if (node.type === 'transform') parts.push(plural(node.steps.length, 'step'));
  if (status?.state === 'ok') {
    if (status.rows != null) parts.push(plural(status.rows, 'row'));
    parts.push(plural(status.columns.length, 'column'));
  }
  if (status?.state === 'error') parts.push(`broken: ${status.message}`);
  if (status?.state === 'blocked') parts.push('waiting on a broken node upstream');
  if (status?.state === 'detached') parts.push('file not connected');
  if (status?.state === 'unwired') parts.push('not connected yet');
  if (viewed) parts.push('viewed');
  return parts.join(', ');
}

/** "Wire from customers.csv into Join 1, left input" */
export const wireLabel = (from: string, to: string, port?: string) => `Wire from ${from} into ${to}${port ? `, ${port.toLowerCase()}` : ''}`;

/** React Flow's descriptions and announcements, in Puddle's words and keys. */
export const CANVAS_ARIA = {
  'node.a11yDescription.default': 'Arrow keys follow the wires. Enter opens the node, V views it, C wires it into another node, Delete removes it.',
  'node.a11yDescription.keyboardDisabled': 'Arrow keys follow the wires. Enter opens the node, V views it, C wires it into another node, Delete removes it.',
  'edge.a11yDescription.default': 'Press Enter to select this wire, then Delete to remove it.',
};
