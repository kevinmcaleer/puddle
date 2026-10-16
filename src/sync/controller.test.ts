import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { addSource, createProject, type Project, type Source } from '../model';
import type { StoredSyncLink } from '../persistence/db';
import { createSyncController } from './controller';
import { syncHash, syncText } from './file';
import { initialSyncState, type SyncState } from './state';
import { SyncAuthError, SyncConflictError, SyncMissingError, SyncOfflineError, type PulledFile, type PushFile, type RemoteFile, type SyncProvider } from './types';

/** A remote with revisions, like a Gist: every write makes a new one. */
function fakeRemote() {
  const files = new Map<string, PulledFile>();
  let n = 0;
  let ids = 0;
  let offline = false;
  const writes: { id: string; file: PushFile }[] = [];
  const stamp = () => new Date(Date.UTC(2026, 9, 1, 10, 0, ++n)).toISOString();
  const write = (id: string, file: PushFile): RemoteFile => {
    const next = { id, title: file.title, fileName: file.fileName, text: file.text, updatedAt: stamp(), revision: `r${n}` };
    files.set(id, next);
    writes.push({ id, file });
    const { text: _, ...meta } = next;
    return meta;
  };
  const get = (id: string) => {
    if (offline) throw new SyncOfflineError();
    const f = files.get(id);
    if (!f) throw new SyncMissingError();
    return f;
  };
  const provider: SyncProvider = {
    id: 'gist',
    label: 'GitHub Gist',
    connect: async () => 'kev',
    disconnect: vi.fn(async () => {}),
    account: async () => 'kev',
    list: async () => [...files.values()],
    head: async (id) => {
      const { text: _, ...meta } = get(id);
      return meta;
    },
    pull: async (id) => get(id),
    push: async (file, base) => {
      if (offline) throw new SyncOfflineError();
      if (!base || !files.has(base.id)) return write(`g${++ids}`, file);
      const current = get(base.id);
      if (current.revision !== base.revision) {
        const { text: _, ...meta } = current;
        throw new SyncConflictError(meta);
      }
      return write(base.id, file);
    },
  };
  return {
    provider,
    files,
    writes,
    /** Another browser writes the file. */
    editElsewhere: (id: string, project: Project) => write(id, { title: project.name, fileName: 'x.puddle.json', text: syncText(project) }),
    setOffline: (v: boolean) => void (offline = v),
  };
}

function setup() {
  const remote = fakeRemote();
  const links = new Map<string, StoredSyncLink>();
  const saved = new Map<string, Project>();
  let open: string | null = null;
  let state: SyncState = initialSyncState();
  let online = true;
  const notices: string[] = [];
  const replaced: Project[] = [];
  const sync = createSyncController({
    providers: { gist: remote.provider },
    links: {
      load: async (id) => links.get(id),
      save: async (l) => void links.set(l.projectId, l),
      list: async () => [...links.values()],
      delete: async (id) => void links.delete(id),
    },
    projects: {
      load: async (id) => saved.get(id),
      openId: () => open,
      replace: async (p) => {
        saved.set(p.id, p);
        replaced.push(p);
        open = p.id;
        void sync.shown(p);
      },
      open: async (id) => {
        open = id;
        void sync.shown(saved.get(id)!);
      },
      saveCopy: async (p) => void saved.set(p.id, p),
    },
    state: { get: () => state, set: (patch) => void (state = { ...state, ...patch }) },
    notify: (t) => void notices.push(t),
    online: () => online,
    delay: 10,
    retry: 60_000,
  });
  /** Open a project in the editor, as the workspace does. */
  const show = async (p: Project) => {
    saved.set(p.id, p);
    open = p.id;
    await sync.shown(p);
  };
  /** Autosave stored an edit. */
  const edit = async (p: Project) => {
    saved.set(p.id, p);
    await sync.saved(p);
    await vi.advanceTimersByTimeAsync(20);
    await sync.idle();
  };
  return { sync, remote, links, saved, notices, replaced, state: () => state, show, edit, setOnline: (v: boolean) => void (online = v) };
}

const pasted: Source = { id: 's_paste', name: 'Pasted data', kind: 'clipboard', clipboard: { text: 'a\n1\n' }, format: 'csv', parseOptions: {}, detectedSchema: [] };

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const later = (p: Project, patch: Partial<Project>, at = '2026-10-02T09:00:00.000Z'): Project => ({ ...p, ...patch, updatedAt: at });

/** A project already synced once. */
async function synced() {
  const t = setup();
  const project = createProject('Orders');
  await t.show(project);
  await t.sync.link('gist');
  return { ...t, project };
}

