import { create } from 'zustand';
import { isDataEntry, listEntries, readEntry, readEntryHead, type ArchiveEntry, type ArchiveKind } from '../archive';
import { readsCompressed, sourceFileName } from '../compiler';
import type { EngineClient } from '../engine';
import { invalidateCaches } from '../flow/status';
import { addSource, newId, updateSource, useProjectStore, type Project, type Source } from '../model';
import { shareHandle } from './access';
import { engineOrThrow, readByDuckDb, registerSourceFile, rememberFile, sourceFile } from './add';
import { markAttached } from './attachments';
import { SourceError, sourceName } from './detect';
import { openFormatDialog } from './formatDialog';
import { keepHandle, type FileHandle } from './handles';
import { HEAD_BYTES, hashBytes } from './hash';
import { sniff, TAIL_BYTES, type Sniffed } from './sniff';

/**
 * Compressed files and archives (#192). A .gz or .zip chosen as a source is opened for the file inside: the entry is
 * sniffed like any chosen file and read as its own format, so the source is "orders.csv, in orders.zip". A gzipped
 * CSV, TSV or JSON is handed to DuckDB as it is, which unpacks it as it reads (never whole into memory); anything
 * else is unpacked here (src/archive) into a File the format's reader takes. A zip's other files can be added as
 * sources of their own, which share the archive, as the tables of an Access database do.
 */

/** The archives chosen in this tab, by source id: the file picked, which the source's entry is unpacked from. */
const archives = new Map<string, File>();

export const sourceArchive = (sourceId: string) => archives.get(sourceId);

export const isArchiveSource = (s: Source): s is Source & { archive: NonNullable<Source['archive']> } => !!s.archive && s.kind === 'file';

/** What each archive holds, by source id, once listed. */
export const useArchives = create<{ entries: Record<string, ArchiveEntry[]> }>(() => ({ entries: {} }));

/** The entries unpacked from each archive, by name, so sibling sources unpack nothing twice. */
const unpacked = new WeakMap<File, Map<string, Promise<File>>>();

const baseName = (entry: string) => entry.slice(entry.lastIndexOf('/') + 1);

function entryFile(archive: File, kind: ArchiveKind, entry: string): Promise<File> {
  let entries = unpacked.get(archive);
  if (!entries) unpacked.set(archive, (entries = new Map()));
  let file = entries.get(entry);
  if (!file) {
    file = readEntry(archive, kind, entry).then((bytes) => new File([bytes as Uint8Array<ArrayBuffer>], baseName(entry), { lastModified: archive.lastModified }));
    entries.set(entry, file);
    file.catch(() => entries!.delete(entry));
  }
  return file;
}

/** What an entry is: its format and read options, from its first bytes (and, when it is unpacked whole, its last). */
export async function sniffEntry(archive: File, kind: ArchiveKind, entry: string): Promise<Sniffed> {
  const { head, size, tail } = await readEntryHead(archive, kind, entry, HEAD_BYTES, TAIL_BYTES);
  // A gzip read only so far has no known size: the head is not the whole file.
  return sniff({ name: baseName(entry), head, size: size ?? Number.POSITIVE_INFINITY, tail });
}

/** The files an archive holds, with the data files first. */
export async function archiveEntries(archive: File, kind: ArchiveKind): Promise<ArchiveEntry[]> {
  const entries = await listEntries(archive, kind, archive.name);
  if (!entries.length) throw new SourceError(`${archive.name} holds no files.`);
  return entries;
}

/**
 * Give a source's reader the file it reads from the archive: the archive itself where DuckDB unpacks it as it reads,
 * else the entry unpacked. Lists the archive's files for the inspector as it goes.
 */
export async function attachArchive(engine: Pick<EngineClient, 'registerFile'>, source: Source & { archive: NonNullable<Source['archive']> }, archive: File): Promise<void> {
  archives.set(source.id, archive);
  void archiveEntries(archive, source.archive.kind)
    .then((entries) => useArchives.setState((s) => ({ entries: { ...s.entries, [source.id]: entries } })))
    .catch(() => undefined);
  const file = readsCompressed(source) ? archive : await entryFile(archive, source.archive.kind, source.archive.entry);
  rememberFile(source.id, file);
  await registerSourceFile(engine, source, file);
}

/** The source for one entry of an archive, sniffed. */
async function entrySource(archive: File, kind: ArchiveKind, entry: string, headHash: string): Promise<{ source: Source; sniffed: Sniffed }> {
  const sniffed = await sniffEntry(archive, kind, entry);
  const source: Source = {
    id: newId('s'),
    name: sourceName(baseName(entry)),
    kind: 'file',
    format: sniffed.format,
    file: { originalName: archive.name, size: archive.size, lastModified: archive.lastModified, headHash },
    archive: { kind, entry },
    parseOptions: sniffed.parseOptions,
    detectedSchema: [],
  };
  return { source, sniffed };
}

