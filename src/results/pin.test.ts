import { flow, src } from '../../tests/helpers/projects';
import { useProjectStore } from '../model';
import { closeCompare, comparedNode, compareWith, offeredNode, togglePin, viewHere, viewNode } from './pin';

const project = () =>
  flow({
    sources: [src({ id: 's', format: 'csv' })],
    nodes: [
      { id: 'in', type: 'source', sourceId: 's' },
      { id: 't1', type: 'transform' },
      { id: 'out', type: 'output' },
    ],
    wires: [['in', 't1'], ['t1', 'out']],
  });

const view = () => useProjectStore.getState().history.present.view;
const present = () => useProjectStore.getState().history.present;

describe('pinning the results table', () => {
  beforeEach(() => useProjectStore.getState().load(project()));

  it('follows clicks until pinned, then stays put', () => {
    viewNode('in');
    expect(view().viewedNodeId).toBe('in');
    togglePin();
    expect(view().pinned).toBe(true);
    viewNode('out');
    expect(view().viewedNodeId).toBe('in');
    togglePin();
    expect(view().pinned).toBe(false);
    viewNode('out');
    expect(view().viewedNodeId).toBe('out');
  });

  it('has nothing to pin before a node is viewed', () => {
    togglePin();
    expect(view().pinned).toBe(false);
  });

  it('keeps the failing-rows filter when pinning', () => {
    useProjectStore.getState().setView({ viewedNodeId: 'in', failingRuleId: 'r1' });
    togglePin();
    expect(view()).toMatchObject({ pinned: true, failingRuleId: 'r1' });
  });

  it('offers a node selected elsewhere, to view here or compare', () => {
    viewNode('in');
    expect(offeredNode(present(), 'out')).toBeUndefined();
    togglePin();
    expect(offeredNode(present(), 'out')?.id).toBe('out');
    expect(offeredNode(present(), 'in')).toBeUndefined();
    expect(offeredNode(present(), null)).toBeUndefined();

    compareWith('out');
    expect(view().compare).toEqual({ nodeId: 'out' });
    expect(comparedNode(present())?.id).toBe('out');
    expect(offeredNode(present(), 'out')).toBeUndefined();

    viewHere('t1');
    expect(view()).toMatchObject({ viewedNodeId: 't1', pinned: true, compare: undefined });
  });

  it('compares only with the table pinned, and never a node with itself', () => {
    viewNode('in');
    compareWith('out');
    expect(view().compare).toBeUndefined();
    togglePin();
    compareWith('in');
    expect(view().compare).toBeUndefined();
    compareWith('out');
    closeCompare();
    expect(view()).toMatchObject({ pinned: true, compare: undefined });
  });

  it('unpinning ends a comparison', () => {
    viewNode('in');
    togglePin();
    compareWith('out');
    togglePin();
    expect(view()).toMatchObject({ pinned: false, compare: undefined });
  });

  it('none of it is an undo step', () => {
    viewNode('in');
    togglePin();
    compareWith('out');
    viewHere('t1');
    expect(useProjectStore.getState().history.past).toHaveLength(0);
  });
});
