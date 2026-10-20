// The canvas as a schema, for the Schema view to document next to the DBML, as Access documents every table and query
// of a database: each source as a table, each Query, SQL, Join, Lookup and Append node as a query, and each chain of
// Transform nodes as a view of what it reads, with the relationships the Relationships view finds as refs. It's drawn
// from the project as it is, never written into the DBML.
import { designSql, queryProblems } from '../compiler';
import { operator } from '../relationships/dbml';
import { cardinality, findRelationships, keyEnds, type ColumnsOf, type Uniqueness } from '../relationships/model';
import { inputEdge, inputEdges, nodeById, outputEdges, type GraphNode, type Project } from '../model';
import { tableId } from './diagram/geometry';
import { TONE_HEX } from './diagram/palette';
import { DEFAULT_SCHEMA, type Column, type DbmlSchema, type Ref, type Table, type TableGroup } from './model';

/** What a canvas node is documented as. */
export type CanvasKind = 'table' | 'query' | 'view';

/** The groups canvas nodes are drawn in, by what they are. */
export const CANVAS_GROUPS: Record<CanvasKind, string> = { table: 'Canvas tables', query: 'Canvas queries', view: 'Canvas views' };

/** Each kind in the colour its nodes have on the canvas: sources blue, combining nodes purple, transforms teal. */
const CANVAS_COLOR: Record<CanvasKind, string> = { table: TONE_HEX.blue, query: TONE_HEX.purple, view: TONE_HEX.teal };

export interface CanvasSchema {
  /** The canvas's tables, refs and groups only: merge it with the DBML's with `withCanvas`. */
  schema: DbmlSchema;
  /** The node each diagram table (by diagram id) documents, including DBML tables a node is documented by. */
  nodeOf: Map<string, string>;
  /** The diagram ids of the tables drawn from the canvas, which can't be edited as DBML. */
  derived: Set<string>;
}

const QUERY_TYPES = new Set(['query', 'sql', 'join', 'lookup', 'append']);

/** A transform that ends its chain: nothing it feeds is another Transform. */
const endsChain = (project: Project, node: GraphNode) => node.type === 'transform' && !outputEdges(project, node.id).some((e) => nodeById(project, e.to.nodeId)?.type === 'transform');

function kindOf(project: Project, node: GraphNode, ends: Set<string>): CanvasKind | undefined {
  if (node.type === 'source') return 'table';
  if (QUERY_TYPES.has(node.type)) return 'query';
  if (node.type === 'transform' && (endsChain(project, node) || ends.has(node.id))) return 'view';
  return undefined;
}

