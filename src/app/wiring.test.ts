import { beforeEach, describe, expect, it } from 'vitest';
import { addNode, createProject, inputEdges, useProjectStore, type Project } from '../model';
import { cancelWiring, openSelected, startWiring } from './actions';
import { useSession } from './session';

const present = () => useProjectStore.getState().history.present;
const id = (name: string) => present().nodes.find((n) => n.name === name)!.id;
const select = (name: string) => useSession.getState().select(id(name));

/** Two Transforms and an Output, nothing wired. */
function load() {
  let p: Project = createProject('Wiring');
  p = addNode(p, 'transform', { x: 0, y: 0 });
  p = addNode(p, 'transform', { x: 300, y: 0 });
  p = addNode(p, 'output', { x: 600, y: 0 });
  useProjectStore.getState().load(p);
  useSession.setState({ selectedNodeId: null, selectedNodeIds: [], connectFrom: null, notice: null, designerNodeId: null });
}

describe('wiring from the keyboard', () => {
  beforeEach(load);

  it('wires the node C started from into the node chosen next, as one undo step', () => {
    select('Transform 1');
    startWiring();
    expect(useSession.getState().connectFrom).toBe(id('Transform 1'));
    expect(useSession.getState().notice?.text).toMatch(/^Wiring from Transform 1\./);
    select('Transform 2');
    openSelected(() => undefined);
    expect(inputEdges(present(), id('Transform 2')).map((e) => e.from.nodeId)).toEqual([id('Transform 1')]);
    expect(useSession.getState().connectFrom).toBeNull();
    expect(useSession.getState().notice?.text).toBe('Wired Transform 1 into Transform 2.');
    useProjectStore.getState().undo();
    expect(inputEdges(present(), id('Transform 2'))).toEqual([]);
  });

  it('takes a wire away when the chosen node is already fed from the first, and C finishes as Enter does', () => {
    select('Transform 1');
    startWiring();
    select('Transform 2');
    startWiring();
    select('Transform 1');
    startWiring();
    select('Transform 2');
    startWiring();
    expect(inputEdges(present(), id('Transform 2'))).toEqual([]);
    expect(useSession.getState().notice?.text).toBe('Removed the wire from Transform 1 into Transform 2.');
  });

  it('says why a wire can’t be made, and stops wiring', () => {
    select('Output 1');
    startWiring();
    select('Transform 1');
    openSelected(() => undefined);
    expect(inputEdges(present(), id('Transform 1'))).toEqual([]);
    expect(useSession.getState().notice?.tone).toBe('warn');
    expect(useSession.getState().connectFrom).toBeNull();
  });

  it('waits for another node when the same one is chosen, and Escape cancels', () => {
    select('Transform 1');
    startWiring();
    openSelected(() => undefined);
    expect(useSession.getState().connectFrom).toBe(id('Transform 1'));
    expect(cancelWiring()).toBe(true);
    expect(useSession.getState().connectFrom).toBeNull();
    expect(useSession.getState().notice?.text).toBe('Wiring cancelled.');
    // With nothing to cancel, Escape is left alone.
    expect(cancelWiring()).toBe(false);
  });

  it('asks for a node first when nothing is selected', () => {
    startWiring();
    expect(useSession.getState().connectFrom).toBeNull();
    expect(useSession.getState().notice?.text).toBe('Select a node to wire from first.');
  });
});

describe('opening a node with Enter', () => {
  beforeEach(load);

  it('opens a Query in its designer and anything else in the inspector', () => {
    let focused = 0;
    useSession.setState({ inspectorOpen: false, inspectorTab: 'project' });
    select('Transform 1');
    openSelected(() => focused++);
    expect(focused).toBe(1);
    expect(useSession.getState().inspectorOpen).toBe(true);

    useProjectStore.getState().apply((p) => addNode(p, 'query', { x: 0, y: 200 }));
    select('Query 1');
    openSelected(() => focused++);
    expect(useSession.getState().designerNodeId).toBe(id('Query 1'));
    expect(focused).toBe(1);
  });
});
