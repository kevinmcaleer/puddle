// The surfaces that stand where the canvas does: the canvas itself, the relationships view, a Query node's designer
// and the Schema view. Principle 5 (one screen, no modes): each is listed, named and one click or key away, and switching keeps
// the toolbar, inspector, results and status strip in place.
import type { TabItem } from '../ui';
import type { Project } from '../model';
import { useSession } from './session';

export type CanvasView = 'canvas' | 'relationships' | 'designer' | 'schema';

interface ViewState {
  schemaOpen: boolean;
  relationshipsOpen: boolean;
  designerNodeId: string | null;
  selectedNodeId: string | null;
}

/** Which surface is showing now. */
export function currentView(project: Project, s: ViewState): CanvasView {
  if (s.schemaOpen) return 'schema';
  if (s.relationshipsOpen) return 'relationships';
  if (s.designerNodeId && project.nodes.some((n) => n.id === s.designerNodeId && n.type === 'query')) return 'designer';
  return 'canvas';
}

/** The Query node the designer opens on: the one open, else the selected one, else the project's first. */
export function designerTarget(project: Project, s: ViewState): string | undefined {
  const queries = project.nodes.filter((n) => n.type === 'query');
  return (queries.find((n) => n.id === s.designerNodeId) ?? queries.find((n) => n.id === s.selectedNodeId) ?? queries[0])?.id;
}

/** Whether the project has something for each of the extra views to show. */
export function viewsInUse(project: Project): Record<Exclude<CanvasView, 'canvas'>, boolean> {
  return {
    // Two tables can be related; so can one table and whatever a Join, Lookup or Query brings to it.
    relationships: project.sources.length >= 2 || project.nodes.some((n) => n.type === 'join' || n.type === 'lookup' || n.type === 'query'),
    designer: project.nodes.some((n) => n.type === 'query'),
    schema: (project.schema?.dbml ?? '').trim() !== '' || project.nodes.some((n) => n.type === 'table'),
  };
}

/**
 * The switcher's tabs. The canvas is always one. Relationships, the query designer (named after the Query it opens)
 * and the Schema are tabs once the project has something for them, or while they are the view showing; until then
 * they are opened from the project menu (and their keys), so an empty project isn't offered views of nothing.
 */
export function viewItems(project: Project, s: ViewState): TabItem[] {
  const target = designerTarget(project, s);
  const name = target ? project.nodes.find((n) => n.id === target)?.name : undefined;
  const used = viewsInUse(project);
  const now = currentView(project, s);
  const items: TabItem[] = [{ id: 'canvas', label: 'Canvas' }];
  if (used.relationships || now === 'relationships') items.push({ id: 'relationships', label: 'Relationships' });
  if (target) items.push({ id: 'designer', label: `Query designer: ${name}` });
  if (used.schema || now === 'schema') items.push({ id: 'schema', label: 'Schema' });
  return items;
}

/** Show a surface in the canvas's place. */
export function showView(project: Project, view: CanvasView) {
  const session = useSession.getState();
  if (view === 'canvas') {
    session.setSchemaOpen(false);
    session.setRelationshipsOpen(false);
    session.openDesigner(null);
  } else if (view === 'relationships') {
    session.setRelationshipsOpen(true);
  } else if (view === 'schema') {
    session.setSchemaOpen(true);
  } else {
    const target = designerTarget(project, session);
    if (target) session.openDesigner(target);
    else session.notify({ tone: 'info', text: 'Add a Query node to design a query.' });
  }
}
