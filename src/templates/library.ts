// The templates library: every template in this browser, read from IndexedDB through the migrations.
import { create } from 'zustand';
import { deleteTemplate, loadTemplates, saveTemplate } from '../persistence/db';
import { migrateTemplate } from '../persistence/templates';
import type { Template } from './template';

interface LibraryState {
  templates: Template[];
  /** Stored templates that couldn't be read (damaged, or from a newer Puddle). They stay stored, unlisted. */
  unreadable: number;
}

export const useTemplates = create<LibraryState>(() => ({ templates: [], unreadable: 0 }));

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
  await saveTemplate(template);
  await refreshTemplates();
}

/** Change a template's name or description. A blank name keeps the old one. */
export async function editTemplate(id: string, patch: { name?: string; description?: string }): Promise<void> {
  const t = useTemplates.getState().templates.find((x) => x.id === id);
  if (!t) return;
  const name = patch.name?.trim() || t.name;
  const description = patch.description?.trim() ?? t.description;
  if (name === t.name && description === t.description) return;
  await saveTemplate({ ...t, name, description, updatedAt: new Date().toISOString() });
  await refreshTemplates();
}

export async function removeTemplate(id: string): Promise<void> {
  await deleteTemplate(id);
  await refreshTemplates();
}
