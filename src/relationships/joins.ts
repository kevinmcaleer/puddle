// Relationships carried into queries, as in Access: a table added to a Query comes joined to the tables already there
// on every relationship the project states between them, and a new Join or Lookup starts matching on them, so a
// relationship is drawn once, not again in every query.
import { addQueryJoin, addQueryTable, inputEdges, type Project, type QueryFieldRef } from '../model';
import { findRelationships, homeOf, type ColumnsOf, type End } from './model';

export interface RelatedJoin {
  /** The table that was there already. */
  left: QueryFieldRef;
  /** The table just added. */
  right: QueryFieldRef;
}

/** Whether the node wired into a query gives it this end of a relationship: the column, read from the end's table. */
function carries(project: Project, nodeId: string, end: End, columnsOf: ColumnsOf): boolean {
  const cols = columnsOf(nodeId);
  if (cols && !cols.some((c) => c.name === end.column)) return false;
  const home = homeOf(project, { nodeId, column: end.column }, columnsOf);
  return home.nodeId === end.nodeId && home.column === end.column;
}

/** The join lines the project's relationships give the table at `port` of a Query to each of its other tables. */
export function relatedJoins(project: Project, queryId: string, port: number, columnsOf: ColumnsOf): RelatedJoin[] {
  const tables = inputEdges(project, queryId).flatMap((e) => (typeof e.to.port === 'number' ? [{ port: e.to.port, nodeId: e.from.nodeId }] : []));
  const added = tables.find((t) => t.port === port);
  if (!added) return [];
  const out: RelatedJoin[] = [];
  const push = (j: RelatedJoin) => {
    if (!out.some((o) => o.left.port === j.left.port && o.left.column === j.left.column && o.right.column === j.right.column)) out.push(j);
  };
  for (const r of findRelationships(project, columnsOf))
    for (const other of tables) {
      if (other.port === port) continue;
      if (carries(project, added.nodeId, r.from, columnsOf) && carries(project, other.nodeId, r.to, columnsOf)) push({ left: { port: other.port, column: r.to.column }, right: { port, column: r.from.column } });
      if (carries(project, added.nodeId, r.to, columnsOf) && carries(project, other.nodeId, r.from, columnsOf)) push({ left: { port: other.port, column: r.from.column }, right: { port, column: r.to.column } });
    }
  return out;
}

/** Join lines between every pair of a Query's tables that the project's relationships relate, each pair once. */
export function withRelatedJoins(project: Project, queryId: string, columnsOf: ColumnsOf): Project {
  let next = project;
  for (const e of inputEdges(project, queryId)) {
    if (typeof e.to.port !== 'number') continue;
    const port = e.to.port;
    for (const j of relatedJoins(project, queryId, port, columnsOf)) if (j.left.port < port) next = addQueryJoin(next, queryId, j.left, j.right);
  }
  return next;
}

/**
 * The keys a Join or Lookup of these two nodes matches on by the project's relationships, as pairs of the left (or
 * main) node's column and the right (or lookup) node's; none when nothing relates them.
 */
export function relatedKeys(project: Project, leftId: string, rightId: string, columnsOf: ColumnsOf): Array<{ left: string; right: string }> {
  const out: Array<{ left: string; right: string }> = [];
  const push = (left: string, right: string) => {
    if (!out.some((k) => k.left === left && k.right === right)) out.push({ left, right });
  };
  for (const r of findRelationships(project, columnsOf)) {
    if (carries(project, leftId, r.from, columnsOf) && carries(project, rightId, r.to, columnsOf)) push(r.from.column, r.to.column);
    else if (carries(project, leftId, r.to, columnsOf) && carries(project, rightId, r.from, columnsOf)) push(r.to.column, r.from.column);
  }
  return out;
}

/**
 * Add a node to the query as a table, joined to the tables there already on the relationships between them. Throws
 * GraphError, as addQueryTable does, when the wire isn't allowed.
 */
export function addRelatedTable(project: Project, queryId: string, fromId: string, columnsOf: ColumnsOf): Project {
  const before = new Set(project.edges.map((e) => e.id));
  let next = addQueryTable(project, queryId, fromId);
  const wire = next.edges.find((e) => !before.has(e.id));
  if (typeof wire?.to.port !== 'number') return next;
  for (const j of relatedJoins(next, queryId, wire.to.port, columnsOf)) next = addQueryJoin(next, queryId, j.left, j.right);
  return next;
}
