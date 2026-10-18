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
