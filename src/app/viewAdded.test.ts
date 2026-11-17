import { beforeEach, describe, expect, it } from 'vitest';
import { addNode, createProject, useProjectStore, type Project } from '../model';
import { addNodeAfterSelection, addTableFromSql } from './actions';
import { useSession } from './session';

const present = () => useProjectStore.getState().history.present;
const id = (name: string) => present().nodes.find((n) => n.name === name)!.id;

/** Two Transforms, the first one viewed. */
function load() {
  let p: Project = createProject('View what you add');
  p = addNode(p, 'transform', { x: 0, y: 0 });
  p = addNode(p, 'transform', { x: 0, y: 200 });
  useProjectStore.getState().load(p);
  useProjectStore.getState().setView({ viewedNodeId: p.nodes[0]!.id, viewedStepIndex: undefined });
  useSession.setState({ selectedNodeId: null, selectedNodeIds: [], notice: null, designerNodeId: null });
}

describe('a node that was just added', () => {
  beforeEach(load);

  it.each(['output', 'sql', 'append'] as const)('is shown in the results: %s after the selected node', (type) => {
    useSession.getState().select(id('Transform 1'));
    addNodeAfterSelection(type);
    const added = present().nodes.at(-1)!;
    expect(added.type).toBe(type);
    expect(useSession.getState().selectedNodeId).toBe(added.id);
    expect(present().view.viewedNodeId).toBe(added.id);
  });

  it('is shown when it joins two selected nodes', () => {
    useSession.getState().select(id('Transform 1'));
    useSession.getState().toggleSelected(id('Transform 2'));
    addNodeAfterSelection('join');
    const join = present().nodes.at(-1)!;
    expect(join.type).toBe('join');
    expect(present().view.viewedNodeId).toBe(join.id);
  });

  it('is shown when it is a table from SQL', () => {
    useSession.getState().select(id('Transform 1'));
    addTableFromSql();
    expect(present().view.viewedNodeId).toBe(useSession.getState().selectedNodeId);
    expect(present().view.viewedNodeId).not.toBe(id('Transform 1'));
  });

  it('is only selected while the results are pinned', () => {
    useProjectStore.getState().setView({ pinned: true });
    useSession.getState().select(id('Transform 1'));
    addNodeAfterSelection('output');
    expect(useSession.getState().selectedNodeId).toBe(present().nodes.at(-1)!.id);
    expect(present().view.viewedNodeId).toBe(id('Transform 1'));
  });
});
