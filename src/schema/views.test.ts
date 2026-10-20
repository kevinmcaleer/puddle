import { describe, expect, it } from 'vitest';
import { createProject, editSchema, parseProject, setSchemaDbml, type Project } from '../model';
import { layoutDiagram } from './diagram/geometry';
import { parseDbml } from './parse';
import { addSchemaView, addToSchemaView, currentView, deleteSchemaView, duplicateSchemaView, hideFromSchemaView, moveInSchemaView, openSchemaView, renameSchemaView, setSchemaDetail, setSchemaZoom, showCanvasInSchema, viewPositions, viewTables } from './views';

// Ten tables: orders refs users and products, and each of t1 to t7 refs users.
const TEN = [
  'Table users {\n  id int [pk]\n  name text\n}',
  'Table products {\n  id int [pk]\n  title text\n}',
  'Table orders {\n  id int [pk]\n  user_id int [ref: > users.id]\n  product_id int [ref: > products.id]\n  note text\n}',
  ...[1, 2, 3, 4, 5, 6, 7].map((i) => `Table t${i} {\n  id int [pk]\n  user_id int [ref: > users.id]\n}`),
  'Note hello {\n  \'A note\'\n}',
].join('\n\n');

const T = (name: string) => `table:public.${name}`;
const project = (): Project => setSchemaDbml(createProject('p'), TEN);
const reopen = (p: Project) => parseProject(JSON.parse(JSON.stringify(p)));

