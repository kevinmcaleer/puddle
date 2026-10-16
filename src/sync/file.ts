import { hashValue, type Project } from '../model';
import { readProjectFile, writeProjectFile } from '../persistence/migrate';

/**
 * The project as it syncs: the `.puddle.json` export, less pasted data. Pasted rows are data, and no data leaves
 * the browser, so a pasted source syncs as its name and columns only and keeps its rows in this browser.
 */
function syncable(project: Project): Project {
  const sources = project.sources.map((s) => {
    if (!s.clipboard) return s;
    const { clipboard: _, ...rest } = s;
    return rest;
  });
  return { ...project, sources };
}

export const syncText = (project: Project) => writeProjectFile(syncable(project));

/**
 * Whether two versions differ enough to sync, whatever order their keys are in (a pulled file is re-parsed). What is
 * viewed and where the canvas sits still sync with each change, but moving around alone doesn't push: it is this
 * browser's view, and pushing it would turn two browsers merely looking at a project into a conflict.
 */
export function syncHash(project: Project): string {
  const { view: _, ...rest } = syncable(project);
  return hashValue(rest);
}

/**
 * Read a synced file. With `local`, the version of the same project in this browser, its pasted sources keep the
 * rows they have here.
 */
export function readSynced(text: string, local?: Project): Project {
  const remote = readProjectFile(text);
  if (!local) return remote;
  const pasted = new Map(local.sources.filter((s) => s.clipboard).map((s) => [s.id, s.clipboard!]));
  return { ...remote, sources: remote.sources.map((s) => (s.kind === 'clipboard' && !s.clipboard && pasted.has(s.id) ? { ...s, clipboard: pasted.get(s.id)! } : s)) };
}
