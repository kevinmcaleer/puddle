import type { Position, Project, SchemaView } from './schema';

/** Replace the project's DBML. */
export function setSchemaDbml(p: Project, dbml: string): Project {
  return p.schema.dbml === dbml ? p : { ...p, schema: { ...p.schema, dbml } };
}

/** Move diagram elements, by key; the others keep their places. */
export function moveSchemaElements(p: Project, moves: Record<string, Position>): Project {
  const changed = Object.entries(moves).some(([k, at]) => p.schema.positions[k]?.x !== at.x || p.schema.positions[k]?.y !== at.y);
  return changed ? { ...p, schema: { ...p.schema, positions: { ...p.schema.positions, ...moves } } } : p;
}

/** Views after a table is renamed: it keeps its place in each view that shows it. */
function renameInViews(views: SchemaView[], from: string, to: string): SchemaView[] {
  return views.map((v) => {
    if (!v.tables.includes(from) && !(from in v.positions)) return v;
    const { [from]: at, ...rest } = v.positions;
    return { ...v, tables: v.tables.map((t) => (t === from ? to : t)), positions: at ? { ...rest, [to]: at } : rest };
  });
}

/** Views after an element is deleted: it drops out of every one. */
function dropFromViews(views: SchemaView[], id: string): SchemaView[] {
  return views.map((v) => {
    if (!v.tables.includes(id) && !(id in v.positions)) return v;
    const { [id]: _gone, ...positions } = v.positions;
    return { ...v, tables: v.tables.filter((t) => t !== id), positions };
  });
}

export interface SchemaEditAlso {
  /** A table renamed, by diagram id (`table:schema.name`). */
  renamed?: { from: string; to: string };
  /** New elements' places. In a view they are its own places, and new tables join it. */
  places?: Record<string, Position>;
  /** An element deleted, by diagram id. */
  deleted?: string;
}

/**
 * A diagram edit: the DBML changed, a renamed table's place (in every view, and the Schema table nodes holding it)
 * following its new name, a deleted table dropping out of every view, and new elements placed. One project change, so
 * one undo step restores the text and the diagram together.
 */
export function editSchema(p: Project, dbml: string, also: SchemaEditAlso = {}): Project {
  let { positions, views } = p.schema;
  let nodes = p.nodes;
  const { renamed, places, deleted } = also;
  if (renamed && renamed.from !== renamed.to) {
    const { [renamed.from]: at, ...rest } = positions;
    positions = at ? { ...rest, [renamed.to]: at } : rest;
    views = renameInViews(views, renamed.from, renamed.to);
    // Diagram ids are `table:schema.name`.
    const [from, to] = [renamed.from, renamed.to].map((id) => id.replace(/^table:/, ''));
    nodes = nodes.map((n) => (n.type === 'table' && `${n.tableSpec.schema}.${n.tableSpec.table}` === from ? { ...n, tableSpec: { ...n.tableSpec, table: to!.slice(n.tableSpec.schema.length + 1) } } : n));
  }
  if (deleted) {
    const { [deleted]: _gone, ...rest } = positions;
    positions = rest;
    views = dropFromViews(views, deleted);
  }
  if (places) {
    const open = views.find((v) => v.id === p.schema.view);
    if (open) {
      const added = Object.keys(places).filter((k) => k.startsWith('table:') && !open.tables.includes(k));
      views = views.map((v) => (v === open ? { ...v, tables: [...v.tables, ...added], positions: { ...v.positions, ...places } } : v));
    } else positions = { ...positions, ...places };
  }
  return { ...p, nodes, schema: { ...p.schema, dbml, positions, views } };
}
