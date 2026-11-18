import { beforeEach, describe, expect, it } from 'vitest';
import { addNode, createProject, type Project } from '../model';
import { useSession } from './session';
import { currentView, designerTarget, showView, viewItems, viewsInUse } from './views';

const closed = { schemaOpen: false, relationshipsOpen: false, designerNodeId: null, selectedNodeId: null };

describe('the view switcher (principle 5: one screen, no modes)', () => {
  let p: Project;
  beforeEach(() => {
    p = addNode(createProject('Views'), 'transform', { x: 0, y: 0 });
    useSession.setState({ schemaOpen: false, relationshipsOpen: false, designerNodeId: null, selectedNodeId: null, notice: null });
  });

  // #295: an empty project was offered Relationships, Designer and Schema, three views of nothing.
  it('shows only the canvas until the project has something for the other views', () => {
    expect(viewItems(createProject('Empty'), closed)).toEqual([{ id: 'canvas', label: 'Canvas' }]);
    expect(viewItems(p, closed)).toEqual([{ id: 'canvas', label: 'Canvas' }]);
    expect(viewsInUse(p)).toEqual({ relationships: false, designer: false, schema: false });
    // The designer still says how to get it when asked for by its key.
    showView(p, 'designer');
    expect(useSession.getState().notice?.text).toBe('Add a Query node to design a query.');
  });

  it('adds each view’s tab once the project uses it', () => {
    const source = (id: string) => ({ id, name: `${id}.csv`, kind: 'file', format: 'csv', parseOptions: {}, detectedSchema: [] }) as Project['sources'][number];
    const one = { ...p, sources: [source('a')] };
    expect(viewsInUse(one).relationships).toBe(false);
    const two = { ...p, sources: [source('a'), source('b')] };
    expect(viewItems(two, closed).map((t) => t.label)).toEqual(['Canvas', 'Relationships']);
    for (const type of ['join', 'lookup'] as const) expect(viewItems(addNode(one, type, { x: 0, y: 0 }), closed).map((t) => t.label)).toEqual(['Canvas', 'Relationships']);
    expect(viewItems(addNode(p, 'query', { x: 0, y: 0 }), closed).map((t) => t.label)).toEqual(['Canvas', 'Relationships', 'Query designer: Query 1']);
    const designed = { ...p, schema: { ...p.schema!, dbml: 'Table users {\n  id int\n}' } };
    expect(viewItems(designed, closed).map((t) => t.label)).toEqual(['Canvas', 'Schema']);
    expect(viewItems(addNode(p, 'table', { x: 0, y: 0 }), closed).map((t) => t.label)).toEqual(['Canvas', 'Schema']);
  });

  it('keeps the tab of a view that is showing, though the project has nothing for it yet', () => {
    expect(viewItems(p, { ...closed, relationshipsOpen: true }).map((t) => t.label)).toEqual(['Canvas', 'Relationships']);
    expect(viewItems(p, { ...closed, schemaOpen: true }).map((t) => t.label)).toEqual(['Canvas', 'Schema']);
  });

  it('names the designer after the Query it opens: the open one, else the selected one, else the first', () => {
    p = addNode(addNode(p, 'query', { x: 300, y: 0 }), 'query', { x: 600, y: 0 });
    const [, q1, q2] = p.nodes.map((n) => n.id);
    expect(designerTarget(p, closed)).toBe(q1);
    expect(designerTarget(p, { ...closed, selectedNodeId: q2! })).toBe(q2);
    expect(designerTarget(p, { ...closed, selectedNodeId: q2!, designerNodeId: q1! })).toBe(q1);
    expect(viewItems(p, closed)[2]).toEqual({ id: 'designer', label: 'Query designer: Query 1' });
  });

  it('switches between the surfaces, and says which is showing', () => {
    p = addNode(p, 'query', { x: 300, y: 0 });
    const query = p.nodes[1]!.id;
    const now = () => currentView(p, useSession.getState());
    expect(now()).toBe('canvas');
    showView(p, 'relationships');
    expect(now()).toBe('relationships');
    showView(p, 'designer');
    expect(now()).toBe('designer');
    expect(useSession.getState().designerNodeId).toBe(query);
    expect(useSession.getState().relationshipsOpen).toBe(false);
    showView(p, 'schema');
    expect(now()).toBe('schema');
    expect(useSession.getState().designerNodeId).toBeNull();
    showView(p, 'canvas');
    expect(now()).toBe('canvas');
    showView(p, 'schema');
    showView(p, 'canvas');
    expect(useSession.getState().schemaOpen).toBe(false);
  });
});
