import 'fake-indexeddb/auto';
import { step } from '../../tests/helpers/projects';
import { FORMAT_VERSION } from '../model';
import { closeDb, saveTemplate } from '../persistence/db';
import { addTemplate, editTemplate, refreshTemplates, removeTemplate, templateOperations, useTemplates } from './library';
import { createTemplate } from './template';

afterEach(async () => {
  await closeDb();
  await new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase('puddle');
    req.onsuccess = req.onerror = () => resolve();
  });
  useTemplates.setState({ templates: [], unreadable: 0 });
  templateOperations.clear();
});

const make = (name: string) => createTemplate({ name, steps: [step('a', 'trimWhitespace', { columns: ['name'] })], expectedColumns: [{ name: 'name', type: 'VARCHAR' }] });

describe('templates library', () => {
  it('lists saved templates by name and reads them again after a reload', async () => {
    await addTemplate(make('Tidy names'));
    await addTemplate(make('Fix dates'));
    useTemplates.setState({ templates: [], unreadable: 0 });
    await closeDb();
    await refreshTemplates();
    expect(useTemplates.getState().templates.map((t) => t.name)).toEqual(['Fix dates', 'Tidy names']);
  });

  it('renames, edits the description and deletes', async () => {
    const t = make('Tidy names');
    await addTemplate(t);
    await editTemplate(t.id, { name: 'Tidy contact names', description: ' For CRM exports ' });
    expect(useTemplates.getState().templates[0]).toMatchObject({ name: 'Tidy contact names', description: 'For CRM exports' });
    await editTemplate(t.id, { name: '  ' });
    expect(useTemplates.getState().templates[0]!.name).toBe('Tidy contact names');
    await removeTemplate(t.id);
    expect(useTemplates.getState().templates).toEqual([]);
  });

  it('upgrades old templates as it reads them, and counts ones it can’t read without listing them', async () => {
    const { formatVersion: _, ...old } = make('Old');
    await saveTemplate(old as never);
    await saveTemplate({ ...make('Future'), formatVersion: FORMAT_VERSION + 1 } as never);
    await refreshTemplates();
    expect(useTemplates.getState().templates.map((t) => [t.name, t.formatVersion])).toEqual([['Old', FORMAT_VERSION]]);
    expect(useTemplates.getState().unreadable).toBe(1);
  });

  it('undoes and redoes adding, renaming and deleting a template', async () => {
    const t = make('Tidy names');
    const names = () => useTemplates.getState().templates.map((x) => x.name);
    await addTemplate(t);
    await editTemplate(t.id, { name: 'Tidy contact names' });
    await removeTemplate(t.id);
    expect(templateOperations.use.getState().past.map((o) => o.label)).toEqual(['Add Tidy names', 'Rename Tidy names', 'Delete Tidy contact names']);
    await templateOperations.undo();
    expect(names()).toEqual(['Tidy contact names']);
    await templateOperations.undo();
    expect(names()).toEqual(['Tidy names']);
    await templateOperations.undo();
    expect(names()).toEqual([]);
    await templateOperations.redo();
    await templateOperations.redo();
    expect(names()).toEqual(['Tidy contact names']);
    // Undone records come back whole, steps and all, even after a reload.
    await closeDb();
    await refreshTemplates();
    expect(useTemplates.getState().templates[0]!.steps).toEqual(t.steps);
  });
});
