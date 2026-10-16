import fc from 'fast-check';
import { flow, src, step } from '../../tests/helpers/projects';
import { addNode } from './edits';
import { canConnect, connect, freePort, GraphError, inputPorts, parsePort, topoSort } from './graph';
import { initHistory, pushHistory, redo, undo } from './history';
import { setJoinSpec, swapJoinInputs } from './join';
import { parseProject } from './project';
import { placeStep } from './quickfix';
import { groupNodes, ungroupNode } from './steps';
import type { JoinNode, Project } from './schema';

const twoSources = () =>
  flow({
    sources: [src({ id: 'a', format: 'csv' }), src({ id: 'b', format: 'csv' })],
    nodes: [
      { id: 'sa', type: 'source', sourceId: 'a' },
      { id: 'sb', type: 'source', sourceId: 'b' },
      { id: 'sc', type: 'source', sourceId: 'a' },
      { id: 'j', type: 'join' },
      { id: 'out', type: 'output' },
    ],
    wires: [['j', 'out']],
  });

const edge = (from: string, to: string, port: 'left' | 'right' | 0) => ({ id: `x_${from}_${port}`, from: { nodeId: from }, to: { nodeId: to, port } });
const joinOf = (p: Project) => p.nodes.find((n) => n.type === 'join') as JoinNode;

describe('join ports', () => {
  it('has a left and a right input, and parses port handles', () => {
    const p = twoSources();
    expect(inputPorts(p, joinOf(p)).map((x) => x.id)).toEqual(['left', 'right']);
    expect(parsePort('left')).toBe('left');
    expect(parsePort('0')).toBe(0);
    expect(parsePort('middle')).toBeUndefined();
    expect(parsePort(null)).toBeUndefined();
  });

  it('accepts one wire per input, picking the free one when none is named', () => {
    let p = twoSources();
    expect(freePort(p, 'j')).toBe('left');
    p = connect(p, edge('sa', 'j', 'left'));
    expect(freePort(p, 'j')).toBe('right');
    expect(canConnect(p, 'sb', 'j', 'left')).toEqual({ ok: false, reason: 'The left input of j already has a wire. Remove it first.' });
    expect(canConnect(p, 'sa', 'j', 'left')).toEqual({ ok: false, reason: 'These nodes are already connected.' });
    expect(canConnect(p, 'sb', 'j')).toEqual({ ok: true });
    p = connect(p, edge('sb', 'j', 'right'));
    expect(freePort(p, 'j')).toBeUndefined();
    expect(canConnect(p, 'sc', 'j')).toEqual({ ok: false, reason: 'Every input of j already has a wire. Remove one first.' });
    expect(canConnect(p, 'sa', 'out', 'left')).toMatchObject({ ok: false });
  });

  it('lets one node feed both inputs (a self-join)', () => {
    const p = connect(twoSources(), edge('sa', 'j', 'left'));
    expect(canConnect(p, 'sa', 'j', 'right')).toEqual({ ok: true });
  });

  it('refuses an input a node doesn’t have, and a wire that would loop through either input', () => {
    const p = twoSources();
    expect(canConnect(p, 'sa', 'j', 0)).toEqual({ ok: false, reason: 'j has no input called 0.' });
    const withT = parseProject({ ...p, nodes: [...p.nodes, { id: 't', type: 'transform', name: 't', steps: [] }], edges: [...p.edges, edge('t', 'j', 'right')] });
    const looped = { ...withT, edges: withT.edges.filter((e) => e.to.nodeId !== 'out') };
    expect(canConnect(looped, 'j', 't')).toMatchObject({ ok: false, reason: expect.stringContaining('loop') });
    expect(() => connect(looped, edge('j', 't', 0))).toThrow(GraphError);
  });
});

