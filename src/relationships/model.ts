// What the relationships view draws: the project's tables with their columns, and the relationships between their
// columns that the project already states, in its Join and Lookup nodes, the Query nodes' join lines and the rules
// that check a column's values exist in another node. Pure, so DBML is written from the same thing.
import { cardKind } from '../canvas/kind';
import { foreignKey, projectSchema, uniqueKeys } from '../compiler';
import { inputEdge, inputEdges, nodeById, type ColumnSchema, type GraphNode, type Port, type Project } from '../model';
import type { NodeKind } from '../ui';

/** One end of a relationship: a column of a node's output. */
export interface End {
  nodeId: string;
  column: string;
}

/** Where the project states a relationship: a node that combines on it, or a rule on `nodeId` that checks it. */
export interface Via {
  nodeId: string;
  /** `schema`: a ref of the project's DBML, between two Schema table nodes. */
  kind: 'join' | 'lookup' | 'query' | 'rule' | 'schema';
  ruleId?: string;
  /** The node's name, or the rule's label. */
  label: string;
}

/** Two columns that match, `from` usually the one that refers to `to` (an order's customer to the customer). */
export interface Relationship {
  key: string;
  from: End;
  to: End;
  /**
   * The columns as the first node that states it reads them, before they're moved to their tables: the one and many
   * ends are checked here, so a key a Transform made unique counts as one even though its source repeats it.
   */
  read: { from: End; to: End };
  via: Via[];
}

export interface RelTable {
  nodeId: string;
  name: string;
  kind: NodeKind;
  /** Undefined while they're being read, or when the node can't run. */
  columns?: ColumnSchema[];
}

/** The columns a node is known to have, or undefined while they aren't known. */
export type ColumnsOf = (nodeId: string) => ColumnSchema[] | undefined;

const has = (columns: ColumnSchema[] | undefined, column: string) => !!columns?.some((c) => c.name === column);

/**
 * The table a column belongs to: from the node a combining node reads, back up through Transform nodes for as long
 * as the column is there under the same name, so a key read from "Orders, cleaned" is drawn on the Orders source.
 * A column that a step made, or renamed, stays on the node where it appears.
 */
export function homeOf(project: Project, end: End, columnsOf: ColumnsOf): End {
  let at = end.nodeId;
  const seen = new Set<string>([at]);
  for (;;) {
    const node = nodeById(project, at);
    if (node?.type !== 'transform') return { nodeId: at, column: end.column };
    const up = inputEdge(project, at, 0)?.from.nodeId;
    if (!up || seen.has(up) || !has(columnsOf(up), end.column)) return { nodeId: at, column: end.column };
    seen.add(up);
    at = up;
  }
}

const fed = (project: Project, nodeId: string, port: Port) => inputEdge(project, nodeId, port)?.from.nodeId;

/** Every pair of columns the project matches, before they're moved to their tables. */
function statedPairs(project: Project): Array<{ from: End; to: End; via: Via }> {
  const pairs: Array<{ from: End; to: End; via: Via }> = [];
  const pair = (fromNode: string | undefined, fromCol: string, toNode: string | undefined, toCol: string, via: Via) => {
    if (fromNode && toNode && fromCol && toCol && fromNode !== toNode) pairs.push({ from: { nodeId: fromNode, column: fromCol }, to: { nodeId: toNode, column: toCol }, via });
  };
  for (const n of project.nodes) {
    if (n.type === 'join') {
      const [l, r] = [fed(project, n.id, 'left'), fed(project, n.id, 'right')];
      for (const k of n.joinSpec.keys) pair(l, k.left, r, k.right, { nodeId: n.id, kind: 'join', label: n.name });
    } else if (n.type === 'lookup') {
      const [m, l] = [fed(project, n.id, 'main'), fed(project, n.id, 'lookup')];
      for (const k of n.lookupSpec.keys) pair(m, k.main, l, k.lookup, { nodeId: n.id, kind: 'lookup', label: n.name });
    } else if (n.type === 'query') {
      const ports = new Map(inputEdges(project, n.id).map((e) => [e.to.port, e.from.nodeId]));
      for (const j of n.querySpec.joins) pair(ports.get(j.left.port), j.left.column, ports.get(j.right.port), j.right.column, { nodeId: n.id, kind: 'query', label: n.name });
    }
    for (const r of n.rules) {
      if (!r.enabled) continue;
      const p = r.params as { column?: string; node?: string; nodeColumn?: string; from?: string };
      const reads = r.type === 'referential' || (r.type === 'inSet' && p.from === 'node');
      if (reads && p.node && nodeById(project, p.node)) pair(n.id, p.column ?? '', p.node, p.nodeColumn ?? '', { nodeId: n.id, kind: 'rule', ruleId: r.id, label: r.label });
    }
  }
  // The schema's refs, between the Schema table nodes holding each end (every node for a table, as each holds its rows).
  const tableNodes = project.nodes.filter((n) => n.type === 'table');
  if (tableNodes.length) {
    const nodesFor = (schema: string, table: string) => tableNodes.filter((n) => n.type === 'table' && n.tableSpec.schema === schema && n.tableSpec.table === table);
    for (const ref of projectSchema(project.schema.dbml).refs) {
      const fk = foreignKey(ref);
      if (!fk) continue;
      for (const child of nodesFor(fk.child.schema, fk.child.table))
        for (const parent of nodesFor(fk.parent.schema, fk.parent.table))
          fk.child.columns.forEach((c, i) => pair(child.id, c, parent.id, fk.parent.columns[i] ?? c, { nodeId: child.id, kind: 'schema', label: ref.name ? `Ref ${ref.name}` : 'Ref in the schema' }));
    }
  }
  return pairs;
}

