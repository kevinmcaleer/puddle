import { useSession } from '../app/session';
import { useProjectStore } from '../model';
import { deleteSyncLink, listSyncLinks, loadProject, loadSyncLink, saveSyncLink } from '../persistence/db';
import { openProject, replaceProject, saveProjectCopy, useWorkspace, workspaceEvents } from '../persistence/workspace';
import { createSyncController } from './controller';
import { PROVIDERS } from './providers';
import { useSync } from './state';

export { PROVIDERS, PROVIDER_IDS } from './providers';
export { useSync, type SyncConflict, type SyncStatus } from './state';
export type { ProviderId, RemoteFile } from './types';

/** The app's sync controller, on IndexedDB and the workspace. */
export const sync = createSyncController({
  providers: PROVIDERS,
  links: { load: loadSyncLink, save: saveSyncLink, list: listSyncLinks, delete: deleteSyncLink },
  projects: {
    load: loadProject,
    openId: () => (useWorkspace.getState().screen === 'editor' ? useProjectStore.getState().history.present.id : null),
    replace: replaceProject,
    open: openProject,
    saveCopy: saveProjectCopy,
  },
  state: { get: useSync.getState, set: (patch) => useSync.setState(patch) },
  notify: (text) => useSession.getState().notify({ tone: 'info', text }),
  online: () => typeof navigator === 'undefined' || navigator.onLine !== false,
});

/** Follow the workspace and the network. Returns a function that stops. */
export function startSync() {
  const shown = (p: Parameters<typeof sync.shown>[0]) => void sync.shown(p);
  const saved = (p: Parameters<typeof sync.saved>[0]) => void sync.saved(p);
  const removed = (id: string) => void sync.forget(id);
  workspaceEvents.shown.add(shown);
  workspaceEvents.saved.add(saved);
  workspaceEvents.removed.add(removed);
  // A project already open before this started (the workspace can open the last one first).
  const open = useWorkspace.getState().screen === 'editor' ? useProjectStore.getState().history.present : null;
  if (open) shown(open);
  const online = () => void sync.drain();
  const offline = () => {
    const { status, projectId } = useSync.getState();
    if (projectId && (status === 'pending' || status === 'synced')) useSync.setState({ status: 'offline' });
  };
  window.addEventListener('online', online);
  window.addEventListener('offline', offline);
  void sync.refreshAccounts().then(() => sync.drain());
  return () => {
    workspaceEvents.shown.delete(shown);
    workspaceEvents.saved.delete(saved);
    workspaceEvents.removed.delete(removed);
    window.removeEventListener('online', online);
    window.removeEventListener('offline', offline);
  };
}
