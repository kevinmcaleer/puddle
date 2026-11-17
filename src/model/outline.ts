// The project as a list, as Access's navigation pane shows a database: its tables, the queries asked of them, and
// its outputs. With `settings.queriesInPanel`, a query that ends a flow is in this list only, off the canvas.
import { isScript } from '../compiler/sqlScript';
import { inputEdges, nodeById, outputEdges, removeNode } from './graph';
import type { GraphNode, Project } from './schema';

/** A question asked of tables: a Query node, or a SQL node whose SQL creates no tables. */
export function isQueryNode(node: GraphNode): boolean {
  if (node.type === 'query') return !(node.querySpec.sql && isScript(node.querySpec.sql));
  return node.type === 'sql' && !isScript(node.sqlSpec.query);
}

/** Whether a query ends its flow: its rows go nowhere, or only to outputs. */
function endsFlow(project: Project, node: GraphNode): boolean {
  return outputEdges(project, node.id).every((e) => nodeById(project, e.to.nodeId)?.type === 'output');
}

/**
 * The nodes not drawn on the canvas: with `queriesInPanel`, each query that ends its flow and the outputs fed by it.
 * A query whose rows feed more steps is part of how a table is made, so it stays.
 */
export function offCanvasIds(project: Project): Set<string> {
  const ids = new Set<string>();
  if (!project.settings.queriesInPanel) return ids;
  for (const n of project.nodes) {
    if (!isQueryNode(n) || !endsFlow(project, n)) continue;
    ids.add(n.id);
    for (const e of outputEdges(project, n.id)) ids.add(e.to.nodeId);
  }
  return ids;
}

/** The project as the canvas draws it: without the nodes that are off it, their wires, and their places in groups. */
export function canvasProject(project: Project): Project {
  const off = offCanvasIds(project);
  let next = project;
  for (const id of off) next = removeNode(next, id);
  return next;
}

/** Whether moving queries to the panel would take anything off the canvas: for offering it on a project that hasn't. */
export const hasQueriesToMove = (project: Project): boolean => !project.settings.queriesInPanel && offCanvasIds({ ...project, settings: { ...project.settings, queriesInPanel: true } }).size > 0;

export const setQueriesInPanel = (project: Project, queriesInPanel: boolean): Project => ({ ...project, settings: { ...project.settings, queriesInPanel } });

export interface OutlineRow {
  node: GraphNode;
  /** The names of the nodes a query reads, in input order. */
  reads?: string[];
  /** Listed here only: not drawn on the canvas. */
  offCanvas: boolean;
}

export interface Outline {
  tables: OutlineRow[];
  queries: OutlineRow[];
  outputs: OutlineRow[];
}

/** A node that holds a table people would name: one imported, created with SQL or designed, a combination, or the end of a run of steps. */
function isTableNode(project: Project, node: GraphNode): boolean {
  if (node.type === 'source' || node.type === 'scriptTable' || node.type === 'table' || node.type === 'join' || node.type === 'append' || node.type === 'lookup') return true;
  // The last Transform of a chain: the cleaned table. One with another step after it is on the way there.
  if (node.type === 'transform') return !outputEdges(project, node.id).some((e) => nodeById(project, e.to.nodeId)?.type === 'transform');
  // A query whose rows feed more steps makes a table, as does a script's own last statement; neither is listed as one.
  return false;
}

/** The project's tables, queries and outputs, each in the order they were added. */
export function projectOutline(project: Project): Outline {
  const off = offCanvasIds(project);
  const row = (node: GraphNode): OutlineRow => ({ node, offCanvas: off.has(node.id) });
  const names = (id: string) => inputEdges(project, id).flatMap((e) => nodeById(project, e.from.nodeId)?.name ?? []);
  return {
    tables: project.nodes.filter((n) => isTableNode(project, n)).map(row),
    queries: project.nodes.filter(isQueryNode).map((n) => ({ ...row(n), reads: names(n.id) })),
    outputs: project.nodes.filter((n) => n.type === 'output').map(row),
  };
}

/** How many queries read each node: for the mark on a table's card. */
export function readByQueries(project: Project): Map<string, number> {
  const counts = new Map<string, number>();
  for (const n of project.nodes) {
    if (!isQueryNode(n)) continue;
    for (const from of new Set(inputEdges(project, n.id).map((e) => e.from.nodeId))) counts.set(from, (counts.get(from) ?? 0) + 1);
  }
  return counts;
}
