import { hashValue, type Project } from '../model';
import { readProjectFile, writeProjectFile } from '../persistence/migrate';
import { withoutHeaderValues, withoutPastedRows } from '../persistence/shareable';

/**
 * The project as it syncs: the `.puddle.json` export, less pasted data and request header values. Pasted rows are
 * data, and no data leaves the browser, so a pasted source syncs as its name and columns only and keeps its rows in
 * this browser. A URL source's header values may be credentials (anyone with a secret Gist's link can read it), so
 * each header syncs by name with an empty value and keeps its value in this browser.
 */
function syncable(project: Project): Project {
  return { ...project, sources: project.sources.map((s) => withoutHeaderValues(withoutPastedRows(s))) };
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
 * rows they have here, and its URL sources the header values they have here (for headers the remote still names).
 */
export function readSynced(text: string, local?: Project): Project {
  const remote = readProjectFile(text);
  if (!local) return remote;
  const byId = new Map(local.sources.map((s) => [s.id, s]));
  return {
    ...remote,
    sources: remote.sources.map((s) => {
      const here = byId.get(s.id);
      let out = s;
      if (out.kind === 'clipboard' && !out.clipboard && here?.clipboard) out = { ...out, clipboard: here.clipboard };
      const kept = here?.url?.headers;
      if (out.url?.headers && kept) {
        const headers = Object.fromEntries(Object.entries(out.url.headers).map(([name, value]) => [name, value || (kept[name] ?? '')]));
        out = { ...out, url: { ...out.url, headers } };
      }
      return out;
    }),
  };
}
