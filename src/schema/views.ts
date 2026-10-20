// Diagram views: named subsets of the schema's tables, each with its own places, detail level and zoom. The All tables
// view is the schema doc itself; the others are in `schema.views`. A view never changes the DBML, and each change here
// is one project change, so one undo step.
import { newId, type Detail, type Position, type Project, type SchemaDoc, type SchemaView, type Zoom } from '../model';

/** The view on show, or undefined for All tables. */
export const currentView = (doc: SchemaDoc): SchemaView | undefined => (doc.view ? doc.views.find((v) => v.id === doc.view) : undefined);

/** Where a view draws its elements: its own places, else where All tables has them. */
export const viewPositions = (doc: SchemaDoc, view: SchemaView | undefined): Record<string, Position> => (view ? { ...doc.positions, ...view.positions } : doc.positions);

/** The tables a view shows, by diagram id, as `layoutDiagram` takes them; undefined for All tables (everything). */
export const viewTables = (view: SchemaView | undefined): Set<string> | undefined => (view ? new Set(view.tables) : undefined);

const withDoc = (p: Project, doc: Partial<SchemaDoc>): Project => ({
  ...p,
  schema: { ...p.schema, ...doc },
});

const withView = (p: Project, id: string, change: (v: SchemaView) => SchemaView): Project => {
  let changed = false;
  const views = p.schema.views.map((v) => {
    if (v.id !== id) return v;
    const next = change(v);
    changed ||= next !== v;
    return next;
  });
  return changed ? withDoc(p, { views }) : p;
};

const taken = (doc: SchemaDoc) => new Set(doc.views.map((v) => v.name.toLowerCase()));

/** A name for a new view that no other view has: "View 1", "View 2", … */
export function nextViewName(doc: SchemaDoc): string {
  const names = taken(doc);
  for (let i = 1; ; i++) if (!names.has(`view ${i}`)) return `View ${i}`;
}

/** The name itself when no view has it, else with the first free number after it: "Sales copy", "Sales copy 2". */
function freeViewName(doc: SchemaDoc, base: string): string {
  const names = taken(doc);
  if (!names.has(base.toLowerCase())) return base;
  for (let i = 2; ; i++) if (!names.has(`${base} ${i}`.toLowerCase())) return `${base} ${i}`;
}

/** Show the canvas's tables, queries and views with the DBML's, or only the DBML's. */
export const showCanvasInSchema = (p: Project, show: boolean): Project => (!p.schema.hideCanvas === show ? p : withDoc(p, { hideCanvas: show ? undefined : true }));

/** Show a view; undefined shows All tables. */
export const openSchemaView = (p: Project, id: string | undefined): Project => (p.schema.view === id ? p : withDoc(p, { view: id }));

/** A new view showing these tables (the selection, or none), opened. */
export function addSchemaView(p: Project, tables: string[] = [], name = nextViewName(p.schema)): { project: Project; id: string } {
  const id = newId('view');
  const from = currentView(p.schema);
  const view: SchemaView = {
    id,
    name,
    tables: [...new Set(tables)],
    positions: {},
    detail: from?.detail ?? p.schema.detail,
  };
  return {
    project: withDoc(p, { views: [...p.schema.views, view], view: id }),
    id,
  };
}

export const renameSchemaView = (p: Project, id: string, name: string): Project => {
  const n = name.trim();
  return n ? withView(p, id, (v) => (v.name === n ? v : { ...v, name: n })) : p;
};

/** A copy of a view, named "… copy", placed after it and opened. */
export function duplicateSchemaView(p: Project, id: string): { project: Project; id: string } {
  const at = p.schema.views.findIndex((v) => v.id === id);
  const from = p.schema.views[at];
  if (!from) return { project: p, id };
  const copy: SchemaView = {
    ...from,
    id: newId('view'),
    name: freeViewName(p.schema, `${from.name} copy`),
  };
  const views = [...p.schema.views.slice(0, at + 1), copy, ...p.schema.views.slice(at + 1)];
  return { project: withDoc(p, { views, view: copy.id }), id: copy.id };
}

/** Delete a view; All tables shows if it was on show. */
export function deleteSchemaView(p: Project, id: string): Project {
  if (!p.schema.views.some((v) => v.id === id)) return p;
  return withDoc(p, {
    views: p.schema.views.filter((v) => v.id !== id),
    view: p.schema.view === id ? undefined : p.schema.view,
  });
}

/** Show more tables in a view; they keep the places they have in All tables. */
export const addToSchemaView = (p: Project, id: string, tables: string[]): Project =>
  withView(p, id, (v) => {
    const add = tables.filter((t) => !v.tables.includes(t));
    return add.length ? { ...v, tables: [...v.tables, ...add] } : v;
  });

/** Hide tables from a view; they stay in the schema and in every other view. */
export const hideFromSchemaView = (p: Project, id: string, tables: string[]): Project =>
  withView(p, id, (v) => {
    if (!tables.some((t) => v.tables.includes(t))) return v;
    const positions = Object.fromEntries(Object.entries(v.positions).filter(([k]) => !tables.includes(k)));
    return {
      ...v,
      tables: v.tables.filter((t) => !tables.includes(t)),
      positions,
    };
  });

/** The detail level of the view on show. */
export function setSchemaDetail(p: Project, detail: Detail): Project {
  const view = currentView(p.schema);
  if (!view) return p.schema.detail === detail ? p : withDoc(p, { detail });
  return withView(p, view.id, (v) => (v.detail === detail ? v : { ...v, detail }));
}

/** Where the view on show is panned and zoomed to: kept with the project, though not an undo step of its own. */
export function setSchemaZoom(p: Project, zoom: Zoom): Project {
  const view = currentView(p.schema);
  const same = (z?: Zoom) => !!z && z.x === zoom.x && z.y === zoom.y && z.k === zoom.k;
  if (!view) return same(p.schema.zoom) ? p : withDoc(p, { zoom });
  return withView(p, view.id, (v) => (same(v.zoom) ? v : { ...v, zoom }));
}

/** Elements moved in the view on show: in a view the places are its own, so All tables keeps its layout. */
export function moveInSchemaView(p: Project, moves: Record<string, Position>): Project {
  const view = currentView(p.schema);
  const before = viewPositions(p.schema, view);
  if (!Object.entries(moves).some(([k, at]) => before[k]?.x !== at.x || before[k]?.y !== at.y)) return p;
  if (!view) return withDoc(p, { positions: { ...p.schema.positions, ...moves } });
  return withView(p, view.id, (v) => ({
    ...v,
    positions: { ...v.positions, ...moves },
  }));
}
