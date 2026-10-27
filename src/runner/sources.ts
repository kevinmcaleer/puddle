// Where the runner finds a project's source files. Pure: the file system comes in as a function.
import { basename, isAbsolute, join } from 'node:path';
import { fileSetMembers, globMatches } from '../compiler/fileSet';
import type { FileSetFile, Project, Source } from '../model';
import { placeConnection, type ConnectionPlace, type PlaceOptions } from './connections';

/** A source with where the runner reads it: a path (empty for pasted text), a connection placed with its secret, or why it can't. */
export type SourcePlace = { source: Source; path: string; connection?: ConnectionPlace } | { source: Source; path?: undefined; connection?: undefined; reason: string };

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

/** Lists a folder's files, every subfolder down, as paths inside it with their sizes and times. */
export type ListFolder = (dir: string) => FileSetFile[];

/**
 * The folders a file set may be in, best first: its runner path; else the folder it was chosen as, beside the project
 * file or under sources/; else the project file's folder and its sources/.
 */
export function fileSetCandidates(source: Source, folder: string): string[] {
  const set = source.fileSet;
  if (!set) return [];
  if (set.path) return [isAbsolute(set.path) ? set.path : join(folder, set.path)];
  const named = set.folder ? [join(folder, set.folder), join(folder, 'sources', set.folder)] : [];
  return [...new Set([...named, folder, join(folder, 'sources')])];
}

/**
 * A file set as the runner reads it from a folder: the folder's files its pattern matches, or, with no pattern, the
 * files of that folder chosen in the browser (by name). Hidden files never count.
 */
export function listedFileSet(source: Source, files: FileSetFile[]): Source {
  const set = source.fileSet!;
  const visible = files.filter((f) => !f.name.split('/').some((part) => part.startsWith('.')));
  const pattern = set.pattern?.trim();
  const chosen = new Set(set.files.map((f) => f.name.toLowerCase()));
  const found = pattern ? visible.filter((f) => globMatches(pattern, f.name)) : visible.filter((f) => chosen.has(f.name.toLowerCase()));
  return { ...source, fileSet: { ...set, files: found.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true })) } };
}

/** Where a file set is on this machine, and the set as read there, or why it can't be found. */
export function placeFileSet(source: Source, folder: string, exists: (path: string) => boolean, list: ListFolder): { dir: string; source: Source } | { reason: string } {
  const candidates = fileSetCandidates(source, folder).filter(exists);
  for (const dir of candidates) {
    const listed = listedFileSet(source, list(dir));
    if (fileSetMembers(listed).length) return { dir, source: listed };
  }
  const what = source.fileSet?.pattern ? `no files matching ${source.fileSet.pattern}` : 'none of its files';
  return { reason: `found ${what} in ${fileSetCandidates(source, folder).join(' or ')}` };
}

/** The project with each file set holding the files the runner finds for it, so the SQL reads exactly those. */
export function listFileSets(project: Project, folder: string, exists: (path: string) => boolean, list: ListFolder): Project {
  if (!project.sources.some((s) => s.kind === 'files')) return project;
  return { ...project, sources: project.sources.map((s) => (s.kind === 'files' ? ((p) => ('source' in p ? p.source : s))(placeFileSet(s, folder, exists, list)) : s)) };
}

/** Each source with the path the runner will read it from, or why it can't. Connection sources need `connections` (the secrets and drivers this runner has). */
export function placeSources(project: Project, folder: string, exists: (path: string) => boolean, connections?: PlaceOptions, list: ListFolder = () => []): SourcePlace[] {
  return project.sources.map((source): SourcePlace => {
    if (source.kind === 'files') {
      const placed = placeFileSet(source, folder, exists, list);
      return 'dir' in placed ? { source: placed.source, path: placed.dir } : { source, reason: placed.reason };
    }
    if (source.kind === 'clipboard') return source.clipboard ? { source, path: '' } : { source, reason: 'has no pasted text' };
    if (source.kind === 'connection') {
      if (!connections) return { source, reason: 'reads a database, which this runner was given no secrets or drivers for' };
      const placed = placeConnection(source, project, folder, exists, connections);
      return 'place' in placed ? { source, path: '', connection: placed.place } : { source, reason: placed.reason };
    }
    if (source.url?.table) return { source, reason: 'is a table on a web page, which the runner can’t read yet' };
    if (source.url?.odata?.auth) return { source, reason: 'is an OData feed that needs a sign-in, which the runner can’t give yet' };
    if (source.kind === 'url') return source.url ? { source, path: source.url.href } : { source, reason: 'has no address' };
    const candidates = sourceCandidates(source, folder);
    const found = candidates.find(exists);
    if (found) return { source, path: found };
    return { source, reason: candidates.length ? `was not found at ${candidates.join(' or ')}` : 'has no file' };
  });
}
