import { newId } from './ids';
import { pruneGroups } from './groups';
import { FORMAT_VERSION, ProjectZ, type Project } from './schema';

export function createProject(name = 'Untitled project', at: Date = new Date()): Project {
  const iso = at.toISOString();
  return ProjectZ.parse({ id: newId('p'), name, formatVersion: FORMAT_VERSION, createdAt: iso, updatedAt: iso });
}

/** Validate and normalise a project from JSON (defaults filled in, groups naming missing nodes tidied). Throws a ZodError when it doesn't fit. */
export function parseProject(data: unknown): Project {
  return pruneGroups(ProjectZ.parse(data));
}