/**
 * Add a .gz or .zip as a source: the first data file inside is read, as the file it is. A zip's other files are
 * offered in the inspector. The archive's own handle is kept, so it reconnects next time.
 */
export async function addArchiveSource(archive: File, kind: ArchiveKind, head: Uint8Array, position = { x: 80, y: 80 }, handle?: FileHandle): Promise<Source> {
  const entries = await archiveEntries(archive, kind);
  const entry = (entries.find((e) => isDataEntry(e.name)) ?? entries[0]!).name;
  const engine = engineOrThrow();
  const { source, sniffed } = await entrySource(archive, kind, entry, await hashBytes(head));
  await attachArchive(engine, source as Source & { archive: NonNullable<Source['archive']> }, archive);
  markAttached(source.id);
  useProjectStore.getState().apply((p) => addSource(p, source, position));
  keepHandle(source.id, handle);
  if (sniffed.confidence === 'unsure') openFormatDialog(source.id, sniffed.reason);
  return source;
}

/** Read another file of the same archive: sniffed afresh, and renamed for it unless the name was changed by hand. */
export async function changeArchiveEntry(sourceId: string, entry: string): Promise<void> {
  const project = useProjectStore.getState().history.present;
  const source = project.sources.find((s) => s.id === sourceId);
  const archive = archives.get(sourceId);
  if (!source || !isArchiveSource(source) || !archive || source.archive.entry === entry) return;
  const sniffed = await sniffEntry(archive, source.archive.kind, entry);
  const engine = engineOrThrow();
  if (readByDuckDb(source.format)) await engine.dropFile(sourceFileName(source)).catch(() => undefined);
  const renamed = source.name === sourceName(baseName(source.archive.entry)) ? sourceName(baseName(entry)) : source.name;
  const next = { ...source, name: renamed, format: sniffed.format, parseOptions: sniffed.parseOptions, archive: { ...source.archive, entry } };
  await attachArchive(engine, next, archive);
  invalidateCaches();
  useProjectStore.getState().apply((p) => {
    const node = p.nodes.find((n) => n.type === 'source' && n.sourceId === sourceId);
    const withSource = updateSource(p, sourceId, { name: renamed, format: sniffed.format, parseOptions: sniffed.parseOptions, archive: next.archive });
    return node && node.name === source.name ? { ...withSource, nodes: withSource.nodes.map((n) => (n.id === node.id ? { ...n, name: renamed } : n)) } : withSource;
  });
  if (sniffed.confidence === 'unsure') openFormatDialog(sourceId, sniffed.reason);
}

/** The archive's files that no source in the project reads from this same archive yet, data files first. */
export function entriesNotAdded(project: Project, source: Source, entries: ArchiveEntry[]): ArchiveEntry[] {
  const archive = archives.get(source.id);
  const taken = new Set(project.sources.filter((s) => isArchiveSource(s) && archives.get(s.id) === archive).map((s) => s.archive!.entry));
  return entries.filter((e) => !taken.has(e.name) && isDataEntry(e.name));
}

/**
 * Add a source for each of these files of a source's archive, below it on the canvas, as one undo step. They share
 * its archive (and, where the browser gave one, its handle), so it is opened once.
 */
export async function addArchiveEntries(source: Source, entries: string[]): Promise<Source[]> {
  const archive = archives.get(source.id);
  if (!archive || !source.file || !isArchiveSource(source) || !entries.length) return [];
  const engine = engineOrThrow();
  const project = useProjectStore.getState().history.present;
  const node = project.nodes.find((n) => n.type === 'source' && n.sourceId === source.id);
  const at = node?.position ?? { x: 80, y: 80 };
  const added: Source[] = [];
  for (const entry of entries) {
    const { source: s } = await entrySource(archive, source.archive.kind, entry, source.file.headHash);
    await attachArchive(engine, s as Source & { archive: NonNullable<Source['archive']> }, archive);
    markAttached(s.id);
    added.push(s);
  }
  useProjectStore.getState().batch(() => {
    added.forEach((s, i) => useProjectStore.getState().apply((p) => addSource(p, s, { x: at.x, y: at.y + (i + 1) * 128 })));
  });
  void shareHandle(project.id, source.id, added.map((s) => s.id));
  return added;
}

/** Forget the archives chosen (tests). */
export function resetArchives() {
  archives.clear();
  useArchives.setState({ entries: {} });
}

/** "orders.csv (1.2 KB)" for the entry list. */
export const entryLabel = (e: ArchiveEntry) => (e.size == null ? e.name : `${e.name} (${e.size >= 1024 * 1024 ? `${(e.size / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(e.size / 1024))} KB`})`);

/** The chosen file for a source that isn't from an archive; for one that is, the archive (what the user chose). */
export const chosenFile = (sourceId: string) => archives.get(sourceId) ?? sourceFile(sourceId);
