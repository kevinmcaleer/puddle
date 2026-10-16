import { flow, src, step } from '../../tests/helpers/projects';
import { addNode } from './edits';
import { canConnect, connect, freePort, inputPorts, parsePort } from './graph';
import { initHistory, pushHistory, undo } from './history';
import { setLookupSpec, swapLookupInputs } from './lookup';
import { parseProject } from './project';
import { placeStep } from './quickfix';
import type { LookupNode, Project } from './schema';

const base = () =>
  flow({
    sources: [src({ id: 'a', format: 'csv' })],
    nodes: [
      { id: 'sa', type: 'source', sourceId: 'a' },
      { id: 'sb', type: 'source', sourceId: 'a' },
      { id: 'k', type: 'lookup' },
      { id: 'out', type: 'output' },
    ],
    wires: [['k', 'out']],
  });

const edge = (from: string, port: 'main' | 'lookup') => ({ id: `x_${from}_${port}`, from: { nodeId: from }, to: { nodeId: 'k', port } });
const lookupOf = (p: Project) => p.nodes.find((n) => n.type === 'lookup') as LookupNode;
const wiresIn = (p: Project) => p.edges.filter((e) => e.to.nodeId === 'k').map((e) => [e.from.nodeId, e.to.port]);

describe('lookup ports', () => {
  it('has a main and a lookup input, one wire each', () => {
    let p = base();
    expect(inputPorts(p, lookupOf(p))).toEqual([
      { id: 'main', label: 'Main' },
      { id: 'lookup', label: 'Lookup' },
    ]);
    expect(parsePort('lookup')).toBe('lookup');
    expect(freePort(p, 'k')).toBe('main');
    p = connect(p, edge('sa', 'main'));
    expect(freePort(p, 'k')).toBe('lookup');
    expect(canConnect(p, 'sb', 'k', 'main')).toEqual({ ok: false, reason: 'The main input of k already has a wire. Remove it first.' });
    expect(canConnect(p, 'sb', 'k', 'left')).toEqual({ ok: false, reason: 'k has no input called left.' });
    expect(canConnect(p, 'sb', 'k')).toEqual({ ok: true });
  });
});

describe('adding and editing a lookup', () => {
  it('adds a lookup wired from the nodes given, main then lookup, with nothing picked yet', () => {
    const p = addNode(base(), 'lookup', { x: 0, y: 0 }, ['sb', 'sa'], 'k2');
    expect(p.nodes.find((n) => n.id === 'k2')).toMatchObject({ name: 'Lookup 1', lookupSpec: { keys: [], columns: [], suffix: '_lookup', useDefault: false, defaultValue: '' } });
    expect(p.edges.filter((e) => e.to.nodeId === 'k2').map((e) => [e.from.nodeId, e.to.port])).toEqual([
      ['sb', 'main'],
      ['sa', 'lookup'],
    ]);
  });

  it('edits its settings as one undoable change', () => {
    let h = initHistory(base());
    h = pushHistory(h, setLookupSpec(h.present, 'k', { columns: ['name'], useDefault: true, defaultValue: 'n/a' }));
    expect(lookupOf(h.present).lookupSpec).toMatchObject({ columns: ['name'], useDefault: true, defaultValue: 'n/a' });
    expect(lookupOf(undo(h).present).lookupSpec.columns).toEqual([]);
    expect(setLookupSpec(base(), 'out', { columns: ['x'] })).toEqual(base());
  });

  it('swaps the inputs, turns each key pair round and clears the brought columns', () => {
    let p = connect(connect(base(), edge('sa', 'main')), edge('sb', 'lookup'));
    p = setLookupSpec(p, 'k', { keys: [{ main: 'customer_id', lookup: 'id' }], columns: ['name'] });
    const s = swapLookupInputs(p, 'k');
    expect(wiresIn(s)).toEqual([
      ['sa', 'lookup'],
      ['sb', 'main'],
    ]);
    expect(lookupOf(s).lookupSpec).toMatchObject({ keys: [{ main: 'id', lookup: 'customer_id' }], columns: [] });
    expect(swapLookupInputs(p, 'out')).toBe(p);
  });

  it('round-trips through the saved format, and fills in default settings', () => {
    const p = setLookupSpec(connect(base(), edge('sa', 'main')), 'k', { keys: [{ main: 'a', lookup: 'b' }], columns: ['c'] });
    expect(parseProject(JSON.parse(JSON.stringify(p)))).toEqual(p);
    const bare = parseProject({ ...p, nodes: p.nodes.map((n) => (n.type === 'lookup' ? { id: n.id, type: 'lookup', name: n.name } : n)) });
    expect(lookupOf(bare).lookupSpec).toEqual({ keys: [], columns: [], suffix: '_lookup', useDefault: false, defaultValue: '' });
  });

  it('a quick fix on a viewed lookup goes into a new node after it', () => {
    const p = { ...base(), view: { ...base().view, viewedNodeId: 'k' } };
    const placed = placeStep(p, step('s', 'trimWhitespace', { columns: ['name'] }), 't')!;
    expect(placed.project.edges.map((e) => [e.from.nodeId, e.to.nodeId])).toEqual([
      ['t', 'out'],
      ['k', 't'],
    ]);
  });
});
