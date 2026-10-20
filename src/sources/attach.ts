import { whenEngine } from '../app/engine';
import { useSession } from '../app/session';
import { sourceFileName } from '../compiler';
import { updateSource, useProjectStore, type Project, type Source } from '../model';
import { registerSourceFile, rememberFile, sourceFile } from './add';
import { markAttached, useAttachments, type Attachment } from './attachments';
import { extensionOf, formatFromName, knownFormat, SourceError, TEXT_EXTENSIONS } from './detect';
import { keepHandle, offerHandles, settleSource, supportsFileHandles, useReconnect, type FileHandle } from './handles';
import { headHash } from './hash';
import { deleteHandles, loadHandles } from '../persistence/db';
import { loadUrlSource, urlFetched } from './url';

/** Connect a source of the open project to the file behind its stored handle. */
export const connectHandle = async (sourceId: string, file: File, handle: FileHandle) => {
  const source = useProjectStore.getState().history.present.sources.find((s) => s.id === sourceId);
  if (!source) throw new SourceError('That source is no longer in the project.');
  await reattachFile(source, file, handle);
};

/**
 * Where the browser keeps file handles (Chromium), find the stored ones for the project's detached files: those
 * already allowed connect now, the rest wait for one "Reconnect files" click. Handles of removed sources are dropped.
 */
async function offerStoredHandles(project: Project, detached: string[]) {
  useReconnect.setState({ pending: {}, reasons: {}, busy: false });
  if (!supportsFileHandles() || !detached.length) return;
  let stored: Map<string, FileHandle>;
  try {
    stored = await loadHandles<FileHandle>(project.id);
    if ([...stored.keys()].some((id) => !project.sources.some((s) => s.id === id))) void deleteHandles(project.id, project.sources.map((s) => s.id)).catch(() => {});
  } catch {
    return;
  }
  const usable = new Map([...stored].filter(([id]) => detached.includes(id)));
  // Another project opened meanwhile: these handles are no longer the ones to offer.
  if (useProjectStore.getState().history.present.id !== project.id) return;
  if (usable.size) await offerHandles(usable, connectHandle);
}

/**
 * Work out each source's attachment when a project opens. Pasted text is stored in the project, so it is
 * registered again straight away; files already chosen in this tab stay attached; every other file is detached.
 * URL sources not yet fetched in this tab are fetched again in the background, with no re-attach step.
 */
export async function attachProject(project: Project): Promise<void> {
  const next: Record<string, Attachment> = {};
  // A connection source is read through its connection (src/sources/connection.ts), so has nothing to attach.
  for (const s of project.sources) next[s.id] = s.kind === 'clipboard' || s.kind === 'connection' || sourceFile(s.id) || (s.kind === 'url' && urlFetched(s.id)) ? 'attached' : 'detached';
  const clipboard = project.sources.filter((s) => s.kind === 'clipboard' && s.clipboard && s.format !== 'xml');
  if (clipboard.length) {
    const engine = await whenEngine();
    for (const s of clipboard) await engine.registerText(sourceFileName(s), s.clipboard!.text);
  }
  useAttachments.setState({ sources: next });
  for (const s of project.sources) if (s.kind === 'url' && !urlFetched(s.id)) void loadUrlSource(s);
  await offerStoredHandles(project, project.sources.filter((s) => s.kind === 'file' && next[s.id] === 'detached').map((s) => s.id));
}

/**
 * Connect a detached source to a file chosen again. The file's first megabyte is checked against the one the
 * project was built on; a different file still attaches, but is marked so the user is warned. A recipe's source is
 * attached to its first file the same way.
 */
