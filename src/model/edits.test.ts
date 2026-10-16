import { flow, src } from '../../tests/helpers/projects';
import { addNode, addSource, moveNodes, nextNodeName, removeNodes, setCollapsed, setKeepResult, setParseOptions } from './edits';
import { createProject } from './project';

const withSource = () => addSource(createProject('T'), src({ id: 's1', format: 'csv', name: 'a.csv' }), { x: 10, y: 20 }, 'n1');

describe('project edits', () => {
  it('numbers new nodes by type, filling gaps', () => {
    const p = flow({ nodes: [{ id: 'Transform 1', type: 'transform' }, { id: 'Transform 3', type: 'transform' }] });
    expect(nextNodeName(p, 'transform')).toBe('Transform 2');
    expect(nextNodeName(p, 'output')).toBe('Output 1');
  });

  it('adds a source with its Source node and views it', () => {
    const p = withSource();
    expect(p.sources.map((s) => s.id)).toEqual(['s1']);
    expect(p.nodes).toEqual([{ id: 'n1', type: 'source', name: 'a.csv', sourceId: 's1', position: { x: 10, y: 20 }, rules: [] }]);
    expect(p.view.viewedNodeId).toBe('n1');
  });

  it('wires a new node to the node it was added after', () => {
    const p = addNode(withSource(), 'transform', { x: 300, y: 20 }, 'n1', 't1');
    expect(p.nodes.at(-1)).toMatchObject({ id: 't1', type: 'transform', name: 'Transform 1', steps: [] });
    expect(p.edges).toMatchObject([{ from: { nodeId: 'n1' }, to: { nodeId: 't1', port: 0 } }]);
  });

  it('leaves a node unwired when added after nothing, or after an Output (which has no output)', () => {
    const p = addNode(withSource(), 'output', { x: 0, y: 0 }, undefined, 'o1');
    expect(p.edges).toEqual([]);
    const q = addNode(p, 'transform', { x: 0, y: 0 }, 'o1', 't1');
    expect(q.edges).toEqual([]);
  });

  it('moves nodes and leaves the project untouched when nothing moves', () => {
    const p = withSource();
    expect(moveNodes(p, {})).toBe(p);
    expect(moveNodes(p, { n1: { x: 5, y: 6 } }).nodes[0]!.position).toEqual({ x: 5, y: 6 });
  });

  it('collapses and expands a node', () => {
    const p = addNode(withSource(), 'transform', { x: 0, y: 0 }, 'n1', 't1');
    expect(setCollapsed(p, 't1', false).nodes.find((n) => n.id === 't1')!.collapsed).toBe(false);
  });

  it('keeps a node\'s result and stops keeping it, but never an Output node\'s', () => {
    let p = addNode(addNode(withSource(), 'transform', { x: 0, y: 0 }, 'n1', 't1'), 'output', { x: 0, y: 0 }, 't1', 'o1');
    p = setKeepResult(p, 't1', true);
    expect(p.nodes.find((n) => n.id === 't1')!.pinnedResult).toBe(true);
    p = setKeepResult(p, 't1', false);
    expect('pinnedResult' in p.nodes.find((n) => n.id === 't1')!).toBe(false);
    expect(setKeepResult(p, 'o1', true).nodes.find((n) => n.id === 'o1')!.pinnedResult).toBeUndefined();
  });

  it('removes nodes with their wires and orphaned sources, and clears a view that pointed at them', () => {
    let p = addNode(withSource(), 'output', { x: 0, y: 0 }, 'n1', 'o1');
    p = removeNodes(p, ['n1']);
    expect(p.nodes.map((n) => n.id)).toEqual(['o1']);
    expect(p.edges).toEqual([]);
    expect(p.sources).toEqual([]);
    expect(p.view.viewedNodeId).toBeUndefined();
  });

  it('sets parse options on one source only', () => {
    const p = addSource(withSource(), src({ id: 's2', format: 'csv' }), { x: 0, y: 0 }, 'n2');
    const q = setParseOptions(p, 's2', { delimiter: ';' });
    expect(q.sources.map((s) => s.parseOptions)).toEqual([{}, { delimiter: ';' }]);
  });
});
