import { beforeEach, describe, expect, it } from 'vitest';
import { addNode, createProject, useProjectStore, type Project } from '../model';
import { selectNeighbour, viewSelected } from './actions';
import { useSession } from './session';

const present = () => useProjectStore.getState().history.present;
const id = (name: string) => present().nodes.find((n) => n.name === name)!.id;

/** A Transform feeding an Output, the Transform selected and viewed. */
function load() {
  let p: Project = createProject('Arrows');
  p = addNode(p, 'transform', { x: 0, y: 0 });
  p = addNode(p, 'output', { x: 300, y: 0 }, p.nodes[0]!.id);
  useProjectStore.getState().load(p);
  useSession.setState({ designerNodeId: null });
  useSession.getState().select(id('Transform 1'));
  useProjectStore.getState().setView({ viewedNodeId: id('Transform 1'), pinned: false });
}

describe('the arrow keys (principle 7: a key leaves the screen as a click does)', () => {
  beforeEach(load);

  it('select and view the next node along the wires', () => {
    selectNeighbour('downstream');
    expect(useSession.getState().selectedNodeId).toBe(id('Output 1'));
    expect(present().view.viewedNodeId).toBe(id('Output 1'));
  });

  it('only select while the table is pinned, and V then moves the pin to the selection', () => {
    useProjectStore.getState().setView({ pinned: true });
    selectNeighbour('downstream');
    expect(useSession.getState().selectedNodeId).toBe(id('Output 1'));
    expect(present().view.viewedNodeId).toBe(id('Transform 1'));
    viewSelected();
    expect(present().view.viewedNodeId).toBe(id('Output 1'));
    expect(present().view.pinned).toBe(true);
  });

  it('V views the selection when the table is not pinned', () => {
    useSession.getState().select(id('Output 1'));
    viewSelected();
    expect(present().view.viewedNodeId).toBe(id('Output 1'));
    expect(present().view.pinned).toBe(false);
  });
});