describe('adding and editing a join', () => {
  it('adds a left join wired from the nodes given, left then right', () => {
    const base = twoSources();
    const p = addNode(base, 'join', { x: 0, y: 0 }, ['sa', 'sb', 'sc'], 'j2');
    const j = p.nodes.find((n) => n.id === 'j2') as JoinNode;
    expect(j).toMatchObject({ name: 'Join 1', joinSpec: { kind: 'left', keys: [], suffix: '_right' } });
    expect(p.edges.filter((e) => e.to.nodeId === 'j2').map((e) => [e.from.nodeId, e.to.port])).toEqual([
      ['sa', 'left'],
      ['sb', 'right'],
    ]);
    expect(addNode(base, 'join', { x: 0, y: 0 }, 'out', 'j3').edges.some((e) => e.to.nodeId === 'j3')).toBe(false);
  });

  it('edits the join settings as one undoable change', () => {
    const p = twoSources();
    let h = initHistory(p);
    h = pushHistory(h, setJoinSpec(h.present, 'j', { kind: 'anti', keys: [{ left: 'id', right: 'id' }] }));
    expect(joinOf(h.present).joinSpec).toEqual({ kind: 'anti', keys: [{ left: 'id', right: 'id' }], suffix: '_right' });
    h = undo(h);
    expect(joinOf(h.present).joinSpec.kind).toBe('left');
    expect(joinOf(redo(h).present).joinSpec.kind).toBe('anti');
    expect(setJoinSpec(p, 'out', { kind: 'inner' })).toBe(p);
  });

  it('swaps the inputs and turns each key pair round', () => {
    let p = connect(connect(twoSources(), edge('sa', 'j', 'left')), edge('sb', 'j', 'right'));
    p = setJoinSpec(p, 'j', { keys: [{ left: 'customer_id', right: 'id' }] });
    const s = swapJoinInputs(p, 'j');
    expect(s.edges.filter((e) => e.to.nodeId === 'j').map((e) => [e.from.nodeId, e.to.port])).toEqual([
      ['sa', 'right'],
      ['sb', 'left'],
    ]);
    expect(joinOf(s).joinSpec.keys).toEqual([{ left: 'id', right: 'customer_id' }]);
    expect(swapJoinInputs(s, 'j')).toEqual(p);
  });

  it('round-trips through the saved format, and old files without joins still read', () => {
    const p = connect(twoSources(), edge('sa', 'j', 'left'));
    expect(parseProject(JSON.parse(JSON.stringify(p)))).toEqual(p);
    const bare = parseProject({ ...p, nodes: p.nodes.map((n) => (n.type === 'join' ? { id: n.id, type: 'join', name: n.name } : n)) });
    expect(joinOf(bare).joinSpec).toEqual({ kind: 'left', keys: [], suffix: '_right' });
  });

  it('a quick fix on a viewed join goes into a new node after it', () => {
    const p = { ...twoSources(), view: { ...twoSources().view, viewedNodeId: 'j' } };
    const placed = placeStep(p, step('s', 'trimWhitespace', { columns: ['name'] }), 't')!;
    expect(placed.nodeId).toBe('t');
    expect(placed.project.edges.map((e) => [e.from.nodeId, e.to.nodeId])).toEqual([
      ['t', 'out'],
      ['j', 't'],
    ]);
  });
});

describe('properties', () => {
  it('any sequence of attempted wires into joins and transforms keeps one wire per input and no loops', () => {
    const ports = [undefined, 0, 'left', 'right'] as const;
    fc.assert(
      fc.property(fc.array(fc.tuple(fc.nat(), fc.nat(), fc.nat()), { maxLength: 40 }), (attempts) => {
        let p = flow({
          sources: [src({ id: 'a', format: 'csv' })],
          nodes: [
            { id: 's', type: 'source', sourceId: 'a' },
            { id: 't1', type: 'transform' },
            { id: 't2', type: 'transform' },
            { id: 'j1', type: 'join' },
            { id: 'j2', type: 'join' },
            { id: 'o', type: 'output' },
          ],
        });
        const ids = p.nodes.map((n) => n.id);
        attempts.forEach(([a, b, k], i) => {
          const from = ids[a % ids.length]!;
          const to = ids[b % ids.length]!;
          const port = ports[k % ports.length] ?? freePort(p, to) ?? 0;
          try {
            p = connect(p, { id: `e${i}`, from: { nodeId: from }, to: { nodeId: to, port } });
          } catch (e) {
            expect(e).toBeInstanceOf(GraphError);
          }
        });
        expect(topoSort(p)).toHaveLength(ids.length);
        const used = p.edges.map((e) => `${e.to.nodeId}:${String(e.to.port)}`);
        expect(new Set(used).size).toBe(used.length);
        for (const e of p.edges) expect(inputPorts(p, p.nodes.find((n) => n.id === e.to.nodeId)!).some((x) => String(x.id) === String(e.to.port))).toBe(true);
      }),
    );
  });
});

describe('grouping around a join', () => {
  const branchy = () =>
    flow({
      sources: [src({ id: 'a', format: 'csv' })],
      nodes: [
        { id: 's', type: 'source', sourceId: 'a' },
        { id: 't1', type: 'transform', steps: [step('a', 'trimWhitespace', { columns: ['x'] })] },
        { id: 't2', type: 'transform', steps: [step('b', 'trimWhitespace', { columns: ['y'] })] },
        { id: 'j', type: 'join' },
      ],
      wires: [['s', 't1'], ['t1', 't2'], ['t2', 'j', 'right'], ['s', 'j', 'left']],
    });

  it('keeps the port of the wire leaving a grouped line, and ungrouping restores the graph', () => {
    const p = branchy();
    const g = groupNodes(p, ['t1', 't2']);
    expect(g.edges.find((e) => e.to.nodeId === 'j' && e.to.port === 'right')?.from.nodeId).toBe('t1');
    const back = ungroupNode(g, 't1');
    const sorted = (x: Project) => [...x.edges].sort((a, b) => (a.id < b.id ? -1 : 1));
    expect(sorted(back)).toEqual(sorted(p));
  });
});
