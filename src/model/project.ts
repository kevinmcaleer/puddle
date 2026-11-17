import { DEFAULT_PROJECT_NAME } from './projectName';
import { newId } from './ids';
import { pruneGroups } from './groups';
import { FORMAT_VERSION, ProjectZ, type Project } from './schema';

export function createProject(name = DEFAULT_PROJECT_NAME, at: Date = new Date()): Project {
  const iso = at.toISOString();
  return ProjectZ.parse({ id: newId('p'), name, formatVersion: FORMAT_VERSION, createdAt: iso, updatedAt: iso, settings: { queriesInPanel: true } });
}

/** Validate and normalise a project from JSON (defaults filled in, groups naming missing nodes tidied). Throws a ZodError when it doesn't fit. */
export function parseProject(data: unknown): Project {
  return pruneGroups(ProjectZ.parse(data));
}
