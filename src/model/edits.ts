// Pure project edits used by the canvas, sources and inspector. Each returns a new project.
import { freePort, hasOutput, nodeById, removeNode } from './graph';
import { newId } from './ids';
import { viewWithout } from './view';
import { DEFAULT_APPEND_SPEC, DEFAULT_JOIN_SPEC, DEFAULT_LOOKUP_SPEC, DEFAULT_QUERY_SPEC, DEFAULT_SQL_SPEC, type FileSet, type GraphNode, type NodeType, type ParseOptions, type Project, type Source, type TableSpec } from './schema';

type Position = { x: number; y: number };

const KIND_NAME: Record<NodeType, string> = { source: 'Source', transform: 'Transform', join: 'Join', append: 'Append', lookup: 'Lookup', query: 'Query', sql: 'SQL', scriptTable: 'Script table', table: 'Table', output: 'Output' };

/** "Transform 3": the next free number for a node type. */
export function nextNodeName(project: Project, type: NodeType): string {
  const base = KIND_NAME[type];
  const used = new Set(project.nodes.map((n) => n.name));
  for (let i = 1; ; i++) if (!used.has(`${base} ${i}`)) return `${base} ${i}`;
}

/** Add a source and the Source node that reads it, and view it unless the results table is pinned. */
export function addSource(project: Project, source: Source, position: Position, nodeId = newId('n')): Project {
  const node: GraphNode = { id: nodeId, type: 'source', name: source.name, sourceId: source.id, position, rules: [] };
  const view = project.view.pinned ? project.view : { ...project.view, viewedNodeId: nodeId, viewedStepIndex: undefined };
  return { ...project, sources: [...project.sources, source], nodes: [...project.nodes, node], view };
}

export type AddableNodeType = Exclude<NodeType, 'source' | 'scriptTable'>;

function newNode(type: AddableNodeType, base: { id: string; name: string; position: Position; rules: [] }): GraphNode {
  switch (type) {
    case 'transform':
      return { ...base, type, steps: [] };
    case 'join':
      return { ...base, type, joinSpec: { ...DEFAULT_JOIN_SPEC, keys: [] } };
    case 'append':
      return { ...base, type, appendSpec: { ...DEFAULT_APPEND_SPEC } };
    case 'lookup':
      return { ...base, type, lookupSpec: { ...DEFAULT_LOOKUP_SPEC, keys: [], columns: [] } };
    case 'query':
      return { ...base, type, querySpec: { ...DEFAULT_QUERY_SPEC, tables: [], joins: [], fields: [] } };
    case 'sql':
      return { ...base, type, sqlSpec: { ...DEFAULT_SQL_SPEC } };
    case 'table':
      return { ...base, type, tableSpec: { schema: 'public', table: '', examples: true, mapping: {} } };
    case 'output':
      return { ...base, type, outputSpec: { format: 'csv', options: {} } };
  }
}

/** Change what a SQL node runs. */
/** Where the runner finds a file source, or nothing to go back to looking it up by name. */
export function setRunnerPath(project: Project, sourceId: string, path: string): Project {
  return { ...project, sources: project.sources.map((s) => (s.id === sourceId && s.file ? { ...s, file: { ...s.file, path: path || undefined } } : s)) };
}

export function setSqlQuery(project: Project, nodeId: string, query: string): Project {
  return { ...project, nodes: project.nodes.map((n) => (n.id === nodeId && n.type === 'sql' ? { ...n, sqlSpec: { ...n.sqlSpec, query } } : n)) };
}

/**
 * Point a Schema table node at a table of the schema, or change how rows load into it. A node still called by its
 * default name ("Table 2") takes the table's name when it is given one.
 */
export function setTableSpec(project: Project, nodeId: string, patch: Partial<TableSpec>): Project {
  const used = new Set(project.nodes.filter((n) => n.id !== nodeId).map((n) => n.name));
  const named = (name: string) => {
    for (let i = 1; ; i++) if (!used.has(i === 1 ? name : `${name} ${i}`)) return i === 1 ? name : `${name} ${i}`;
  };
  return {
    ...project,
    nodes: project.nodes.map((n) => {
      if (n.id !== nodeId || n.type !== 'table') return n;
      const tableSpec = { ...n.tableSpec, ...patch };
      // A different table has different columns: the old mapping means nothing to it.
      if (patch.table != null && patch.table !== n.tableSpec.table && !patch.mapping) tableSpec.mapping = {};
      const rename = patch.table && /^Table \d+$/.test(n.name);
      return { ...n, tableSpec, ...(rename ? { name: named(patch.table!) } : {}) };
    }),
  };
}

