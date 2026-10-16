import { flow, src, step } from '../../tests/helpers/projects';
import { setAppendSpec, swapAppendInputs } from './append';
import { addNode } from './edits';
import { canConnect, connect, freePort, inputPorts } from './graph';
import { initHistory, pushHistory, undo } from './history';
import { parseProject } from './project';
import { placeStep } from './quickfix';
import type { AppendNode, Project } from './schema';

const base = () =>
  flow({
    sources: [src({ id: 'a', format: 'csv' })],
    nodes: [
      { id: 's1', type: 'source', sourceId: 'a' },
      { id: 's2', type: 'source', sourceId: 'a' },
      { id: 's3', type: 'source', sourceId: 'a' },
      { id: 'ap', type: 'append' },
      { id: 'out', type: 'output' },
    ],
    wires: [['ap', 'out']],
  });

const edge = (from: string, port: number) => ({ id: `x_${from}_${port}`, from: { nodeId: from }, to: { nodeId: 'ap', port } });
const appendOf = (p: Project) => p.nodes.find((n) => n.type === 'append') as AppendNode;
const ports = (p: Project) => inputPorts(p, appendOf(p)).map((x) => x.id);
const wiresIn = (p: Project, id = 'ap') => p.edges.filter((e) => e.to.nodeId === id).map((e) => [e.from.nodeId, e.to.port]);

describe('append ports', () => {
  it('starts with two numbered inputs and gains one when the last is wired', () => {
    let p = base();
    expect(ports(p)).toEqual([0, 1]);
    expect(inputPorts(p, appendOf(p)).map((x) => x.label)).toEqual(['Input 1', 'Input 2']);
    p = connect(p, edge('s1', 0));
    expect(ports(p)).toEqual([0, 1]);
    p = connect(p, edge('s2', 1));
    expect(ports(p)).toEqual([0, 1, 2]);
    p = connect(p, edge('s3', 2));
    expect(ports(p)).toEqual([0, 1, 2, 3]);
  });

  it('keeps an empty input in the middle where it is, so the others keep their numbers', () => {
    let p = connect(connect(connect(base(), edge('s1', 0)), edge('s2', 1)), edge('s3', 2));
    p = { ...p, edges: p.edges.filter((e) => e.id !== 'x_s2_1') };
    expect(ports(p)).toEqual([0, 1, 2, 3]);
    expect(freePort(p, 'ap')).toBe(1);
  });

  it('takes one wire per input and refuses a name instead of a number', () => {
    const p = connect(base(), edge('s1', 0));
    expect(canConnect(p, 's2', 'ap', 0)).toEqual({ ok: false, reason: 'Input 1 of ap already has a wire. Remove it first.' });
    expect(canConnect(p, 's2', 'ap', 1)).toEqual({ ok: true });
    expect(canConnect(p, 's2', 'ap')).toEqual({ ok: true });
    expect(canConnect(p, 's2', 'ap', 'left')).toEqual({ ok: false, reason: 'ap has no input called left.' });
    expect(canConnect(p, 'out', 'ap', 1)).toMatchObject({ ok: false });
  });
});

describe('adding and editing an append', () => {
  it('adds an append wired from every node given, in order', () => {
    const p = addNode(base(), 'append', { x: 0, y: 0 }, ['s2', 's1', 's3'], 'ap2');
    expect(p.nodes.find((n) => n.id === 'ap2')).toMatchObject({ name: 'Append 1', appendSpec: { match: 'name', tagRows: false, tagColumn: 'source' } });
    expect(wiresIn(p, 'ap2')).toEqual([
      ['s2', 0],
      ['s1', 1],
      ['s3', 2],
    ]);
  });

  it('edits its settings as one undoable change', () => {
    let h = initHistory(base());
    h = pushHistory(h, setAppendSpec(h.present, 'ap', { match: 'position', tagRows: true }));
    expect(appendOf(h.present).appendSpec).toEqual({ match: 'position', tagRows: true, tagColumn: 'source' });
    expect(appendOf(undo(h).present).appendSpec.match).toBe('name');
    expect(setAppendSpec(base(), 'out', { match: 'position' })).toEqual(base());
  });

  it('moves an input by swapping wires, into an empty input too', () => {
    const p = connect(connect(base(), edge('s1', 0)), edge('s2', 1));
    const s = swapAppendInputs(p, 'ap', 0, 1);
    expect(wiresIn(s)).toEqual([
      ['s1', 1],
      ['s2', 0],
    ]);
    expect(swapAppendInputs(s, 'ap', 0, 1)).toEqual(p);
    expect(wiresIn(swapAppendInputs(p, 'ap', 1, 2))).toEqual([
      ['s1', 0],
      ['s2', 2],
    ]);
    expect(swapAppendInputs(p, 'ap', 2, 3)).toBe(p);
    expect(swapAppendInputs(p, 'out', 0, 1)).toBe(p);
  });

  it('round-trips through the saved format, and fills in default settings', () => {
    const p = connect(base(), edge('s1', 0));
    expect(parseProject(JSON.parse(JSON.stringify(p)))).toEqual(p);
    const bare = parseProject({ ...p, nodes: p.nodes.map((n) => (n.type === 'append' ? { id: n.id, type: 'append', name: n.name } : n)) });
    expect(appendOf(bare).appendSpec).toEqual({ match: 'name', tagRows: false, tagColumn: 'source' });
  });

  it('a quick fix on a viewed append goes into a new node after it', () => {
    const p = { ...base(), view: { ...base().view, viewedNodeId: 'ap' } };
    const placed = placeStep(p, step('s', 'trimWhitespace', { columns: ['name'] }), 't')!;
    expect(placed.nodeId).toBe('t');
    expect(placed.project.edges.map((e) => [e.from.nodeId, e.to.nodeId])).toEqual([
      ['t', 'out'],
      ['ap', 't'],
    ]);
  });
});
