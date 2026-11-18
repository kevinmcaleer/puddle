import type { Project } from './schema';

/** What a new project is called until it is named, by hand or after its first source. */
export const DEFAULT_PROJECT_NAME = 'Untitled project';

/** A source's name as a project name: a file without its extension ("sales" from sales.csv.gz), a table as it is. */
export function sourceProjectName(source: { name: string; kind?: string }): string {
  const name = source.name.trim();
  // A database table's name may have a dot of its own (public.orders): only files have extensions.
  if (source.kind === 'connection') return name;
  return name.replace(/\.(gz|zip)$/i, '').replace(/\.[A-Za-z0-9]{1,8}$/, '').trim() || name;
}

/** The name, or the name with the first number that makes it one no other project has ("sales 2"). */
export function freeProjectName(name: string, taken: readonly string[]): string {
  const used = new Set(taken.map((t) => t.toLowerCase()));
  if (!used.has(name.toLowerCase())) return name;
  let n = 2;
  while (used.has(`${name} ${n}`.toLowerCase())) n++;
  return `${name} ${n}`;
}

/**
 * A project still called "Untitled project" is named after its first source, as part of the edit that added it (so
 * undo takes the name back with the source). A project that was named, or already had a source, keeps its name.
 */
export function nameAfterFirstSource(before: Project, after: Project, taken: readonly string[] = []): Project {
  const first = after.sources[0];
  if (before.sources.length > 0 || !first || after.name !== DEFAULT_PROJECT_NAME || before.name !== DEFAULT_PROJECT_NAME) return after;
  const name = sourceProjectName(first);
  return name ? { ...after, name: freeProjectName(name, taken) } : after;
}