/**
 * Add a Transform, Join, Append, Lookup, Query, SQL or Output node. `after` names the nodes that feed it, wired into its free
 * inputs in order (a Join's left, then its right; an Append's 1, 2, 3...; a Lookup's main, then its lookup); nodes with no output, and any
 * beyond its inputs, are left unwired.
 */
export function addNode(project: Project, type: AddableNodeType, position: Position, after?: string | string[], nodeId = newId('n')): Project {
  const node = newNode(type, { id: nodeId, name: nextNodeName(project, type), position, rules: [] });
  let next: Project = { ...project, nodes: [...project.nodes, node] };
  const feeds = (Array.isArray(after) ? after : after ? [after] : []).map((id) => nodeById(project, id)).filter((n) => !!n && hasOutput(n));
  for (const from of feeds) {
    const port = freePort(next, nodeId);
    if (port == null) break;
    next = { ...next, edges: [...next.edges, { id: newId('e'), from: { nodeId: from!.id }, to: { nodeId, port } }] };
  }
  return next;
}

export function moveNodes(project: Project, positions: Record<string, Position>): Project {
  if (!Object.keys(positions).length) return project;
  return { ...project, nodes: project.nodes.map((n) => (positions[n.id] ? { ...n, position: positions[n.id]! } : n)) };
}

export function setCollapsed(project: Project, nodeId: string, collapsed: boolean): Project {
  return { ...project, nodes: project.nodes.map((n) => (n.id === nodeId ? { ...n, collapsed } : n)) };
}

/** Keep a node's result in memory (a pinned result), or stop keeping it. An Output node has nothing to keep. */
export function setKeepResult(project: Project, nodeId: string, keep: boolean): Project {
  return {
    ...project,
    nodes: project.nodes.map((n) => {
      if (n.id !== nodeId || n.type === 'output') return n;
      if (keep) return { ...n, pinnedResult: true };
      const { pinnedResult: _, ...rest } = n;
      return rest as typeof n;
    }),
  };
}

/** Remove nodes and their wires, plus sources no longer read by any node. Clears the view of any it pointed at. */
export function removeNodes(project: Project, ids: string[]): Project {
  let p = project;
  for (const id of ids) p = removeNode(p, id);
  const used = new Set(p.nodes.flatMap((n) => (n.type === 'source' ? [n.sourceId] : [])));
  return { ...p, sources: p.sources.filter((s) => used.has(s.id)), view: viewWithout(p) };
}

export function updateSource(project: Project, sourceId: string, patch: Partial<Pick<Source, 'parseOptions' | 'detectedSchema' | 'name' | 'format' | 'file' | 'url' | 'archive' | 'expected'>>): Project {
  return { ...project, sources: project.sources.map((s) => (s.id === sourceId ? { ...s, ...patch } : s)) };
}

export function setParseOptions(project: Project, sourceId: string, parseOptions: ParseOptions): Project {
  return updateSource(project, sourceId, { parseOptions });
}

/** Read a source as another format: its read options start again from the ones given (the sniff's, or none). */
export function setSourceFormat(project: Project, sourceId: string, format: Source['format'], parseOptions: ParseOptions = {}): Project {
  return { ...project, sources: project.sources.map((s) => (s.id === sourceId ? { ...s, format, parseOptions } : s)) };
}

/** A node name not yet used in the project: `name`, else `name 2`, `name 3`... */
function freeName(project: Project, name: string): string {
  const used = new Set(project.nodes.map((n) => n.name.toLowerCase()));
  for (let i = 1; ; i++) {
    const candidate = i === 1 ? name : `${name} ${i}`;
    if (!used.has(candidate.toLowerCase())) return candidate;
  }
}

/**
 * Keep a SQL node's script table nodes in step with the tables its script creates, given the tables before and after
 * an edit (as written, in order): once a script creates two or more, each table it newly creates gets a node of its
 * own, wired from the SQL node and named after it. A table renamed in the script (as many gone as came, in order)
 * takes its node with it. Nodes of tables the script no longer creates stay, and say so, so no wiring is lost.
 */
