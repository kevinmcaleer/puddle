// Where the runner finds a project's source files. Pure: the file system comes in as a function.
import { basename, isAbsolute, join } from 'node:path';
import type { Project, Source } from '../model';

export type SourcePlace = { source: Source; path: string } | { source: Source; path?: undefined; reason: string };

/** The places a file source may be, best first: its runner path, then its original name beside the project file or under sources/. */
export function sourceCandidates(source: Source, folder: string): string[] {
  const file = source.file;
  if (!file) return [];
  const paths: string[] = [];
  if (file.path) paths.push(isAbsolute(file.path) ? file.path : join(folder, file.path));
  const name = basename(file.originalName);
  if (name) paths.push(join(folder, name), join(folder, 'sources', name));
  return [...new Set(paths)];
}

/** Each source with the path the runner will read it from, or why it can't. */
export function placeSources(project: Project, folder: string, exists: (path: string) => boolean): SourcePlace[] {
  return project.sources.map((source): SourcePlace => {
    if (source.kind === 'clipboard') return source.clipboard ? { source, path: '' } : { source, reason: 'has no pasted text' };
    if (source.kind === 'connection') return { source, reason: 'reads a database, which the runner can’t do yet' };
    if (source.url?.table) return { source, reason: 'is a table on a web page, which the runner can’t read yet' };
    if (source.url?.odata?.auth) return { source, reason: 'is an OData feed that needs a sign-in, which the runner can’t give yet' };
    if (source.kind === 'url') return source.url ? { source, path: source.url.href } : { source, reason: 'has no address' };
    const candidates = sourceCandidates(source, folder);
    const found = candidates.find(exists);
    if (found) return { source, path: found };
    return { source, reason: candidates.length ? `was not found at ${candidates.join(' or ')}` : 'has no file' };
  });
}
