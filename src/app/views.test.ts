import { beforeEach, describe, expect, it } from 'vitest';
import { addNode, createProject, type Project } from '../model';
import { useSession } from './session';
import { currentView, designerTarget, showView, viewItems } from './views';

const closed = { relationshipsOpen: false, designerNodeId: null, selectedNodeId: null };

describe('the view switcher (principle 5: one screen, no modes)', () => {
  let p: Project;
  beforeEach(() => {
    p = addNode(createProject('Views'), 'transform', { x: 0, y: 0 });
    useSession.setState({ relationshipsOpen: false, designerNodeId: null, selectedNodeId: null, notice: null });
  });

  it('lists every surface, with the designer waiting for a Query node', () => {
    expect(viewItems(p, closed)).toEqual([
      { id: 'canvas', label: 'Canvas' },
      { id: 'relationships', label: 'Relationships' },
      { id: 'designer', label: 'Designer', disabled: true, title: 'Add a Query node to design a query' },
    ]);
    showView(p, 'designer');
    expect(useSession.getState().notice?.text).toBe('Add a Query node to design a query.');
  });

  it('names the designer after the Query it opens: the open one, else the selected one, else the first', () => {
    p = addNode(addNode(p, 'query', { x: 300, y: 0 }), 'query', { x: 600, y: 0 });
    const [, q1, q2] = p.nodes.map((n) => n.id);
    expect(designerTarget(p, closed)).toBe(q1);
    expect(designerTarget(p, { ...closed, selectedNodeId: q2! })).toBe(q2);
    expect(designerTarget(p, { ...closed, selectedNodeId: q2!, designerNodeId: q1! })).toBe(q1);
    expect(viewItems(p, closed)[2]).toEqual({ id: 'designer', label: 'Designer: Query 1' });
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
    showView(p, 'canvas');
    expect(now()).toBe('canvas');
  });
});
