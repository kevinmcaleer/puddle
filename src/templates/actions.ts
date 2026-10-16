// What the template dialogs do to the open project and the library.
import { create } from 'zustand';
import { positionAfter } from '../app/actions';
import { useSession } from '../app/session';
import { hasOutput, newId, nodeById, useProjectStore, type ColumnSchema, type Step } from '../model';
import { insertTemplate } from './insert';
import { addTemplate } from './library';
import { mapSteps } from './mapping';
import { createTemplate, type Template } from './template';

/** Which template dialog is open: saving a Transform node's steps, or the library. */
export type TemplateDialog = { kind: 'save'; nodeId: string } | { kind: 'library' } | null;

export const useTemplateDialog = create<{ dialog: TemplateDialog }>(() => ({ dialog: null }));

export const openTemplateDialog = (dialog: TemplateDialog) => useTemplateDialog.setState({ dialog });

/** Open the library, after closing any notice the last insert left. */
export function openTemplates() {
  useSession.getState().notify(null);
  openTemplateDialog({ kind: 'library' });
}

const report = (e: unknown) => useSession.getState().notify({ tone: 'fail', text: e instanceof Error ? e.message : String(e) });

/** The node a template inserted now would be wired after: the selected node, when it has an output. */
export function insertFeed(): string | undefined {
  const id = useSession.getState().selectedNodeId;
  const node = id ? nodeById(useProjectStore.getState().history.present, id) : undefined;
  return node && hasOutput(node) ? node.id : undefined;
}

export async function saveAsTemplate(init: { name: string; description: string; steps: Step[]; expectedColumns: ColumnSchema[] }) {
  try {
    const t = createTemplate(init);
    await addTemplate(t);
    useSession.getState().notify({ tone: 'info', text: `Saved “${t.name}” as a template. Insert it from Add node, in any project.` });
  } catch (e) {
    report(e);
  }
}

/**
 * Insert a template as one undoable edit: a Transform node wired after `feed`, its steps mapped onto `actual` (the
 * feed's columns) through `mapping`. With no known input columns the steps arrive as they were saved.
 */
export function insertTemplateAfter(template: Template, feed: string | undefined, actual: ColumnSchema[] | undefined, mapping: Record<string, string | undefined>) {
  const { apply, history } = useProjectStore.getState();
  const steps = mapSteps(template.steps, template.expectedColumns, actual ?? template.expectedColumns, actual ? mapping : {});
  const id = newId('n');
  apply((p) => insertTemplate(p, template.name, steps, positionAfter(history.present, feed ? [feed] : []), feed, id));
  useSession.getState().select(id);
  const off = steps.filter((s) => s.disabledReason).length;
  useSession.getState().notify(off ? { tone: 'warn', text: `${off} of ${steps.length} steps arrived turned off: they need columns the input doesn’t have.` } : null);
}
