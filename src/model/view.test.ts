import { flow, src, step } from '../../tests/helpers/projects';
import { addSource, removeNodes } from './edits';
import { parseProject } from './project';
import type { Project, ProjectView } from './schema';
import { groupNodes } from './steps';
import { useProjectStore } from './store';
import { carryPin, viewWithout } from './view';

const base = () =>
  flow({
    sources: [src({ id: 's', format: 'csv' })],
    nodes: [
      { id: 'in', type: 'source', sourceId: 's' },
      { id: 't1', type: 'transform', steps: [step('a', 'trim', {})] },
      { id: 't2', type: 'transform', steps: [step('b', 'trim', {})] },
      { id: 'out', type: 'output' },
    ],
    wires: [['in', 't1'], ['t1', 't2'], ['t2', 'out']],
  });

const viewing = (p: Project, view: Partial<ProjectView>): Project => ({ ...p, view: { ...p.view, ...view } });

describe('pinned and compared view', () => {
  it('is saved with the project', () => {
    const p = viewing(base(), { viewedNodeId: 'in', pinned: true, compare: { nodeId: 'out' } });
    const back = parseProject(JSON.parse(JSON.stringify(p)));
    expect(back.view).toMatchObject({ viewedNodeId: 'in', pinned: true, compare: { nodeId: 'out' } });
  });

  it('reads older projects, which have no comparison, as not comparing', () => {
    const p = base();
    const { compare: _none, ...view } = p.view;
    expect(parseProject({ ...p, view }).view.compare).toBeUndefined();
  });

  it('removing the compared node ends the comparison; removing the pinned node clears the pin too', () => {
    const p = viewing(base(), { viewedNodeId: 'in', pinned: true, compare: { nodeId: 'out' } });
    expect(removeNodes(p, ['out']).view).toMatchObject({ viewedNodeId: 'in', pinned: true, compare: undefined });
    expect(removeNodes(p, ['in']).view).toMatchObject({ viewedNodeId: undefined, pinned: false, compare: undefined });
    expect(removeNodes(p, ['t1']).view).toBe(p.view);
  });

  it('viewWithout leaves a view whose nodes all exist untouched', () => {
    const p = viewing(base(), { viewedNodeId: 'in', pinned: true, compare: { nodeId: 'out' } });
    expect(viewWithout(p)).toBe(p.view);
  });

  it('grouping the compared node ends the comparison', () => {
    const p = viewing(base(), { viewedNodeId: 'in', pinned: true, compare: { nodeId: 't2' } });
    expect(groupNodes(p, ['t1', 't2']).view).toMatchObject({ viewedNodeId: 'in', pinned: true, compare: undefined });
    const q = viewing(base(), { viewedNodeId: 't2', pinned: true, compare: { nodeId: 't1' } });
    expect(groupNodes(q, ['t1', 't2']).view).toMatchObject({ viewedNodeId: 't1', compare: undefined });
  });

  it('adding a source views it, unless the table is pinned', () => {
    const pinned = viewing(base(), { viewedNodeId: 'out', pinned: true });
    expect(addSource(pinned, src({ id: 's2', format: 'csv' }), { x: 0, y: 0 }, 'n2').view.viewedNodeId).toBe('out');
    expect(addSource(base(), src({ id: 's2', format: 'csv' }), { x: 0, y: 0 }, 'n2').view.viewedNodeId).toBe('n2');
  });
});

describe('carryPin', () => {
  it('keeps the pin and comparison across undo', () => {
    const from = viewing(base(), { viewedNodeId: 'in', pinned: true, compare: { nodeId: 'out' } });
    const to = viewing(base(), { viewedNodeId: 't1' });
    expect(carryPin(to, from).view).toMatchObject({ viewedNodeId: 'in', pinned: true, compare: { nodeId: 'out' } });
  });

  it('keeps an unpinned table unpinned', () => {
    const from = base();
    const to = viewing(base(), { viewedNodeId: 't1', pinned: true, compare: { nodeId: 'out' } });
    expect(carryPin(to, from).view).toMatchObject({ viewedNodeId: 't1', pinned: false, compare: undefined });
  });

  it('drops what the restored project lacks', () => {
    const from = viewing(base(), { viewedNodeId: 'in', pinned: true, compare: { nodeId: 'out' } });
    expect(carryPin(removeNodes(base(), ['out']), from).view).toMatchObject({ viewedNodeId: 'in', pinned: true, compare: undefined });
    expect(carryPin(removeNodes(base(), ['in']), from).view).toMatchObject({ pinned: false, compare: undefined });
  });

  it('returns the project itself when nothing changes', () => {
    const p = viewing(base(), { viewedNodeId: 'in', pinned: true });
    expect(carryPin(p, p)).toBe(p);
  });
});

describe('store', () => {
  beforeEach(() => useProjectStore.getState().load(base()));
  const view = () => useProjectStore.getState().history.present.view;

  it('pinning is not an undo step, and undo keeps the pin', () => {
    const s = useProjectStore.getState();
    s.setView({ viewedNodeId: 'in' });
    s.apply((p) => ({ ...p, name: 'Renamed' }));
    useProjectStore.getState().setView({ pinned: true, compare: { nodeId: 'out' } });
    expect(useProjectStore.getState().history.past).toHaveLength(1);
    useProjectStore.getState().undo();
    expect(useProjectStore.getState().history.present.name).toBe('Test');
    expect(view()).toMatchObject({ viewedNodeId: 'in', pinned: true, compare: { nodeId: 'out' } });
    useProjectStore.getState().setView({ pinned: false });
    useProjectStore.getState().redo();
    expect(view()).toMatchObject({ pinned: false, compare: undefined });
  });

  it('never pins nothing, nor compares a node with itself or without a pin', () => {
    const s = useProjectStore.getState();
    s.setView({ pinned: true });
    expect(view().pinned).toBe(false);
    s.setView({ viewedNodeId: 'in', pinned: true, compare: { nodeId: 'out' } });
    s.setView({ viewedNodeId: 'out' });
    expect(view()).toMatchObject({ viewedNodeId: 'out', pinned: true, compare: undefined });
    s.setView({ compare: { nodeId: 'in' } });
    s.setView({ pinned: false });
    expect(view().compare).toBeUndefined();
  });
});
