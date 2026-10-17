import 'fake-indexeddb/auto';
import { createProject, useProjectStore } from '../model';
import { closeDb, deleteSyncLink, listProjects, loadHandles, loadProject, loadSyncLink, saveHandle, saveProject, saveSyncLink } from './db';
import { duplicateProject, projectOperations, removeProject, renameProject, replaceProject, useWorkspace, workspaceEvents } from './workspace';

vi.mock('../sources/attach', () => ({ attachProject: vi.fn(() => Promise.resolve()) }));

afterEach(async () => {
  await closeDb();
  await new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase('puddle');
    req.onsuccess = req.onerror = () => resolve();
  });
  projectOperations.clear();
  useWorkspace.setState({ screen: 'loading', projects: [], error: null });
});

const names = async () => (await listProjects()).map((p) => p.name).sort();

describe('undo on the projects screen', () => {
  it('brings a deleted project back with its file handles and sync link, and redo deletes it again', async () => {
    const p = { ...createProject('Sales'), notes: '# Kept' };
    await saveProject(p);
    await saveHandle(p.id, 's1', { name: 'sales.csv' });
    await saveSyncLink({ projectId: p.id, provider: 'gist', remoteId: 'r1' });
    await removeProject(p.id);
    expect(await names()).toEqual([]);
    // Sync forgets the link of a deleted project (not running here).
    await deleteSyncLink(p.id);
    expect(projectOperations.use.getState().past.map((o) => o.label)).toEqual(['Delete Sales']);

    await projectOperations.undo();
    expect(await loadProject(p.id)).toEqual(p);
    expect([...(await loadHandles(p.id)).keys()]).toEqual(['s1']);
    expect(await loadSyncLink(p.id)).toMatchObject({ provider: 'gist', remoteId: 'r1' });
    expect(useWorkspace.getState().projects.map((x) => x.name)).toEqual(['Sales']);

    await projectOperations.redo();
    expect(await loadProject(p.id)).toBeUndefined();
  });

  it('hands the sync link back through sync when sync is listening, so it lands after sync forgets it', async () => {
    const p = createProject('Synced');
    await saveProject(p);
    await saveSyncLink({ projectId: p.id, provider: 'gist' });
    const restored = vi.fn();
    workspaceEvents.restored.add(restored);
    try {
      await removeProject(p.id);
      await projectOperations.undo();
    } finally {
      workspaceEvents.restored.delete(restored);
    }
    expect(restored).toHaveBeenCalledWith({ projectId: p.id, provider: 'gist' });
  });

  it('undoes renaming a project that isn’t open', async () => {
    const p = createProject('Old name');
    await saveProject(p);
    await renameProject(p.id, ' New name ');
    expect(await names()).toEqual(['New name']);
    await projectOperations.undo();
    expect(await names()).toEqual(['Old name']);
    await projectOperations.redo();
    expect(await names()).toEqual(['New name']);
  });

  it('undoes duplicating a project, copy and handles both', async () => {
    const p = createProject('Original');
    await saveProject(p);
    await saveHandle(p.id, 's1', { name: 'a.csv' });
    const copyId = await duplicateProject(p.id);
    expect(await names()).toEqual(['Original', 'Original copy']);
    await projectOperations.undo();
    expect(await names()).toEqual(['Original']);
    expect((await loadHandles(copyId)).size).toBe(0);
    await projectOperations.redo();
    expect(await names()).toEqual(['Original', 'Original copy']);
    expect([...(await loadHandles(copyId)).keys()]).toEqual(['s1']);
  });
});

describe('a newer version of the open project', () => {
  it('takes its place as an undo step, so undo brings back the version it replaced', async () => {
    const mine = { ...createProject('Mine'), notes: 'edited here' };
    useProjectStore.getState().load(mine);
    useWorkspace.setState({ screen: 'editor' });
    const theirs = { ...mine, notes: 'edited elsewhere', updatedAt: '2030-01-01T00:00:00.000Z' };
    await replaceProject(theirs);
    expect(useProjectStore.getState().history.present).toBe(theirs);
    expect((await loadProject(mine.id))?.notes).toBe('edited elsewhere');
    useProjectStore.getState().undo();
    expect(useProjectStore.getState().history.present.notes).toBe('edited here');
  });
});
