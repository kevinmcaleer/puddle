// Queries read tables by name: a SQL node's query that names another node of the project is wired from it, so nobody
// draws a wire for what the SQL already says. Pure edits; the compiler reads these wires like any other.
import { sqlReads } from '../compiler/sqlScript';
import { setSqlQuery } from './edits';
import { downstreamIds, freePort, hasOutput, inputEdges, nodeById } from './graph';
import { newId } from './ids';
import type { Project } from './schema';

const INPUT = /^input\d*$/;

/**
 * Keep a SQL node's by-name wires in step with the table names its query reads (`reads`, as written, in any case):
 * a name that is one other node's, and not yet wired in, gets a wire into the next free input; a by-name wire whose
 * node the query no longer reads (by name or as inputN) goes. Wires drawn by hand are never touched. A name is left
 * alone when two nodes share it, when its node is fed by this one (a loop), and when the query reads plain `input`,
 * which stops meaning anything once a second table is wired in.
 */
export function syncNamedWires(project: Project, nodeId: string, reads: readonly string[]): Project {
  const node = nodeById(project, nodeId);
  if (node?.type !== 'sql') return project;
  const names = [...new Set(reads.map((r) => r.toLowerCase()))];
  const read = new Set(names);
  const nameOf = (id: string) => nodeById(project, id)?.name.toLowerCase() ?? '';
  // Gone: by-name wires the query no longer reads.
  const stale = inputEdges(project, nodeId).filter((e) => e.byName && !read.has(nameOf(e.from.nodeId)) && !read.has(`input${Number(e.to.port) + 1}`));
  let next: Project = stale.length ? { ...project, edges: project.edges.filter((e) => !stale.includes(e)) } : project;
  if (read.has('input')) return next;
  const fed = downstreamIds(next, nodeId);
  for (const name of names) {
    if (INPUT.test(name)) continue;
    if (inputEdges(next, nodeId).some((e) => nameOf(e.from.nodeId) === name)) continue;
    const found = next.nodes.filter((n) => n.name.toLowerCase() === name && hasOutput(n));
    if (found.length !== 1 || fed.has(found[0]!.id)) continue;
    const port = freePort(next, nodeId);
    if (port == null) break;
    next = { ...next, edges: [...next.edges, { id: newId('e'), from: { nodeId: found[0]!.id }, to: { nodeId, port }, byName: true }] };
  }
  return next;
}

/** Change what a SQL node runs, and wire in (or let go of) the tables of the project its query names. */
export const setSqlAndWires = (project: Project, nodeId: string, query: string): Project => syncNamedWires(setSqlQuery(project, nodeId, query), nodeId, sqlReads(query));
