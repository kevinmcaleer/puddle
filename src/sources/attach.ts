import { whenEngine } from '../app/engine';
import { sourceFileName } from '../compiler';
import { updateSource, useProjectStore, type Project, type Source } from '../model';
import { rememberFile, sourceFile } from './add';
import { markAttached, useAttachments, type Attachment } from './attachments';
import { formatFromName, SourceError } from './detect';
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
  for (const s of project.sources) next[s.id] = s.kind === 'clipboard' || sourceFile(s.id) || (s.kind === 'url' && urlFetched(s.id)) ? 'attached' : 'detached';
  const clipboard = project.sources.filter((s) => s.kind === 'clipboard' && s.clipboard);
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
 * project was built on; a different file still attaches, but is marked so the user is warned.
 */
export async function reattachFile(source: Source, file: File, handle?: FileHandle): Promise<Attachment> {
  const format = formatFromName(file.name);
  if (format !== source.format) throw new SourceError(`${file.name} isn’t a ${source.format.toUpperCase()} file. Choose the file this source was built on.`);
  const hash = await headHash(file);
  const same = source.file?.headHash === hash;
  const engine = await whenEngine();
  await engine.registerFile(sourceFileName(source), file);
  rememberFile(source.id, file);
  keepHandle(source.id, handle);
  settleSource(source.id);
  // Record the file now in use, so the upstream key (and every cached result) follows the new bytes.
  useProjectStore.getState().amend((p) =>
    updateSource(p, source.id, { file: { ...source.file, originalName: file.name, size: file.size, lastModified: file.lastModified, headHash: hash } }),
  );
  const state: Attachment = same ? 'attached' : 'mismatch';
  markAttached(source.id, state);
  return state;
}

/** Why a source can't be read, and how to fix it. */
export function detachedMessage(source: Source): string {
  const name = source.file?.originalName ?? source.name;
  return `Projects save the steps, not the data, so choose ${name} again to read it.`;
}