export async function reattachFile(source: Source, file: File, handle?: FileHandle): Promise<Attachment> {
  // A name that says a different format is the wrong file; a plain-text name (.txt, .dat) says nothing, and the
  // source keeps the format it was sniffed as.
  const named = knownFormat(file.name) ?? (TEXT_EXTENSIONS.has(extensionOf(file.name)) ? undefined : formatFromName(file.name));
  if (named && named !== source.format) throw new SourceError(`${file.name} isn’t a ${source.format.toUpperCase()} file. Choose the file this source was built on.`);
  const hash = await headHash(file);
  const same = source.file?.headHash === hash;
  const engine = await whenEngine();
  // Excel, Access and XML are read again once the file is remembered (see ./excel, ./access and ./xml).
  await registerSourceFile(engine, source, file);
  rememberFile(source.id, file);
  keepHandle(source.id, handle);
  settleSource(source.id);
  // Record the file now in use, so the upstream key (and every cached result) follows the new bytes.
  useProjectStore.getState().amend((p) =>
    updateSource(p, source.id, { file: { ...source.file, originalName: file.name, size: file.size, lastModified: file.lastModified, headHash: hash } }),
  );
  // A source with no file yet (one opened from a recipe) has nothing to compare against: its columns are checked instead.
  const state: Attachment = same || !source.file ? 'attached' : 'mismatch';
  markAttached(source.id, state);
  return state;
}

/** What to tell someone whose browser can't keep files between visits (Firefox, Safari), naming the files to choose again. */
export function filesNotKeptMessage(names: string[]): string {
  const list = names.length <= 2 ? names.join(' and ') : `${names.slice(0, 2).join(', ')} and ${names.length - 2} more`;
  return `Choose ${list} again to read ${names.length === 1 ? 'it' : 'them'}. This browser can’t keep access to files between visits; Chrome and Edge reopen them with one click.`;
}

/**
 * Pair files chosen together with the detached sources they belong to: by the file's name first (ignoring case), then,
 * where only one source and one file of a format are left over, those two. A file named for several sources (the
 * tables of one Access database, the sheets of one workbook) goes to them all. Files that fit no source are left out.
 */
export function matchFiles<F extends { name: string }>(sources: Source[], files: F[]): { source: Source; file: F }[] {
  const pairs: { source: Source; file: F }[] = [];
  const openSources = [...sources];
  const openFiles = [...files];
  const take = (source: Source, file: F) => {
    pairs.push({ source, file });
    openSources.splice(openSources.indexOf(source), 1);
  };
  for (const source of [...openSources]) {
    const name = (source.file?.originalName ?? source.name).toLowerCase();
    const file = openFiles.find((f) => f.name.toLowerCase() === name);
    if (file) take(source, file);
  }
  for (const { file } of pairs) if (openFiles.includes(file)) openFiles.splice(openFiles.indexOf(file), 1);
  for (const source of [...openSources]) {
    const sameFormat = openSources.filter((s) => s.format === source.format);
    const files = openFiles.filter((f) => knownFormat(f.name) === source.format);
    if (sameFormat.length === 1 && files.length === 1) {
      take(source, files[0]!);
      openFiles.splice(openFiles.indexOf(files[0]!), 1);
    }
  }
  return pairs;
}

/**
 * Choose files chosen together for the sources waiting for them, matched by name (then by format, when only one of
 * each is left). Says which files fitted no source.
 */
export async function chooseFilesFor(waiting: Source[], files: File[]) {
  const pairs = matchFiles(waiting, files);
  const notify = useSession.getState().notify;
  for (const { source, file } of pairs) {
    try {
      await reattachFile(source, file);
    } catch (e) {
      notify({ tone: 'fail', text: e instanceof Error ? e.message : String(e) });
    }
  }
  const unused = files.filter((f) => !pairs.some((p) => p.file === f)).map((f) => f.name);
  if (unused.length) notify({ tone: 'warn', text: `${unused.length <= 2 ? unused.join(' and ') : `${unused.slice(0, 2).join(', ')} and ${unused.length - 2} more`} ${unused.length === 1 ? 'isn’t' : 'aren’t'} a file this project reads. Choose it from the node it belongs to.` });
}

/** Why a source can't be read, and how to fix it. */

export function detachedMessage(source: Source): string {
  if (!source.file && source.kind === 'file') return `Recipes hold the steps, not the data, so choose a file for ${source.name} to read it.`;
  const name = source.file?.originalName ?? source.name;
  return `Projects save the steps, not the data, so choose ${name} again to read it.`;
}
