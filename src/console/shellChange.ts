// Where the shell keeps a table it makes or changes: in a SQL node's script, so the table is a node on the canvas and
// the project keeps how it was made. Pure: the console applies the plan as one undo step.
import { positionAfter } from '../app/actions';
import { INPUT_NAME, isScript, scriptTables, splitScript, sqlProblem, sqlReads } from '../compiler';
import { addNode, inputEdges, nodeById, outputEdges, removeNodes, setSqlAndWires, syncScriptTables, type GraphNode, type Project } from '../model';

type SqlNode = Extract<GraphNode, { type: 'sql' }>;

/** One statement's effect, for the shell to say what happened and show the table. */
export interface ShellTouch {
  /** The table, as written. */
  table: string;
  change: 'create' | 'replace' | 'declare' | 'insert' | 'update' | 'delete' | 'alter' | 'rename' | 'drop';
  /** The old name, for a rename. */
  from?: string;
}

export interface ShellChangePlan {
  project: Project;
  /** The SQL node holding the script. */
  hostId: string;
  /** True when the plan adds that SQL node. */
  created: boolean;
  touched: ShellTouch[];
}

const lower = (s: string) => s.toLowerCase();
const scriptNodes = (project: Project) => project.nodes.filter((n): n is SqlNode => n.type === 'sql' && isScript(n.sqlSpec.query));
const makers = (project: Project, table: string) => scriptNodes(project).filter((n) => scriptTables(n.sqlSpec.query).some((t) => lower(t) === lower(table)));

/** The script table node a SQL node keeps a table in. */
export function tableNodeOf(project: Project, hostId: string, table: string): string | undefined {
  return outputEdges(project, hostId)
    .map((e) => nodeById(project, e.to.nodeId))
    .find((n) => n?.type === 'scriptTable' && lower(n.scriptTable.table) === lower(table))?.id;
}

/** A script with these statements after it, so it reads as one. */
const joined = (script: string, statements: string[]) => [script.replace(/[\s;]+$/, ''), ...statements].filter((s) => s.trim()).join(';\n');

/** The host's script with the statements added, its wires and table nodes kept in step; undefined if it can't run. */
function append(project: Project, hostId: string, statements: string[], fresh = false): { project: Project; problem?: string } {
  const host = nodeById(project, hostId) as SqlNode;
  // A new node's query is only a starting point: the statements take its place.
  const query = joined(fresh ? '' : host.sqlSpec.query, statements);
  const before = fresh ? [] : scriptTables(host.sqlSpec.query);
  let next = syncScriptTables(setSqlAndWires(project, hostId, query), hostId, before, scriptTables(query));
  // A table dropped takes its node with it, unless something reads that node.
  const left = new Set(scriptTables(query).map(lower));
  const gone = outputEdges(next, hostId)
    .map((e) => nodeById(next, e.to.nodeId))
    .filter((n): n is Extract<GraphNode, { type: 'scriptTable' }> => n?.type === 'scriptTable' && !left.has(lower(n.scriptTable.table)) && !outputEdges(next, n.id).length);
  if (gone.length) next = removeNodes(next, gone.map((n) => n.id));
  return { project: next, problem: sqlProblem(next, hostId) };
}

/** A new SQL node for the statements: wired from the viewed node when they read `input`, else from nothing. */
function fresh(project: Project, statements: string[], viewedId: string | undefined): { project: Project; hostId: string; problem?: string } {
  const readsInput = statements.some((s) => sqlReads(s).includes(INPUT_NAME));
  const feeds = readsInput && viewedId ? [viewedId] : [];
  const added = addNode(project, 'sql', positionAfter(project, feeds), feeds);
  const hostId = added.nodes[added.nodes.length - 1]!.id;
  return { ...append(added, hostId, statements, true), hostId };
}

function touches(statements: string[]): ShellTouch[] | { problem: string } {
  const split = splitScript(statements.join(';\n'));
  if ('problem' in split) return split;
  return split.statements.map((s, i) => {
    const replace = /^\s*create\s+or\s+replace\b/i.test(statements[i] ?? '');
    const change = s.change ?? (replace ? 'replace' : 'create');
    return { table: s.label ?? s.drops ?? '', change, ...(s.change === 'rename' ? { from: s.drops } : {}) };
  });
}

/**
 * Plan statements that make or change tables (CREATE TABLE, INSERT, UPDATE, DELETE, ALTER TABLE, DROP TABLE): they go
 * into the script of the SQL node that makes the table they change, or for a new table, the shell's own SQL node
 * (`hostId`) when they fit there, else a new SQL node after the viewed one. Says why when they can't run.
 */
export function planShellChange(project: Project, statements: string[], viewedId: string | undefined, hostId: string | undefined): ShellChangePlan | { problem: string } {
  const touched = touches(statements);
  if ('problem' in touched) return touched;
  const first = touched[0];
  if (!first) return { problem: 'write a statement, such as CREATE TABLE name AS SELECT ...' };
  const nodeNamed = (table: string) => project.nodes.find((n) => lower(n.name) === lower(table));
  const changes = !['create', 'replace', 'declare'].includes(first.change);
  const target = changes ? (first.from ?? first.table) : first.table;
  const owners = makers(project, target);
  if (owners.length > 1) return { problem: `${owners.map((n) => n.name).join(' and ')} each make a table called ${target}: change it in the SQL node you mean` };
  if (changes && !owners.length) {
    const node = nodeNamed(target);
    if (node) return { problem: `${node.name} is a node of the project, which the shell reads but can’t change: make a table of your own from it first, CREATE TABLE my_${lower(target).replace(/\W+/g, '_')} AS SELECT * FROM ${/^[A-Za-z_]\w*$/.test(node.name) ? node.name : `"${node.name}"`}` };
    return { problem: `there’s no table ${target}: make it first with CREATE TABLE ${target} AS SELECT ...` };
  }
  if (!changes && owners.length && first.change !== 'replace') return { problem: `${target} already exists: write CREATE OR REPLACE TABLE ${target} to make it again` };
  if (!changes && !owners.length) {
    const node = nodeNamed(target);
    if (node) return { problem: `${node.name} is already the name of a node: give the table another name` };
  }
  // The table is made already: its own script changes it.
  if (owners.length) {
    const r = append(project, owners[0]!.id, statements);
    return r.problem ? { problem: r.problem } : { project: r.project, hostId: owners[0]!.id, created: false, touched };
  }
  // A new table: in the shell's SQL node when the statements run there, else in a new one.
  const host = hostId ? nodeById(project, hostId) : undefined;
  if (host?.type === 'sql' && (isScript(host.sqlSpec.query) || !host.sqlSpec.query.trim())) {
    const readsInput = statements.some((s) => sqlReads(s).includes(INPUT_NAME));
    const wiredToViewed = inputEdges(project, host.id).some((e) => !e.byName && e.from.nodeId === viewedId);
    if (!readsInput || wiredToViewed) {
      const r = append(project, host.id, statements);
      if (!r.problem) return { project: r.project, hostId: host.id, created: false, touched };
    }
  }
  const r = fresh(project, statements, viewedId);
  return r.problem ? { problem: r.problem } : { project: r.project, hostId: r.hostId, created: true, touched };
}