describe('sync controller', () => {
  it('does nothing for a project that doesn’t sync', async () => {
    const t = setup();
    await t.show(createProject('Local only'));
    await t.edit(later(createProject('Local only'), { notes: 'x' }));
    expect(t.state().status).toBe('off');
    expect(t.remote.writes).toHaveLength(0);
  });

  it('creates the remote file on the first sync and pushes later saves once they settle', async () => {
    const t = await synced();
    expect(t.remote.writes).toHaveLength(1);
    expect(t.links.get(t.project.id)).toMatchObject({ provider: 'gist', remoteId: 'g1', revision: 'r1', syncedHash: syncHash(t.project) });
    expect(t.state()).toMatchObject({ status: 'synced', provider: 'gist' });

    const edited = later(t.project, { notes: 'next' });
    t.saved.set(edited.id, edited);
    await t.sync.saved(edited);
    expect(t.state().status).toBe('pending');
    await t.sync.saved(edited);
    await vi.advanceTimersByTimeAsync(20);
    await t.sync.idle();
    // Two saves in a burst push once.
    expect(t.remote.writes).toHaveLength(2);
    expect(t.remote.files.get('g1')!.text).toContain('next');
    expect(t.state().status).toBe('synced');
  });

  it('never pushes pasted rows', async () => {
    const t = setup();
    const project = addSource(createProject('Pasted'), pasted, { x: 0, y: 0 });
    await t.show(project);
    await t.sync.link('gist');
    expect(t.remote.files.get('g1')!.text).not.toContain('a\\n1\\n');
    expect(JSON.parse(t.remote.files.get('g1')!.text).sources[0]).not.toHaveProperty('clipboard');
  });

  it('queues changes while offline and pushes them when back online', async () => {
    const t = await synced();
    t.setOnline(false);
    const edited = later(t.project, { notes: 'offline edit' });
    await t.edit(edited);
    expect(t.state().status).toBe('offline');
    expect(t.remote.writes).toHaveLength(1);

    t.setOnline(true);
    await t.sync.drain();
    await vi.advanceTimersByTimeAsync(5);
    await t.sync.idle();
    expect(t.remote.writes).toHaveLength(2);
    expect(t.state().status).toBe('synced');
  });

  it('treats a request that never arrives as offline and tries again later', async () => {
    const t = await synced();
    t.remote.setOffline(true);
    await t.edit(later(t.project, { notes: 'flaky' }));
    expect(t.state().status).toBe('offline');
    t.remote.setOffline(false);
    await vi.advanceTimersByTimeAsync(60_000);
    await t.sync.idle();
    expect(t.remote.files.get('g1')!.text).toContain('flaky');
    expect(t.state().status).toBe('synced');
  });

  it('the queue survives a reload: unpushed changes push when the project opens again', async () => {
    const t = await synced();
    t.setOnline(false);
    const edited = later(t.project, { notes: 'before reload' });
    await t.edit(edited);
    t.setOnline(true);
    // A fresh controller would read the same link; showing the project checks and pushes.
    await t.show(edited);
    expect(t.remote.files.get('g1')!.text).toContain('before reload');
    expect(t.state().status).toBe('synced');
  });

  it('stops at a conflict when both sides changed, and writes nothing', async () => {
    const t = await synced();
    t.remote.editElsewhere('g1', later(t.project, { notes: 'theirs' }, '2026-10-02T08:00:00.000Z'));
    await t.edit(later(t.project, { notes: 'mine' }));
    expect(t.state().status).toBe('conflict');
    expect(t.state().conflict).toMatchObject({ projectId: t.project.id, localAt: '2026-10-02T09:00:00.000Z', remoteRevision: 'r2' });
    expect(t.remote.files.get('g1')!.text).toContain('theirs');

    // Further saves wait for the choice.
    await t.edit(later(t.project, { notes: 'mine again' }));
    expect(t.remote.files.get('g1')!.text).toContain('theirs');
    expect(t.state().status).toBe('conflict');
  });

  it('keep mine writes this browser’s version over the remote one', async () => {
    const t = await synced();
    t.remote.editElsewhere('g1', later(t.project, { notes: 'theirs' }));
    await t.edit(later(t.project, { notes: 'mine' }));
    await t.sync.resolve('mine');
    expect(t.remote.files.get('g1')!.text).toContain('mine');
    expect(t.state()).toMatchObject({ status: 'synced', conflict: null });
  });

  it('keep mine pushes even when this browser’s version is the one last synced', async () => {
    const t = await synced();
    t.remote.editElsewhere('g1', later(t.project, { notes: 'theirs' }));
    // Shown with no local changes but a conflict raised by hand: the push must still happen.
    await t.edit(later(t.project, { notes: 'mine' }));
    const link = t.links.get(t.project.id)!;
    t.links.set(t.project.id, { ...link, syncedHash: syncHash(t.saved.get(t.project.id)!) });
    await t.sync.resolve('mine');
    expect(t.remote.files.get('g1')!.text).toContain('mine');
  });

  it('take remote replaces this browser’s version, keeping its pasted rows', async () => {
    const t = setup();
    const project = addSource(createProject('Pasted'), pasted, { x: 0, y: 0 });
    await t.show(project);
    await t.sync.link('gist');
    t.remote.editElsewhere('g1', later(project, { notes: 'theirs' }));
    await t.edit(later(project, { notes: 'mine' }));
    await t.sync.resolve('remote');
    await t.sync.idle();
    const now = t.saved.get(project.id)!;
    expect(now.notes).toBe('theirs');
    expect(now.sources[0]!.clipboard).toEqual(pasted.clipboard);
    expect(t.links.get(project.id)).toMatchObject({ revision: 'r2', syncedHash: syncHash(now) });
    expect(t.state().status).toBe('synced');
  });

  it('save a copy keeps this browser’s version as a new project, then takes the remote one', async () => {
    const t = await synced();
    t.remote.editElsewhere('g1', later(t.project, { notes: 'theirs' }));
    await t.edit(later(t.project, { notes: 'mine' }));
    await t.sync.resolve('copy');
    await t.sync.idle();
    const copy = [...t.saved.values()].find((p) => p.id !== t.project.id)!;
    expect(copy).toMatchObject({ name: 'Orders (this browser)', notes: 'mine' });
    expect(t.links.has(copy.id)).toBe(false);
    expect(t.saved.get(t.project.id)!.notes).toBe('theirs');
    expect(t.remote.files.get('g1')!.text).toContain('theirs');
    expect(t.notices.at(-1)).toContain('Orders (this browser)');
  });

  it('on opening, takes a newer remote version when nothing changed here', async () => {
    const t = await synced();
    t.remote.editElsewhere('g1', later(t.project, { notes: 'from the laptop' }));
    await t.show(t.project);
    await t.sync.idle();
    expect(t.saved.get(t.project.id)!.notes).toBe('from the laptop');
    expect(t.notices.at(-1)).toContain('another browser');
    expect(t.state().status).toBe('synced');
  });

  it('on opening, stops at a conflict when both changed', async () => {
    const t = await synced();
    t.setOnline(false);
    await t.edit(later(t.project, { notes: 'mine' }));
    t.setOnline(true);
    t.remote.editElsewhere('g1', later(t.project, { notes: 'theirs' }));
    await t.show(t.saved.get(t.project.id)!);
    expect(t.state().status).toBe('conflict');
    expect(t.saved.get(t.project.id)!.notes).toBe('mine');
    expect(t.remote.files.get('g1')!.text).toContain('theirs');
  });

  it('opens a remote project as a new local copy linked to it, or the copy already here', async () => {
    const t = await synced();
    const elsewhere = setup();
    elsewhere.remote.files.set('g1', t.remote.files.get('g1')!);
    await elsewhere.sync.openRemote('gist', 'g1');
    expect(elsewhere.replaced).toHaveLength(1);
    expect(elsewhere.replaced[0]!.id).toBe(t.project.id);
    expect(elsewhere.links.get(t.project.id)).toMatchObject({ remoteId: 'g1', revision: 'r1' });
    await elsewhere.sync.idle();
    expect(elsewhere.state().status).toBe('synced');
    // Opening it again goes to the same local project.
    await elsewhere.sync.openRemote('gist', 'g1');
    expect(elsewhere.replaced).toHaveLength(1);

    // A browser that already has a project with that id (an imported file) keeps both.
    await t.sync.unlink();
    await t.sync.openRemote('gist', 'g1');
    const opened = t.replaced.at(-1)!;
    expect(opened.id).not.toBe(t.project.id);
    expect(t.links.get(opened.id)).toMatchObject({ remoteId: 'g1' });
  });

  it('disconnecting forgets the credential and stops syncing that provider’s projects', async () => {
    const t = await synced();
    await t.sync.disconnect('gist');
    expect(t.remote.provider.disconnect).toHaveBeenCalled();
    expect(t.links.size).toBe(0);
    expect(t.state()).toMatchObject({ status: 'off', provider: null });
    await t.edit(later(t.project, { notes: 'after' }));
    expect(t.remote.writes).toHaveLength(1);
  });

  it('writes a remote file deleted elsewhere again', async () => {
    const t = await synced();
    t.remote.files.delete('g1');
    await t.edit(later(t.project, { notes: 'still here' }));
    expect(t.links.get(t.project.id)!.remoteId).toBe('g2');
    expect(t.state().status).toBe('synced');
  });

  it('stops on a refused token and carries on with the same remote file once a new one is connected', async () => {
    const t = await synced();
    const push = t.remote.provider.push;
    t.remote.provider.push = async () => {
      throw new SyncAuthError('GitHub didn’t accept the token.');
    };
    await t.edit(later(t.project, { notes: 'needs a token' }));
    expect(t.state()).toMatchObject({ status: 'error', error: 'GitHub didn’t accept the token.' });
    // No retries against a token that won't work.
    t.remote.provider.push = push;
    await vi.advanceTimersByTimeAsync(120_000);
    await t.sync.idle();
    expect(t.remote.files.get('g1')!.text).not.toContain('needs a token');

    await t.sync.connect('gist', 'new token');
    await vi.advanceTimersByTimeAsync(5);
    await t.sync.idle();
    await vi.advanceTimersByTimeAsync(5);
    await t.sync.idle();
    expect(t.remote.files.get('g1')!.text).toContain('needs a token');
    expect(t.remote.files.size).toBe(1);
    expect(t.state().status).toBe('synced');
  });
});
