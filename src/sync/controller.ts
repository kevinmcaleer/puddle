import { newId, type Project } from '../model';
import type { StoredSyncLink } from '../persistence/db';
import { projectFileName } from '../persistence/migrate';
import { readSynced, syncHash, syncText } from './file';
import type { SyncState } from './state';
import { SyncAuthError, SyncConflictError, SyncMissingError, SyncOfflineError, type ProviderId, type RemoteFile, type SyncProvider } from './types';

export interface SyncDeps {
  providers: Record<ProviderId, SyncProvider>;
  links: {
    load(projectId: string): Promise<StoredSyncLink | undefined>;
    save(link: StoredSyncLink): Promise<void>;
    list(): Promise<StoredSyncLink[]>;
    delete(projectId: string): Promise<void>;
  };
  projects: {
    /** The project as last saved in this browser. */
    load(id: string): Promise<Project | undefined>;
    /** The project open in the editor, if any. */
    openId(): string | null;
    /** Save a project (a remote version, or one opened from the remote) and show it in the editor. */
    replace(project: Project): Promise<void>;
    /** Open a project already in this browser. */
    open(id: string): Promise<void>;
    /** Save a project beside the others without opening it. */
    saveCopy(project: Project): Promise<void>;
  };
  state: { get(): SyncState; set(patch: Partial<SyncState>): void };
  notify(text: string): void;
  online(): boolean;
  /** How long after a save the push waits, so a burst of edits pushes once. */
  delay?: number;
  /** How long after a failed push to try again. */
  retry?: number;
}

/**
 * The provider-agnostic sync layer: decides when to push and pull, keeps the state the status strip shows, queues
 * changes while offline and stops at conflicts until the user chooses. Every remote step runs one at a time.
 *
 * A project has changes to push when the hash of its synced text differs from the hash last pulled or pushed, so
 * the queue survives a reload: nothing but that hash and the remote revision is kept.
 */
