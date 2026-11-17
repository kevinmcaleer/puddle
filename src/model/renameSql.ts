// What a node's new name means for the SQL that reads it. A SQL node, and the SQL kept on a Query, may read a wired
// node by its name; renaming the node rewrites that name where the SQL reads it, so the query goes on running.
import { querySqlNames } from '../compiler/querySql';
import { renameTableInSql, sqlUsesName } from '../compiler/renameTable';
import { sqlInputNames } from '../compiler/sqlNode';
import { inputEdges, nodeById } from './graph';
import type { GraphNode, Project } from './schema';

/** For each input port of a node, the names its SQL may read that input by. */
function namesByPort(project: Project, node: GraphNode): Map<number, string[]> {
  const inputs = inputEdges(project, node.id).map((e) => ({ port: e.to.port as number, label: nodeById(project, e.from.nodeId)?.name ?? '' }));
  if (node.type === 'query') return querySqlNames(inputs);
  return new Map(inputs.map((i) => [i.port, sqlInputNames(i, inputs.length)]));
}

const sqlOf = (node: GraphNode): string | undefined => (node.type === 'sql' ? node.sqlSpec.query : node.type === 'query' ? node.querySpec.sql : undefined);

const withSql = (node: GraphNode, sql: string): GraphNode =>
  node.type === 'sql' ? { ...node, sqlSpec: { ...node.sqlSpec, query: sql } } : node.type === 'query' ? { ...node, querySpec: { ...node.querySpec, sql } } : node;

/**
 * `renamed` is `project` with one node given a new name. Returns `renamed` with the SQL of every node reading that
 * node by its old name rewritten: to the new name where the SQL can read the node by it, and to its numbered name
 * (input1, input2...) where it can't, because the SQL already uses that word or another input has the name.
 */
export function renameInSql(project: Project, renamed: Project, nodeId: string): Project {
  const before = nodeById(project, nodeId)?.name;
  const after = nodeById(renamed, nodeId)?.name;
  if (before == null || after == null || before === after) return renamed;
  const readers = new Set(project.edges.filter((e) => e.from.nodeId === nodeId).map((e) => e.to.nodeId));
  const nodes = renamed.nodes.map((reader) => {
    const sql = readers.has(reader.id) ? sqlOf(reader) : undefined;
    if (sql == null) return reader;
    const was = namesByPort(project, reader);
    const now = namesByPort(renamed, reader);
    let next = sql;
    for (const edge of inputEdges(project, reader.id)) {
      if (edge.from.nodeId !== nodeId) continue;
      const port = edge.to.port as number;
      if (!was.get(port)?.includes(before)) continue;
      const usable = now.get(port)?.includes(after) && (after.toLowerCase() === before.toLowerCase() || !sqlUsesName(next, after));
      next = renameTableInSql(next, [...was.values()].flat(), before, usable ? after : `input${port + 1}`);
    }
    return next === sql ? reader : withSql(reader, next);
  });
  return nodes.some((n, i) => n !== renamed.nodes[i]) ? { ...renamed, nodes } : renamed;
}
