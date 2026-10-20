// Pure edits to a project's database connections. Secrets never pass through here: they live in src/connections/secrets.
import type { Connection, Project } from './schema';

/** Add a connection, or replace the one with its id. */
export function addConnection(project: Project, connection: Connection): Project {
  const known = project.connections.some((c) => c.id === connection.id);
  return { ...project, connections: known ? project.connections.map((c) => (c.id === connection.id ? connection : c)) : [...project.connections, connection] };
}

export function updateConnection(project: Project, id: string, patch: Partial<Omit<Connection, 'id'>>): Project {
  return { ...project, connections: project.connections.map((c) => (c.id === id ? { ...c, ...patch } : c)) };
}

/** The sources that read through a connection, which keep it from being removed. */
export const connectionSources = (project: Project, id: string) => project.sources.filter((s) => s.kind === 'connection' && s.connection?.connectionId === id);

/** Remove a connection no source reads through. One that is read is left as it is (remove its sources first). */
export function removeConnection(project: Project, id: string): Project {
  if (connectionSources(project, id).length) return project;
  return { ...project, connections: project.connections.filter((c) => c.id !== id) };
}

/** "PostgreSQL 2": the next free name for a connection. */
export function nextConnectionName(project: Project, base: string): string {
  const used = new Set(project.connections.map((c) => c.name));
  if (!used.has(base)) return base;
  for (let i = 2; ; i++) if (!used.has(`${base} ${i}`)) return `${base} ${i}`;
}
