import 'fake-indexeddb/auto';
import { createProject } from '../model';
import { closeDb, deleteProject, listProjects, loadProject, saveProject } from './db';

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
