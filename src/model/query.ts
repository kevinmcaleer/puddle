// Pure edits to a Query node, as the query designer makes them: tables in and out, join lines, and the field grid.
import { canConnect, freePort, GraphError, inputEdge, nodeById } from './graph';
import { newId } from './ids';
import type { Project, QueryField, QueryFieldRef, QueryJoin, QueryJoinKind, QueryNode, QuerySpec } from './schema';

const query = (project: Project, nodeId: string): QueryNode | undefined => {
  const n = nodeById(project, nodeId);
  return n?.type === 'query' ? n : undefined;
};

function withSpec(project: Project, nodeId: string, edit: (spec: QuerySpec) => QuerySpec): Project {
  const node = query(project, nodeId);
  if (!node) return project;
  const querySpec = edit(node.querySpec);
  return querySpec === node.querySpec ? project : { ...project, nodes: project.nodes.map((n) => (n.id === nodeId ? { ...node, querySpec } : n)) };
}

export const setQuerySpec = (project: Project, nodeId: string, patch: Partial<QuerySpec>): Project => withSpec(project, nodeId, (spec) => ({ ...spec, ...patch }));

/** Where a new table goes in the designer: to the right of the last one. */
const TABLE_STEP = 240;
const nextTablePosition = (spec: QuerySpec) => ({ x: spec.tables.length ? Math.max(...spec.tables.map((t) => t.x)) + TABLE_STEP : 24, y: 24 });

/**
 * Add a node's output to the query as a table: a wire into the Query's first free input. Throws GraphError with the
 * reason when that wire isn't allowed (it would make a loop, say).
 */
export function addQueryTable(project: Project, nodeId: string, fromId: string, wireId = newId('e')): Project {
  const port = freePort(project, nodeId);
  const check = canConnect(project, fromId, nodeId, port);
  if (!check.ok) throw new GraphError(check.reason);
  const next: Project = { ...project, edges: [...project.edges, { id: wireId, from: { nodeId: fromId }, to: { nodeId, port: port! } }] };
  return withSpec(next, nodeId, (spec) => ({ ...spec, tables: [...spec.tables.filter((t) => t.port !== port), { port: port as number, ...nextTablePosition(spec) }] }));
}

/** Take a table out of the query: its wire, its place in the designer, its fields in the grid and its join lines. */
export function removeQueryTable(project: Project, nodeId: string, port: number): Project {
  if (!query(project, nodeId)) return project;
  const edge = inputEdge(project, nodeId, port);
  const next = edge ? { ...project, edges: project.edges.filter((e) => e.id !== edge.id) } : project;
  return withSpec(next, nodeId, (spec) => ({
    ...spec,
    tables: spec.tables.filter((t) => t.port !== port),
    fields: spec.fields.filter((f) => f.port !== port),
    joins: spec.joins.filter((j) => j.left.port !== port && j.right.port !== port),
  }));
}

export function moveQueryTable(project: Project, nodeId: string, port: number, position: { x: number; y: number }): Project {
  return withSpec(project, nodeId, (spec) => ({ ...spec, tables: [...spec.tables.filter((t) => t.port !== port), { port, x: Math.round(position.x), y: Math.round(position.y) }] }));
}

/** Put a field in the grid, at `index` (the end by default). */
export function addQueryField(project: Project, nodeId: string, ref: QueryFieldRef, index?: number, fieldId = newId('f')): Project {
  return withSpec(project, nodeId, (spec) => {
    const field: QueryField = { id: fieldId, port: ref.port, column: ref.column, show: true, sort: 'none' };
    const fields = [...spec.fields];
    fields.splice(index == null ? fields.length : Math.max(0, Math.min(index, fields.length)), 0, field);
    return { ...spec, fields };
  });
}

export function updateQueryField(project: Project, nodeId: string, fieldId: string, patch: Partial<Omit<QueryField, 'id'>>): Project {
  return withSpec(project, nodeId, (spec) => ({ ...spec, fields: spec.fields.map((f) => (f.id === fieldId ? { ...f, ...patch } : f)) }));
}

export function removeQueryField(project: Project, nodeId: string, fieldId: string): Project {
  return withSpec(project, nodeId, (spec) => ({ ...spec, fields: spec.fields.filter((f) => f.id !== fieldId) }));
}

/** Move a field to another place in the grid (its index once moved). */
export function moveQueryField(project: Project, nodeId: string, fieldId: string, index: number): Project {
  return withSpec(project, nodeId, (spec) => {
    const from = spec.fields.findIndex((f) => f.id === fieldId);
    if (from < 0) return spec;
    const fields = spec.fields.filter((f) => f.id !== fieldId);
    fields.splice(Math.max(0, Math.min(index, fields.length)), 0, spec.fields[from]!);
    return { ...spec, fields };
  });
}

const sameRef = (a: QueryFieldRef, b: QueryFieldRef) => a.port === b.port && a.column === b.column;
const betweenTables = (j: QueryJoin, a: number, b: number) => (j.left.port === a && j.right.port === b) || (j.left.port === b && j.right.port === a);

/** A join kind seen from the other end of the line: keeping every left row is keeping every right row once turned round. */
const turned = (kind: QueryJoinKind): QueryJoinKind => (kind === 'left' ? 'right' : kind === 'right' ? 'left' : kind);

/**
 * Draw a join line from one table's column to another's (a primary key dragged onto a foreign key). Lines between
 * the same two tables share a join type, so a new one takes theirs; a line that's already there is left alone.
 */
export function addQueryJoin(project: Project, nodeId: string, left: QueryFieldRef, right: QueryFieldRef, joinId = newId('j')): Project {
  if (left.port === right.port) return project;
  return withSpec(project, nodeId, (spec) => {
    if (spec.joins.some((j) => (sameRef(j.left, left) && sameRef(j.right, right)) || (sameRef(j.left, right) && sameRef(j.right, left)))) return spec;
    const sibling = spec.joins.find((j) => betweenTables(j, left.port, right.port));
    const kind = !sibling ? 'inner' : sibling.left.port === left.port ? sibling.kind : turned(sibling.kind);
    return { ...spec, joins: [...spec.joins, { id: joinId, left, right, kind }] };
  });
}

/** Change how a join line matches rows; every line between the same two tables follows. */
export function setQueryJoinKind(project: Project, nodeId: string, joinId: string, kind: QueryJoinKind): Project {
  return withSpec(project, nodeId, (spec) => {
    const line = spec.joins.find((j) => j.id === joinId);
    if (!line) return spec;
    const joins = spec.joins.map((j) => (!betweenTables(j, line.left.port, line.right.port) ? j : { ...j, kind: j.left.port === line.left.port ? kind : turned(kind) }));
    return { ...spec, joins };
  });
}

export function removeQueryJoin(project: Project, nodeId: string, joinId: string): Project {
  return withSpec(project, nodeId, (spec) => ({ ...spec, joins: spec.joins.filter((j) => j.id !== joinId) }));
}
