// File sets in the browser: many files chosen together (or a folder) read as one table, each file registered with
// DuckDB under its own name, never copied. As for single files, the project keeps references, not data.
import { fileSetFileName, isFileSetFormat } from '../compiler';
import { formatLabel } from '../canvas/formatLabel';
import { invalidateCaches } from '../flow/status';
import { addSource, newId, setFileSet, useProjectStore, type FileSetFile, type Source, type SourceFormat } from '../model';
import { engineOrThrow } from './add';
import { markAttached } from './attachments';
import { knownFormat, SourceError } from './detect';
import { HEAD_BYTES } from './hash';
import { sniff, TAIL_BYTES } from './sniff';

/** A file chosen for a set, with its path inside the set (the folder's own name left off). */
export interface SetFile {
  file: File;
  name: string;
}

/** The files of each set chosen this session, by source id, in the set's order. */
const chosen = new Map<string, SetFile[]>();

export const fileSetChosen = (sourceId: string) => chosen.has(sourceId);

/** Files picked from an input: their paths inside the folder, when a folder was picked, and the folder's name. */
export function setFilesOf(files: File[]): { files: SetFile[]; folder?: string } {
  const relative = files.map((f) => (f as File & { webkitRelativePath?: string }).webkitRelativePath ?? '');
  const folder = relative.every((p) => p.includes('/')) && relative.length ? relative[0]!.split('/')[0] : undefined;
  return {
    files: files.map((file, i) => ({ file, name: folder ? relative[i]!.split('/').slice(1).join('/') : file.name })).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true })),
    folder,
  };
}

const meta = (f: SetFile): FileSetFile => ({ name: f.name, size: f.file.size, lastModified: f.file.lastModified });

/**
 * The format most of the files are, of those a set can read, and the files of that format. Hidden files and others
 * (a folder's .DS_Store or readme) are left out.
 */
export function setFormat(files: SetFile[]): { format: SourceFormat; files: SetFile[] } | undefined {
  const counts = new Map<SourceFormat, number>();
  const visible = files.filter((f) => !(f.name.split('/').pop() ?? '').startsWith('.'));
  for (const f of visible) {
    const format = knownFormat(f.name);
    if (format && isFileSetFormat(format)) counts.set(format, (counts.get(format) ?? 0) + 1);
  }
  const format = [...counts].sort((a, b) => b[1] - a[1])[0]?.[0];
  return format && { format, files: visible.filter((f) => knownFormat(f.name) === format) };
}

async function register(sourceId: string, files: SetFile[]) {
  const engine = engineOrThrow();
  for (const f of files) await engine.registerFile(fileSetFileName(sourceId, meta(f)), f.file);
  chosen.set(sourceId, files);
}

/** Read options for a set of text files, from the first file's bytes. */
async function readOptions(first: File) {
  const head = new Uint8Array(await first.slice(0, HEAD_BYTES).arrayBuffer());
  const tail = first.size > HEAD_BYTES ? new Uint8Array(await first.slice(Math.max(0, first.size - TAIL_BYTES)).arrayBuffer()) : undefined;
  return sniff({ name: first.name, head, size: first.size, tail }).parseOptions;
}

/**
 * Add the files as one source, read together with their columns lined up by name. Files of other formats than most
 * of them are left out, and so said.
 */
export async function addFileSetSource(picked: SetFile[], folder: string | undefined, position: { x: number; y: number }): Promise<{ source: Source; left: string[] }> {
  const found = setFormat(picked);
  if (!found) throw new SourceError('None of these is a Parquet, CSV, TSV, JSON or NDJSON file. A file set reads many files of one of those kinds as one table.');
  const source: Source = {
    id: newId('s'),
    name: folder ?? `${formatLabel(found.format)} files`,
    kind: 'files',
    format: found.format,
    fileSet: { files: found.files.map(meta), ...(folder ? { folder } : {}) },
    parseOptions: found.format === 'csv' || found.format === 'tsv' ? await readOptions(found.files[0]!.file) : {},
    detectedSchema: [],
  };
  await register(source.id, found.files);
  markAttached(source.id);
  useProjectStore.getState().apply((p) => addSource(p, source, position));
  return { source, left: picked.filter((f) => !found.files.includes(f)).map((f) => f.name) };
}

/**
 * Choose a set's files again (a reopened project), or other ones: the set reads what was chosen now, as many files as
 * there are, so a folder picked again takes in its new files.
 */
export async function rechooseFileSet(source: Source, picked: SetFile[], folder: string | undefined): Promise<void> {
  const files = picked.filter((f) => knownFormat(f.name) === source.format && !(f.name.split('/').pop() ?? '').startsWith('.'));
  if (!files.length) throw new SourceError(`None of these is a ${formatLabel(source.format)} file. Choose the ${formatLabel(source.format)} files ${source.name} reads.`);
  await register(source.id, files);
  invalidateCaches();
  // Recorded as the files now in use (not an undo step), so every result upstream of them follows the new files.
  useProjectStore.getState().amend((p) => setFileSet(p, source.id, { files: files.map(meta), ...(folder ? { folder } : {}) }));
  markAttached(source.id);
}