export function syncScriptTables(project: Project, sqlNodeId: string, before: string[], after: string[]): Project {
  const sql = nodeById(project, sqlNodeId);
  if (sql?.type !== 'sql') return project;
  const lower = (names: string[]) => names.map((n) => n.toLowerCase());
  const [was, now] = [lower(before), lower(after)];
  const own = scriptTableNodes(project, sqlNodeId);
  const has = (table: string) => own.some((n) => n.scriptTable.table.toLowerCase() === table);
  let next = project;
  // Renamed: the nodes of the tables that went take the names of the ones that came, in order.
  const gone = was.filter((t) => !now.includes(t) && has(t));
  const came = after.filter((t) => !was.includes(t.toLowerCase()) && !has(t.toLowerCase()));
  if (gone.length && gone.length === came.length) {
    next = {
      ...next,
      nodes: next.nodes.map((n) => {
        if (n.type !== 'scriptTable' || !own.includes(n)) return n;
        const at = gone.indexOf(n.scriptTable.table.toLowerCase());
        if (at < 0) return n;
        const table = came[at]!;
        const renamed = n.name.toLowerCase() === n.scriptTable.table.toLowerCase() ? freeName({ ...next, nodes: next.nodes.filter((x) => x.id !== n.id) }, table) : n.name;
        return { ...n, name: renamed, scriptTable: { table } };
      }),
    };
    return next;
  }
  if (after.length < 2) return next;
  // Every table once the script makes more than one; after that, the ones it newly makes.
  return addScriptTableNodes(next, sqlNodeId, after.filter((t) => before.length < 2 || !was.includes(t.toLowerCase())));
}

/** The script table nodes wired from a SQL node. */
const scriptTableNodes = (project: Project, sqlNodeId: string) =>
  project.nodes.filter((n): n is Extract<GraphNode, { type: 'scriptTable' }> => n.type === 'scriptTable' && project.edges.some((e) => e.from.nodeId === sqlNodeId && e.to.nodeId === n.id));

/** Add a node for each of these tables of a SQL node's script that has none, wired from it and stacked to its right. */
export function addScriptTableNodes(project: Project, sqlNodeId: string, tables: string[]): Project {
  const sql = nodeById(project, sqlNodeId);
  if (sql?.type !== 'sql') return project;
  const own = scriptTableNodes(project, sqlNodeId);
  const wanted = tables.filter((t, i) => !own.some((n) => n.scriptTable.table.toLowerCase() === t.toLowerCase()) && tables.findIndex((x) => x.toLowerCase() === t.toLowerCase()) === i);
  const below = own.length ? Math.max(...own.map((n) => n.position.y)) + 120 : sql.position.y;
  let next = project;
  wanted.forEach((table, i) => {
    const id = newId('n');
    const node: GraphNode = { id, type: 'scriptTable', name: freeName(next, table), position: { x: sql.position.x + 296, y: below + i * 120 }, rules: [], scriptTable: { table } };
    next = { ...next, nodes: [...next.nodes, node], edges: [...next.edges, { id: newId('e'), from: { nodeId: sqlNodeId }, to: { nodeId: id, port: 0 } }] };
  });
  return next;
}

/** Point a script table node at another of its script's tables, taking the table's name if it still had the old one's. */
export function setScriptTable(project: Project, nodeId: string, table: string): Project {
  const node = nodeById(project, nodeId);
  if (node?.type !== 'scriptTable' || node.scriptTable.table === table) return project;
  const rename = node.name.toLowerCase() === node.scriptTable.table.toLowerCase() || !node.scriptTable.table;
  const name = rename ? freeName({ ...project, nodes: project.nodes.filter((n) => n.id !== nodeId) }, table) : node.name;
  return { ...project, nodes: project.nodes.map((n) => (n.id === nodeId ? { ...node, name, scriptTable: { table } } : n)) };
}

/** Change a file set's files, pattern, file column or runner folder. */
export function setFileSet(project: Project, sourceId: string, patch: Partial<FileSet>): Project {
  return { ...project, sources: project.sources.map((s) => (s.id === sourceId && s.fileSet ? { ...s, fileSet: { ...s.fileSet, ...patch } } : s)) };
}
