import { whenEngine } from '../app/engine';
import { sourceFileName } from '../compiler';
import { updateSource, useProjectStore, type Project, type Source } from '../model';
import { rememberFile, sourceFile } from './add';
import { markAttached, useAttachments, type Attachment } from './attachments';
import { formatFromName, SourceError } from './detect';
import { headHash } from './hash';
import { loadUrlSource, urlFetched } from './url';

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
}

/**
 * Connect a detached source to a file chosen again. The file's first megabyte is checked against the one the
 * project was built on; a different file still attaches, but is marked so the user is warned.
 */
export async function reattachFile(source: Source, file: File): Promise<Attachment> {
  const format = formatFromName(file.name);
  if (format !== source.format) throw new SourceError(`${file.name} isn’t a ${source.format.toUpperCase()} file. Choose the file this source was built on.`);
  const hash = await headHash(file);
  const same = source.file?.headHash === hash;
  const engine = await whenEngine();
  await engine.registerFile(sourceFileName(source), file);
  rememberFile(source.id, file);
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