const nameOf = (project: Project, id: string | undefined) => (id ? (nodeById(project, id)?.name ?? id) : 'nothing');
const list = (names: string[]) => (names.length < 2 ? (names[0] ?? 'nothing') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`);

/** What the node does, in a sentence or two (and its SQL, for a query): the note its table carries. */
function describe(project: Project, node: GraphNode, columnsOf: ColumnsOf): string {
  const inputs = inputEdges(project, node.id).map((e) => nameOf(project, e.from.nodeId));
  const fed = (port: 'left' | 'right' | 'main' | 'lookup') => nameOf(project, inputEdge(project, node.id, port)?.from.nodeId);
  const notes = node.notes?.trim() ? `\n\n${node.notes.trim()}` : '';
  switch (node.type) {
    case 'source': {
      const source = project.sources.find((s) => s.id === node.sourceId);
      const from = source?.file?.originalName ?? source?.url?.href ?? source?.name;
      return `Source${from ? `: ${from}` : ''}.${notes}`;
    }
    case 'query': {
      if (node.querySpec.sql != null) return `Query of ${list(inputs)}, as written:\n\n${node.querySpec.sql}${notes}`;
      const tables = inputEdges(project, node.id)
        .filter((e) => typeof e.to.port === 'number')
        .map((e) => ({ port: e.to.port as number, label: nameOf(project, e.from.nodeId), columns: columnsOf(e.from.nodeId) }));
      const known = tables.every((t) => t.columns);
      const design = tables.map((t) => ({ ...t, columns: t.columns ?? [] }));
      const sql = known && tables.length && !queryProblems(node.querySpec, design).length ? `\n\n${designSql(node.querySpec, design)}` : '';
      return `Query of ${list(inputs)}.${sql}${notes}`;
    }
    case 'sql':
      return `SQL over ${list(inputs)}:\n\n${node.sqlSpec.query}${notes}`;
    case 'join': {
      const on = node.joinSpec.keys.map((k) => `${k.left} = ${k.right}`).join(', ');
      return `${node.joinSpec.kind[0]!.toUpperCase()}${node.joinSpec.kind.slice(1)} join of ${fed('left')} and ${fed('right')}${on ? ` on ${on}` : ''}.${notes}`;
    }
    case 'lookup': {
      const on = node.lookupSpec.keys.map((k) => `${k.main} = ${k.lookup}`).join(', ');
      return `Looks up ${fed('main')} in ${fed('lookup')}${on ? ` on ${on}` : ''}.${notes}`;
    }
    case 'append':
      return `Appends ${list(inputs)}.${notes}`;
    case 'transform': {
      // The steps of the whole chain, from the node it starts on.
      const steps: string[] = [];
      let at: GraphNode | undefined = node;
      const seen = new Set<string>();
      while (at?.type === 'transform' && !seen.has(at.id)) {
        seen.add(at.id);
        steps.unshift(...at.steps.map((s) => s.label));
        at = nodeById(project, inputEdge(project, at.id, 0)?.from.nodeId ?? '');
      }
      return `View of ${at?.name ?? 'nothing yet'}${steps.length ? `: ${steps.join('; ')}` : ', with no steps'}.${notes}`;
    }
    default:
      return notes.trim();
  }
}

const column = (name: string, type: string, unique: boolean): Column => ({ name, type, pk: false, unique, increment: false, checks: [], properties: {} });

/**
 * The canvas as a schema: a table for every source, query and view, with its columns as they are known (none until
 * the node has run), and a ref for every relationship the project states. A node with the name of a table the DBML
 * designs is documented by that table, as is a Schema table node, so writing a node into the DBML takes it over.
 */
export function canvasSchema(project: Project, designed: DbmlSchema, columnsOf: ColumnsOf, unique: Uniqueness = {}): CanvasSchema {
  const relationships = findRelationships(project, columnsOf);
  const ends = new Set(relationships.flatMap((r) => [r.from.nodeId, r.to.nodeId]));
  const keys = keyEnds(relationships, unique);
  const designedNames = new Set(designed.tables.filter((t) => t.schema === DEFAULT_SCHEMA).map((t) => t.name));
  const used = new Set([...designedNames].map((n) => n.toLowerCase()));
  /** Each node's table, as the schema names it. */
  const tableOf = new Map<string, { schema: string; name: string }>();
  const nodeOf = new Map<string, string>();
  const derived = new Set<string>();
  const tables: Table[] = [];
  const members: Record<CanvasKind, Array<{ schema: string; name: string }>> = { table: [], query: [], view: [] };

  for (const n of project.nodes) {
    if (n.type === 'table') {
      const t = designed.tables.find((x) => x.schema === n.tableSpec.schema && x.name === n.tableSpec.table);
      if (t) tableOf.set(n.id, { schema: t.schema, name: t.name });
      continue;
    }
    const kind = kindOf(project, n, ends);
    if (!kind) continue;
    if (designedNames.has(n.name)) {
      tableOf.set(n.id, { schema: DEFAULT_SCHEMA, name: n.name });
      continue;
    }
    let name = n.name || n.id;
    for (let i = 2; used.has(name.toLowerCase()); i++) name = `${n.name || n.id} ${i}`;
    used.add(name.toLowerCase());
    const at = { schema: DEFAULT_SCHEMA, name };
    tableOf.set(n.id, at);
    members[kind].push(at);
    const cols = columnsOf(n.id);
    tables.push({
      ...at,
      headerColor: CANVAS_COLOR[kind],
      note: describe(project, n, columnsOf) + (cols ? '' : '\n\nIts columns aren’t known yet: the node is still being read, or can’t run.'),
      properties: { kind },
      columns: (cols ?? []).map((c) => column(c.name, c.type, keys.has(`${n.id}:${c.name}`))),
      indexes: [],
      checks: [],
      partials: [],
    });
    derived.add(tableId(at));
  }
  for (const [nodeId, t] of tableOf) nodeOf.set(tableId(t), nodeId);

  const same = (a: { schema: string; table: string; columns: string[] }, b: { schema: string; name: string }, col: string) => a.schema === b.schema && a.table === b.name && a.columns.length === 1 && a.columns[0] === col;
  const refs: Ref[] = [];
  for (const r of relationships) {
    const [from, to] = [tableOf.get(r.from.nodeId), tableOf.get(r.to.nodeId)];
    if (!from || !to) continue;
    // The DBML says it already.
    if (designed.refs.some((x) => (same(x.from, from, r.from.column) && same(x.to, to, r.to.column)) || (same(x.from, to, r.to.column) && same(x.to, from, r.from.column)))) continue;
    refs.push({
      from: { schema: from.schema, table: from.name, columns: [r.from.column] },
      to: { schema: to.schema, table: to.name, columns: [r.to.column] },
      op: operator(cardinality(unique, r, 'from'), cardinality(unique, r, 'to')) as Ref['op'],
      fromOptional: false,
      toOptional: false,
      inactive: false,
      inline: false,
    });
  }

  const groups: TableGroup[] = (Object.keys(members) as CanvasKind[])
    .filter((k) => members[k].length)
    .map((k) => ({ name: CANVAS_GROUPS[k], tables: members[k], color: CANVAS_COLOR[k], properties: {} }));
  return { schema: { tables, refs, enums: [], groups, notes: [], partials: [], records: [], views: [] }, nodeOf, derived };
}

/** The DBML's schema with the canvas's tables, refs and groups after its own. */
export function withCanvas(designed: DbmlSchema, canvas: DbmlSchema): DbmlSchema {
  if (!canvas.tables.length && !canvas.refs.length) return designed;
  return { ...designed, tables: [...designed.tables, ...canvas.tables], refs: [...designed.refs, ...canvas.refs], groups: [...designed.groups, ...canvas.groups] };
}
