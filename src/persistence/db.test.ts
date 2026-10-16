import 'fake-indexeddb/auto';
import { createProject } from '../model';
import {
  closeDb,
  copyHandles,
  deleteCredential,
  deleteHandles,
  deleteProject,
  deleteSyncLink,
  listProjects,
  listSyncLinks,
  loadCredential,
  loadHandles,
  loadProject,
  loadSyncLink,
  saveCredential,
  saveHandle,
  saveProject,
  saveSyncLink,
} from './db';

afterEach(async () => {
  await closeDb();
  await new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase('puddle');
    req.onsuccess = req.onerror = () => resolve();
  });
});

describe('IndexedDB project store', () => {
  it('saves, loads and replaces a project by id', async () => {
    const p = createProject('First');
    await saveProject(p);
    expect(await loadProject(p.id)).toEqual(p);
    await saveProject({ ...p, name: 'Renamed' });
    expect((await loadProject(p.id))!.name).toBe('Renamed');
    expect(await loadProject('nope')).toBeUndefined();
  });

  it('keeps project notes', async () => {
    const p = { ...createProject('Noted'), notes: '## Next\n\n- check totals' };
    await saveProject(p);
    expect((await loadProject(p.id))!.notes).toBe('## Next\n\n- check totals');
  });

  it('lists summaries, most recently updated first', async () => {
    const a = { ...createProject('Older'), updatedAt: '2026-01-01T00:00:00.000Z' };
    const b = { ...createProject('Newer'), updatedAt: '2026-02-01T00:00:00.000Z' };
    await saveProject(a);
    await saveProject(b);
    expect(await listProjects()).toEqual([
      { id: b.id, name: 'Newer', updatedAt: b.updatedAt, sources: 0, nodes: 0 },
      { id: a.id, name: 'Older', updatedAt: a.updatedAt, sources: 0, nodes: 0 },
    ]);
  });

  it('deletes a project', async () => {
    const p = createProject('Gone');
    await saveProject(p);
    await deleteProject(p.id);
    expect(await listProjects()).toEqual([]);
  });
});

describe('IndexedDB file handles', () => {
  // fake-indexeddb can't clone a real FileSystemFileHandle; any cloneable value stands in for one.
  const handle = (name: string) => ({ kind: 'file', name });

  it('keeps handles by project and source, replacing a source’s earlier one', async () => {
    await saveHandle('p1', 's1', handle('a.csv'));
    await saveHandle('p1', 's2', handle('b.csv'));
    await saveHandle('p2', 's1', handle('other.csv'));
    await saveHandle('p1', 's1', handle('a2.csv'));
    expect(await loadHandles('p1')).toEqual(new Map([['s1', handle('a2.csv')], ['s2', handle('b.csv')]]));
    expect(await loadHandles('p2')).toEqual(new Map([['s1', handle('other.csv')]]));
    expect(await loadHandles('none')).toEqual(new Map());
  });

  it('deletes a project’s handles, or only those of sources it no longer has', async () => {
    await saveHandle('p1', 's1', handle('a.csv'));
    await saveHandle('p1', 's2', handle('b.csv'));
    await saveHandle('p2', 's1', handle('other.csv'));
    await deleteHandles('p1', ['s2']);
    expect([...(await loadHandles('p1')).keys()]).toEqual(['s2']);
    await deleteHandles('p1');
    expect((await loadHandles('p1')).size).toBe(0);
    expect((await loadHandles('p2')).size).toBe(1);
  });

  it('copies handles to a duplicated project', async () => {
    await saveHandle('p1', 's1', handle('a.csv'));
    await copyHandles('p1', 'copy');
    expect(await loadHandles('copy')).toEqual(new Map([['s1', handle('a.csv')]]));
    expect((await loadHandles('p1')).size).toBe(1);
  });

  it('keeps projects saved by the previous database version when it adds the handles store', async () => {
    await closeDb();
    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.open('puddle', 1);
      req.onupgradeneeded = () => req.result.createObjectStore('projects', { keyPath: 'id' }).put({ ...createProject('From v1'), id: 'old' });
      req.onsuccess = () => {
        req.result.close();
        resolve();
      };
      req.onerror = () => reject(req.error);
    });
    expect((await loadProject('old'))!.name).toBe('From v1');
    await saveHandle('old', 's1', handle('a.csv'));
    expect((await loadHandles('old')).size).toBe(1);
  });

  it('keeps a sync credential apart from every project, and deletes it', async () => {
    const p = createProject('Synced');
    await saveProject(p);
    await saveCredential({ provider: 'gist', secret: 'github_pat_secret', account: 'kev' });
    expect(await loadCredential('gist')).toEqual({ provider: 'gist', secret: 'github_pat_secret', account: 'kev' });
    expect(JSON.stringify(await loadProject(p.id))).not.toContain('github_pat_secret');
    await deleteCredential('gist');
    expect(await loadCredential('gist')).toBeUndefined();
  });

  it('keeps sync links by project', async () => {
    await saveSyncLink({ projectId: 'p1', provider: 'gist' });
    await saveSyncLink({ projectId: 'p1', provider: 'gist', remoteId: 'g1', revision: 'r1', syncedHash: 'h' });
    await saveSyncLink({ projectId: 'p2', provider: 'gist' });
    expect(await loadSyncLink('p1')).toEqual({ projectId: 'p1', provider: 'gist', remoteId: 'g1', revision: 'r1', syncedHash: 'h' });
    expect((await listSyncLinks()).map((l) => l.projectId).sort()).toEqual(['p1', 'p2']);
    await deleteSyncLink('p1');
    expect(await loadSyncLink('p1')).toBeUndefined();
  });

  it('keeps projects and handles from version 2 when it adds the sync stores', async () => {
    await closeDb();
    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.open('puddle', 2);
      req.onupgradeneeded = () => {
        req.result.createObjectStore('projects', { keyPath: 'id' }).put({ ...createProject('From v2'), id: 'old' });
        req.result.createObjectStore('handles', { keyPath: 'key' }).createIndex('projectId', 'projectId');
      };
      req.onsuccess = () => {
        req.result.close();
        resolve();
      };
      req.onerror = () => reject(req.error);
    });
    expect((await loadProject('old'))!.name).toBe('From v2');
    await saveSyncLink({ projectId: 'old', provider: 'gist' });
    expect(await loadSyncLink('old')).toEqual({ projectId: 'old', provider: 'gist' });
  });
});
