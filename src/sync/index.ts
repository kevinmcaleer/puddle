import { useSession } from '../app/session';
import { useProjectStore } from '../model';
import { deleteSyncLink, listSyncLinks, loadProject, loadSyncLink, saveSyncLink } from '../persistence/db';
import { keepOpenProject, openProject, replaceProject, saveProjectCopy, useWorkspace, workspaceEvents } from '../persistence/workspace';
import { createSyncController } from './controller';
import { openSyncDialog } from './dialogs';
import { takeSignInReturn, type SignInResult } from './drive-auth';
import { PROVIDERS } from './providers';
import { useSync } from './state';

export { PROVIDERS, PROVIDER_IDS } from './providers';
export { useSync, type SyncConflict, type SyncStatus } from './state';
export type { ProviderId, RemoteFile, SyncProvider } from './types';

/** The project open in the editor, if any. */
const openId = () => (useWorkspace.getState().screen === 'editor' ? useProjectStore.getState().history.present.id : null);

/** The app's sync controller, on IndexedDB and the workspace. */
export const sync = createSyncController({
  providers: PROVIDERS,
  links: { load: loadSyncLink, save: saveSyncLink, list: listSyncLinks, delete: deleteSyncLink },
  projects: {
    load: loadProject,
    openId,
    replace: replaceProject,
    open: openProject,
    saveCopy: saveProjectCopy,
    keep: keepOpenProject,
  },
  state: { get: useSync.getState, set: (patch) => useSync.setState(patch) },
  notify: (text) => useSession.getState().notify({ tone: 'info', text }),
  online: () => typeof navigator === 'undefined' || navigator.onLine !== false,
});

/** Once the workspace has opened the last project (or the home screen). */
const workspaceReady = () =>
  new Promise<void>((resolve) => {
    if (useWorkspace.getState().screen !== 'loading') return resolve();
    const off = useWorkspace.subscribe((s) => {
      if (s.screen === 'loading') return;
      off();
      resolve();
    });
  });

/**
 * Back from signing in on the provider's page: connect, then carry on where the user left. The workspace reopens the
 * project they were in (it was saved before leaving), and its queued changes push once connected.
 */
async function resumeSignIn(back: SignInResult) {
  // The editor shows notices on the canvas; the home screen shows its problems in a banner.
  const fail = async (text: string) => {
    await workspaceReady();
    if (useWorkspace.getState().screen === 'home') useWorkspace.setState({ error: text });
    else useSession.getState().notify({ tone: 'fail', text });
  };
  if ('error' in back) return fail(back.error);
  try {
    await sync.connect(back.provider, back.credential);
  } catch (e) {
    return fail(e instanceof Error ? e.message : String(e));
  }
  await workspaceReady();
  if (back.then === 'open') return openSyncDialog({ kind: 'open', provider: back.provider });
  if (back.then !== 'link' || !back.projectId) return;
  if (openId() !== back.projectId) await openProject(back.projectId).catch(() => undefined);
  if (openId() === back.projectId) await sync.link(back.provider);
}

/** Follow the workspace and the network. Returns a function that stops. */
export function startSync() {
  const shown = (p: Parameters<typeof sync.shown>[0]) => void sync.shown(p);
  const saved = (p: Parameters<typeof sync.saved>[0]) => void sync.saved(p);
  const removed = (id: string) => void sync.forget(id);
  const restored = (link: Parameters<typeof sync.restore>[0]) => void sync.restore(link);
  workspaceEvents.shown.add(shown);
  workspaceEvents.saved.add(saved);
  workspaceEvents.removed.add(removed);
  workspaceEvents.restored.add(restored);
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
  const back = takeSignInReturn();
  void sync
    .refreshAccounts()
    .then(() => back && resumeSignIn(back))
    .then(() => sync.drain());
  return () => {
    workspaceEvents.shown.delete(shown);
    workspaceEvents.saved.delete(saved);
    workspaceEvents.removed.delete(removed);
    workspaceEvents.restored.delete(restored);
    window.removeEventListener('online', online);
    window.removeEventListener('offline', offline);
  };
}
