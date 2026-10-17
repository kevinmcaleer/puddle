// The templates library: every template in this browser, read from IndexedDB through the migrations.
import { create } from 'zustand';
import { deleteTemplate, loadTemplates, saveTemplate } from '../persistence/db';
import { createOperations } from '../persistence/operations';
import { migrateTemplate } from '../persistence/templates';
import type { Template } from './template';

interface LibraryState {
  templates: Template[];
  /** Stored templates that couldn't be read (damaged, or from a newer Puddle). They stay stored, unlisted. */
  unreadable: number;
}

export const useTemplates = create<LibraryState>(() => ({ templates: [], unreadable: 0 }));

/** Undo and redo for the library: saving, importing, renaming and deleting templates. */
export const templateOperations = createOperations();

const put = async (template: Template) => {
  await saveTemplate(template);
  await refreshTemplates();
};
const drop = async (id: string) => {
  await deleteTemplate(id);
  await refreshTemplates();
};

const byName = (a: Template, b: Template) => a.name.localeCompare(b.name) || a.createdAt.localeCompare(b.createdAt);

/** Read every stored template again. */
export async function refreshTemplates(): Promise<void> {
  const templates: Template[] = [];
  let unreadable = 0;
  for (const raw of await loadTemplates()) {
    try {
      templates.push(migrateTemplate(raw));
    } catch {
      unreadable++;
    }
  }
  useTemplates.setState({ templates: templates.sort(byName), unreadable });
}

export async function addTemplate(template: Template): Promise<void> {
  await put(template);
  templateOperations.record({ label: `Add ${template.name}`, undo: () => drop(template.id), redo: () => put(template) });
}

/** Change a template's name or description. A blank name keeps the old one. */
export async function editTemplate(id: string, patch: { name?: string; description?: string }): Promise<void> {
  const t = useTemplates.getState().templates.find((x) => x.id === id);
  if (!t) return;
  const name = patch.name?.trim() || t.name;
  const description = patch.description?.trim() ?? t.description;
  if (name === t.name && description === t.description) return;
  const edited = { ...t, name, description, updatedAt: new Date().toISOString() };
  await put(edited);
  templateOperations.record({ label: `Rename ${t.name}`, undo: () => put(t), redo: () => put(edited) });
}

export async function removeTemplate(id: string): Promise<void> {
  const t = useTemplates.getState().templates.find((x) => x.id === id);
  await drop(id);
  if (t) templateOperations.record({ label: `Delete ${t.name}`, undo: () => put(t), redo: () => drop(id) });
}
