import type { Position, Project } from './schema';

/** Replace the project's DBML. */
export function setSchemaDbml(p: Project, dbml: string): Project {
  return p.schema.dbml === dbml ? p : { ...p, schema: { ...p.schema, dbml } };
}

/** Move diagram elements, by key; the others keep their places. */
export function moveSchemaElements(p: Project, moves: Record<string, Position>): Project {
  const changed = Object.entries(moves).some(([k, at]) => p.schema.positions[k]?.x !== at.x || p.schema.positions[k]?.y !== at.y);
  return changed ? { ...p, schema: { ...p.schema, positions: { ...p.schema.positions, ...moves } } } : p;
}

/**
 * A diagram edit: the DBML changed, a renamed table's place (and the Schema table nodes holding it) following its new
 * name, and new elements placed. One project change, so one undo step restores the text and the diagram together.
 */
export function editSchema(p: Project, dbml: string, also: { renamed?: { from: string; to: string }; places?: Record<string, Position> } = {}): Project {
  let positions = p.schema.positions;
  let nodes = p.nodes;
  const { renamed, places } = also;
  if (renamed && renamed.from !== renamed.to) {
    const { [renamed.from]: at, ...rest } = positions;
    positions = at ? { ...rest, [renamed.to]: at } : rest;
    // Diagram ids are `table:schema.name`.
    const [from, to] = [renamed.from, renamed.to].map((id) => id.replace(/^table:/, ''));
    nodes = nodes.map((n) => (n.type === 'table' && `${n.tableSpec.schema}.${n.tableSpec.table}` === from ? { ...n, tableSpec: { ...n.tableSpec, table: to!.slice(n.tableSpec.schema.length + 1) } } : n));
  }
  if (places) positions = { ...positions, ...places };
  return { ...p, nodes, schema: { ...p.schema, dbml, positions } };
}