describe('diagram views', () => {
  it('shows three of ten tables, with the refs between them, while All tables still shows ten', () => {
    const { project: p } = addSchemaView(project(), [T('users'), T('orders'), T('products')]);
    const schema = parseDbml(p.schema.dbml).schema;
    const view = currentView(p.schema);
    const shown = layoutDiagram(schema, viewPositions(p.schema, view), { only: viewTables(view) });
    expect(shown.tables.map((t) => t.id).sort()).toEqual([T('orders'), T('products'), T('users')]);
    expect(shown.refs).toHaveLength(2);
    expect(shown.notes).toHaveLength(0);
    const all = layoutDiagram(schema, viewPositions(p.schema, undefined), { only: viewTables(undefined) });
    expect(all.tables).toHaveLength(10);
    expect(all.refs).toHaveLength(9);
    expect(all.notes).toHaveLength(1);
  });

  it('opens a new view from the selection, named so it does not clash', () => {
    const { project: p, id } = addSchemaView(project(), [T('users'), T('users')]);
    expect(p.schema.view).toBe(id);
    expect(currentView(p.schema)).toMatchObject({ name: 'View 1', tables: [T('users')], detail: 'full' });
    const { project: q } = addSchemaView(p);
    expect(currentView(q.schema)).toMatchObject({ name: 'View 2', tables: [] });
    expect(openSchemaView(q, undefined).schema.view).toBeUndefined();
  });

  it('adds and hides tables, without touching the DBML or other views', () => {
    const made = addSchemaView(project(), [T('users')]);
    const id = made.id;
    let p = made.project;
    const other = addSchemaView(p, [T('users')]);
    p = addToSchemaView(other.project, id, [T('orders'), T('users')]);
    expect(p.schema.views[0]!.tables).toEqual([T('users'), T('orders')]);
    p = moveInSchemaView(openSchemaView(p, id), { [T('users')]: { x: 5, y: 5 } });
    p = hideFromSchemaView(p, id, [T('users')]);
    expect(p.schema.views[0]).toMatchObject({ tables: [T('orders')], positions: {} });
    expect(p.schema.views[1]!.tables).toEqual([T('users')]);
    expect(p.schema.dbml).toBe(TEN);
    expect(hideFromSchemaView(p, id, [T('t1')])).toBe(p);
  });

  it('keeps places per view: moving a table in a view leaves All tables where it was', () => {
    let p = moveInSchemaView(project(), { [T('users')]: { x: 100, y: 100 } });
    p = addSchemaView(p, [T('users'), T('orders')]).project;
    expect(viewPositions(p.schema, currentView(p.schema))[T('users')]).toEqual({ x: 100, y: 100 });
    p = moveInSchemaView(p, { [T('users')]: { x: 400, y: 20 } });
    expect(viewPositions(p.schema, currentView(p.schema))[T('users')]).toEqual({ x: 400, y: 20 });
    expect(p.schema.positions[T('users')]).toEqual({ x: 100, y: 100 });
    expect(moveInSchemaView(p, { [T('users')]: { x: 400, y: 20 } })).toBe(p);
  });

  it('gives each view its own detail level and zoom', () => {
    let p = setSchemaDetail(project(), 'names');
    p = addSchemaView(p, [T('users')]).project;
    expect(currentView(p.schema)!.detail).toBe('names');
    p = setSchemaDetail(p, 'keys');
    p = setSchemaZoom(p, { x: 10, y: 20, k: 0.5 });
    expect(currentView(p.schema)).toMatchObject({ detail: 'keys', zoom: { x: 10, y: 20, k: 0.5 } });
    expect(p.schema.detail).toBe('names');
    expect(p.schema.zoom).toBeUndefined();
    expect(setSchemaZoom(p, { x: 10, y: 20, k: 0.5 })).toBe(p);
  });

  it('renames, duplicates and deletes a view', () => {
    const made = addSchemaView(project(), [T('users')], 'Sales');
    const id = made.id;
    let p = made.project;
    p = renameSchemaView(p, id, '  Billing ');
    expect(currentView(p.schema)!.name).toBe('Billing');
    expect(renameSchemaView(p, id, '  ')).toBe(p);
    const copy = duplicateSchemaView(p, id);
    const again = duplicateSchemaView(copy.project, id);
    expect(again.project.schema.views.map((v) => v.name)).toEqual(['Billing', 'Billing copy 2', 'Billing copy']);
    expect(again.project.schema.view).toBe(again.id);
    p = deleteSchemaView(again.project, again.id);
    expect(p.schema.view).toBeUndefined();
    expect(p.schema.views).toHaveLength(2);
  });

  it('follows a table renamed or deleted on the diagram, and puts a table added in a view into it', () => {
    const made = addSchemaView(project(), [T('users'), T('orders')]);
    const id = made.id;
    let p = made.project;
    p = moveInSchemaView(p, { [T('users')]: { x: 7, y: 7 } });
    p = editSchema(p, p.schema.dbml.replace('Table users', 'Table people'), { renamed: { from: T('users'), to: T('people') } });
    expect(p.schema.views[0]).toMatchObject({ tables: [T('people'), T('orders')], positions: { [T('people')]: { x: 7, y: 7 } } });
    p = editSchema(p, p.schema.dbml, { deleted: T('orders') });
    expect(p.schema.views[0]!.tables).toEqual([T('people')]);
    p = editSchema(p, `${p.schema.dbml}\nTable extra {\n  id int\n}`, { places: { [T('extra')]: { x: 1, y: 2 } } });
    expect(p.schema.views[0]).toMatchObject({ tables: [T('people'), T('extra')], positions: { [T('extra')]: { x: 1, y: 2 } } });
    expect(p.schema.positions[T('extra')]).toBeUndefined();
    expect(p.schema.view).toBe(id);
  });

  it('survives reopening the project: views, places, detail levels and zoom', () => {
    let p = addSchemaView(project(), [T('users'), T('orders')]).project;
    p = setSchemaDetail(moveInSchemaView(p, { [T('orders')]: { x: 300, y: 40 } }), 'keys');
    p = setSchemaZoom(p, { x: 1, y: 2, k: 1.5 });
    expect(reopen(p).schema).toEqual(p.schema);
  });

  it('turns the canvas’s tables off and on, saved with the project, and leaves the project alone when nothing changes', () => {
    const p = project();
    expect(p.schema.hideCanvas).toBeUndefined();
    expect(showCanvasInSchema(p, true)).toBe(p);
    const off = showCanvasInSchema(p, false);
    expect(reopen(off).schema.hideCanvas).toBe(true);
    expect(reopen(showCanvasInSchema(off, true)).schema.hideCanvas).toBeUndefined();
  });
});