export function createSyncController(deps: SyncDeps) {
  const { providers, links, projects, state } = deps;
  const delay = deps.delay ?? 1500;
  const retry = deps.retry ?? 30_000;
  /** Conflicts waiting for the user, by project: nothing pushes or pulls for them until resolved. */
  const conflicts = new Map<string, NonNullable<SyncState['conflict']>>();
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  let chain: Promise<unknown> = Promise.resolve();

  function queue<T>(fn: () => Promise<T>): Promise<T> {
    const run = chain.then(fn);
    chain = run.catch(() => undefined);
    return run;
  }

  /** Update the strip, when the project is the open one. */
  function report(projectId: string, patch: Partial<SyncState>) {
    if (projects.openId() === projectId && state.get().projectId === projectId) state.set(patch);
  }

  function schedule(projectId: string, wait = delay) {
    const t = timers.get(projectId);
    if (t) clearTimeout(t);
    timers.set(
      projectId,
      setTimeout(() => {
        timers.delete(projectId);
        void queue(() => push(projectId));
      }, wait),
    );
  }

  function failed(projectId: string, project: Project, e: unknown) {
    if (e instanceof SyncConflictError) {
      const conflict = { projectId, localAt: project.updatedAt, remoteAt: e.remote.updatedAt, remoteRevision: e.remote.revision };
      conflicts.set(projectId, conflict);
      report(projectId, { status: 'conflict', conflict, error: null });
    } else if (e instanceof SyncOfflineError) {
      report(projectId, { status: 'offline', error: null });
      // navigator.onLine can say online while requests fail; try again now and then as well as on `online`.
      schedule(projectId, retry);
    } else {
      report(projectId, { status: 'error', error: e instanceof Error ? e.message : String(e) });
      // A refused token waits for a new one; anything else may pass on a later try.
      if (!(e instanceof SyncAuthError)) schedule(projectId, retry);
    }
  }

  const fileOf = (project: Project) => ({ title: project.name, fileName: projectFileName(project), text: syncText(project) });

  /** Push the project's saved version if it has changes. */
  async function push(projectId: string) {
    const link = await links.load(projectId);
    const project = link && (await projects.load(projectId));
    if (!link || !project || conflicts.has(projectId)) return;
    const hash = syncHash(project);
    if (link.remoteId && hash === link.syncedHash) return report(projectId, { status: 'synced', error: null });
    if (!deps.online()) return report(projectId, { status: 'offline', error: null });
    report(projectId, { status: 'pending', error: null });
    try {
      const remote = await providers[link.provider as ProviderId].push(fileOf(project), link.remoteId && link.revision ? { id: link.remoteId, revision: link.revision } : undefined);
      await links.save({ ...link, ...linkFields(remote), syncedHash: hash });
      report(projectId, { status: 'synced', error: null });
    } catch (e) {
      failed(projectId, project, e);
    }
  }

  const linkFields = (remote: RemoteFile) => ({ remoteId: remote.id, revision: remote.revision, remoteUpdatedAt: remote.updatedAt });

  /** Bring the remote version into this browser in place of the local one, under the local project's id. */
  async function takeRemote(link: StoredSyncLink, local: Project) {
    const pulled = await providers[link.provider as ProviderId].pull(link.remoteId!);
    const next = { ...readSynced(pulled.text, local), id: local.id };
    await links.save({ ...link, ...linkFields(pulled), syncedHash: syncHash(next) });
    await projects.replace(next);
  }

  /** On opening a project: pull what changed remotely, push what changed here, or stop at a conflict. */
  async function check(projectId: string) {
    const link = await links.load(projectId);
    if (!link) return;
    report(projectId, { provider: link.provider as ProviderId });
    const conflict = conflicts.get(projectId);
    if (conflict) return report(projectId, { status: 'conflict', conflict });
    if (!link.remoteId) return push(projectId);
    const project = await projects.load(projectId);
    if (!project) return;
    if (!deps.online()) return report(projectId, { status: 'offline' });
    try {
      const remote = await providers[link.provider as ProviderId].head(link.remoteId);
      if (remote.revision === link.revision) return push(projectId);
      if (syncHash(project) !== link.syncedHash) throw new SyncConflictError(remote);
      // Nothing changed here since the last sync: the remote version is simply newer.
      await takeRemote(link, project);
      deps.notify(`Updated from ${providers[link.provider as ProviderId].label} with changes made in another browser.`);
      report(projectId, { status: 'synced', error: null });
    } catch (e) {
      // Deleted remotely: the next push writes it again.
      if (e instanceof SyncMissingError) return push(projectId);
      failed(projectId, project, e);
    }
  }

  /** Push every project with queued changes (on start and when the network comes back). */
  const drain = () =>
    queue(async () => {
      for (const link of await links.list()) schedule(link.projectId, 0);
    });

  return {
    /** A project was opened in the editor. */
    shown(project: Project) {
      state.set({ projectId: project.id, provider: null, status: 'off', conflict: null, error: null });
      return queue(() => check(project.id));
    },

    /** Autosave stored the open project: push once the edits settle. */
    saved(project: Project) {
      return queue(async () => {
        const link = await links.load(project.id);
        if (!link || conflicts.has(project.id)) return;
        if (syncHash(project) === link.syncedHash) return;
        report(project.id, { status: deps.online() ? 'pending' : 'offline' });
        schedule(project.id);
      });
    },

    drain,

    /** Read who each provider is signed in as. */
    refreshAccounts() {
      return Promise.all(
        Object.values(providers).map(async (p) => {
          const account = await p.account().catch(() => null);
          const accounts = { ...state.get().accounts };
          if (account) accounts[p.id] = account;
          else delete accounts[p.id];
          state.set({ accounts });
        }),
      );
    },

    async connect(provider: ProviderId, credential: string) {
      const account = await providers[provider].connect(credential);
      state.set({ accounts: { ...state.get().accounts, [provider]: account } });
      // A project that stopped on a refused token can carry on.
      void drain();
      return account;
    },

    /** Forget the credential and stop syncing every project through this provider on this device. */
    disconnect(provider: ProviderId) {
      return queue(async () => {
        await providers[provider].disconnect();
        for (const link of await links.list()) {
          if (link.provider !== provider) continue;
          await links.delete(link.projectId);
          conflicts.delete(link.projectId);
          const t = timers.get(link.projectId);
          if (t) clearTimeout(t);
          timers.delete(link.projectId);
        }
        const { accounts, provider: open } = state.get();
        const rest = { ...accounts };
        delete rest[provider];
        state.set(open === provider ? { accounts: rest, provider: null, status: 'off', conflict: null, error: null } : { accounts: rest });
      });
    },

    /** Start syncing the open project: the first push creates its remote file. */
    link(provider: ProviderId) {
      const projectId = projects.openId();
      if (!projectId) return Promise.resolve();
      return queue(async () => {
        await links.save({ projectId, provider });
        report(projectId, { provider, status: 'pending', error: null });
        await push(projectId);
      });
    },

    /** Stop syncing the open project. Its remote file stays. */
    unlink() {
      const projectId = projects.openId();
      if (!projectId) return Promise.resolve();
      return queue(async () => {
        await links.delete(projectId);
        conflicts.delete(projectId);
        report(projectId, { provider: null, status: 'off', conflict: null, error: null });
      });
    },

    /** A project deleted from this browser stops syncing; its remote file stays. */
    forget(projectId: string) {
      conflicts.delete(projectId);
      return queue(() => links.delete(projectId));
    },

    /**
     * Settle the open project's conflict. `mine` writes this browser's version over the remote one; `remote` takes
     * the remote one; `copy` keeps this browser's version as a separate project, then takes the remote one.
     */
    resolve(choice: 'mine' | 'remote' | 'copy') {
      const projectId = projects.openId();
      const conflict = projectId ? conflicts.get(projectId) : undefined;
      if (!projectId || !conflict) return Promise.resolve();
      return queue(async () => {
        const link = await links.load(projectId);
        const local = await projects.load(projectId);
        if (!link || !local) return;
        conflicts.delete(projectId);
        report(projectId, { status: 'pending', conflict: null, error: null });
        try {
          if (choice === 'mine') {
            // Push over the revision the user saw; a newer one still stops at a conflict.
            await links.save({ ...link, revision: conflict.remoteRevision, syncedHash: undefined });
            return await push(projectId);
          }
          if (choice === 'copy') {
            const now = new Date().toISOString();
            const copy = { ...local, id: newId('p'), name: `${local.name} (this browser)`, createdAt: now, updatedAt: now };
            await projects.saveCopy(copy);
            deps.notify(`Your version is saved as “${copy.name}”.`);
          }
          await takeRemote(link, local);
          report(projectId, { status: 'synced' });
        } catch (e) {
          failed(projectId, local, e);
        }
      });
    },

    /** The provider's Puddle projects, for "Open from". */
    list: (provider: ProviderId) => providers[provider].list(),

    /** Open a remote project: the local copy already synced with it, or a new local copy linked to it. */
    openRemote(provider: ProviderId, remoteId: string) {
      return queue(async () => {
        const existing = (await links.list()).find((l) => l.provider === provider && l.remoteId === remoteId);
        if (existing) {
          if (await projects.load(existing.projectId)) return projects.open(existing.projectId);
          await links.delete(existing.projectId);
        }
        const pulled = await providers[provider].pull(remoteId);
        let project = readSynced(pulled.text);
        // The project was copied into this browser some other way: keep both.
        if (await projects.load(project.id)) project = { ...project, id: newId('p') };
        await links.save({ projectId: project.id, provider, ...linkFields(pulled), syncedHash: syncHash(project) });
        await projects.replace(project);
      });
    },

    /** Wait for every queued step (tests). */
    idle: () => queue(() => Promise.resolve()),
  };
}

export type SyncController = ReturnType<typeof createSyncController>;