/**
 * The columns a Schema table node holds as keys: its single-column primary key and unique columns are the one end of
 * any relationship, as its table refuses a load that repeats them.
 */
export function declaredKeys(project: Project): Uniqueness {
  const schema = projectSchema(project.schema.dbml);
  const out: Uniqueness = {};
  for (const n of project.nodes) {
    if (n.type !== 'table') continue;
    const t = schema.tables.find((x) => x.schema === n.tableSpec.schema && x.name === n.tableSpec.table);
    if (!t) continue;
    const cols = uniqueKeys(t).filter((k) => k.length === 1).map((k) => k[0]!);
    if (cols.length) out[n.id] = Object.fromEntries(cols.map((c) => [c, true]));
  }
  return out;
}

const endKey = (e: End) => `${e.nodeId}\u0000${e.column}`;

/** The relationships the project states, each pair of columns once (whichever way round), with every place that states it. */
export function findRelationships(project: Project, columnsOf: ColumnsOf): Relationship[] {
  const found = new Map<string, Relationship>();
  for (const p of statedPairs(project)) {
    const [from, to] = [homeOf(project, p.from, columnsOf), homeOf(project, p.to, columnsOf)];
    if (from.nodeId === to.nodeId && from.column === to.column) continue;
    const key = [endKey(from), endKey(to)].sort().join('\u0001');
    const had = found.get(key);
    if (had) {
      if (!had.via.some((v) => v.nodeId === p.via.nodeId && v.ruleId === p.via.ruleId)) had.via.push(p.via);
    } else found.set(key, { key, from, to, read: { from: p.from, to: p.to }, via: [p.via] });
  }
  return [...found.values()];
}

const asTable = (n: GraphNode, columnsOf: ColumnsOf): RelTable => ({ nodeId: n.id, name: n.name, kind: cardKind(n.type), columns: columnsOf(n.id) });

/**
 * The tables to draw: every source and Schema table, and every other node a relationship ends on. Related tables come next to each
 * other: each source in project order, followed by the tables it reaches through relationships.
 */
export function relationshipTables(project: Project, relationships: Relationship[], columnsOf: ColumnsOf): RelTable[] {
  const ends = new Set(relationships.flatMap((r) => [r.from.nodeId, r.to.nodeId]));
  const shown = project.nodes.filter((n) => n.type === 'source' || n.type === 'table' || ends.has(n.id));
  const next = new Map<string, string[]>();
  for (const r of relationships) {
    next.set(r.from.nodeId, [...(next.get(r.from.nodeId) ?? []), r.to.nodeId]);
    next.set(r.to.nodeId, [...(next.get(r.to.nodeId) ?? []), r.from.nodeId]);
  }
  const order: string[] = [];
  const visit = (id: string) => {
    const queue = [id];
    while (queue.length) {
      const at = queue.shift()!;
      if (order.includes(at)) continue;
      order.push(at);
      queue.push(...(next.get(at) ?? []));
    }
  };
  for (const n of shown) visit(n.id);
  return order.flatMap((id) => {
    const n = nodeById(project, id);
    return n ? [asTable(n, columnsOf)] : [];
  });
}

/** How many rows of a table can share a key value: one (the column has no repeats) or many. */
export type Cardinality = 'one' | 'many';

/** Which columns of which tables have no repeated values, as checked: nodeId → column → unique. */
export type Uniqueness = Record<string, Record<string, boolean> | undefined>;

/** Whether many rows or one row of the table share a value at that end of the relationship, once it's checked. */
export function cardinality(unique: Uniqueness, r: Relationship, side: 'from' | 'to'): Cardinality | undefined {
  const end = r.read[side];
  const u = unique[end.nodeId]?.[end.column];
  return u == null ? undefined : u ? 'one' : 'many';
}

/** "many to one", for reading a relationship out: how many `from` rows go with how many `to` rows. */
export function describeCardinality(unique: Uniqueness, r: Relationship): string | undefined {
  const [from, to] = [cardinality(unique, r, 'from'), cardinality(unique, r, 'to')];
  return from && to ? `${from} to ${to}` : undefined;
}

/** The columns to check for repeats, by the node that reads them. */
export function keyColumns(relationships: Relationship[]): Map<string, string[]> {
  const keys = new Map<string, string[]>();
  for (const e of relationships.flatMap((r) => [r.read.from, r.read.to])) {
    const cols = keys.get(e.nodeId) ?? [];
    if (!cols.includes(e.column)) keys.set(e.nodeId, [...cols, e.column]);
  }
  return keys;
}

/** The tables' columns that are the "one" end of some relationship, as "nodeId:column". */
export function keyEnds(relationships: Relationship[], unique: Uniqueness): Set<string> {
  const keys = new Set<string>();
  for (const r of relationships)
    for (const side of ['from', 'to'] as const) if (cardinality(unique, r, side) === 'one') keys.add(`${r[side].nodeId}:${r[side].column}`);
  return keys;
}
