import fc from 'fast-check';
import { flow, src, step } from '../../tests/helpers/projects';
import type { Project, TransformNode } from './schema';
import { addStep, canGroup, canUngroup, groupNodes, moveStep, removeStep, renameNode, setNodeNotes, splitNode, toggleStep, ungroupNode, updateStep } from './steps';

const s = (id: string) => step(id, 'trimWhitespace', { columns: ['a'] });

/** in → t1 → t2 → t3 → out, plus a second output from t3. */
const line = (stepsPer = [1, 1, 1]) =>
  flow({
    sources: [src({ id: 'src', format: 'csv' })],
    nodes: [
      { id: 'in', type: 'source', sourceId: 'src' },
      ...stepsPer.map((n, i) => ({ id: `t${i + 1}`, type: 'transform' as const, steps: Array.from({ length: n }, (_, k) => s(`t${i + 1}s${k}`)) })),
      { id: 'out', type: 'output' },
      { id: 'out2', type: 'output' },
    ],
    wires: [['in', 't1'], ...stepsPer.slice(1).map((_, i): [string, string] => [`t${i + 1}`, `t${i + 2}`]), [`t${stepsPer.length}`, 'out'], [`t${stepsPer.length}`, 'out2']],
  });

const tf = (p: Project, id: string) => p.nodes.find((n) => n.id === id) as TransformNode;
const ids = (p: Project, id: string) => tf(p, id).steps.map((x) => x.id);
/** The graph as a comparable value: order of nodes and wires doesn't matter. */
const graph = (p: Project) => JSON.parse(JSON.stringify({ nodes: [...p.nodes].sort((a, b) => a.id.localeCompare(b.id)), edges: [...p.edges].sort((a, b) => a.id.localeCompare(b.id)) }));

describe('step edits', () => {
  const p = line([3]);

  it('adds a step at the end or at a position', () => {
    expect(ids(addStep(p, 't1', s('new')), 't1')).toEqual(['t1s0', 't1s1', 't1s2', 'new']);
    expect(ids(addStep(p, 't1', s('new'), 1), 't1')).toEqual(['t1s0', 'new', 't1s1', 't1s2']);
  });

  it('updates, toggles and removes a step', () => {
    expect(tf(updateStep(p, 't1', 't1s1', { label: 'Renamed', customLabel: true }), 't1').steps[1]).toMatchObject({ label: 'Renamed', customLabel: true });
    expect(tf(toggleStep(p, 't1', 't1s1'), 't1').steps[1]!.enabled).toBe(false);
    expect(ids(removeStep(p, 't1', 't1s1'), 't1')).toEqual(['t1s0', 't1s2']);
  });

  it('drops the reason a step was off once it is turned on, and keeps it otherwise', () => {
    const off = addStep(p, 't1', { ...s('off'), enabled: false, disabledReason: 'Needs name, which the input doesn’t have.' });
    expect(tf(updateStep(off, 't1', 'off', { label: 'Renamed' }), 't1').steps[3]!.disabledReason).toMatch(/Needs name/);
    const on = tf(toggleStep(off, 't1', 'off'), 't1').steps[3]!;
    expect(on.enabled).toBe(true);
    expect('disabledReason' in on).toBe(false);
  });

  it('moves a step, and ignores moves out of range', () => {
    expect(ids(moveStep(p, 't1', 0, 2), 't1')).toEqual(['t1s1', 't1s2', 't1s0']);
    expect(moveStep(p, 't1', 0, 9)).toBe(p);
  });

  it('leaves the project untouched for unknown nodes or steps', () => {
    expect(updateStep(p, 'nope', 'x', { label: 'y' })).toBe(p);
    expect(removeStep(p, 't1', 'nope')).toBe(p);
    expect(addStep(p, 'in', s('x'))).toBe(p);
  });

  it('renames a node and sets its notes', () => {
    expect(tf(renameNode(p, 't1', '  Clean names '), 't1').name).toBe('Clean names');
    expect(renameNode(p, 't1', '   ')).toBe(p);
    expect(tf(setNodeNotes(p, 't1', 'Why'), 't1').notes).toBe('Why');
  });
});

describe('group and ungroup', () => {
  it('groups a line of transform nodes into the first, keeping the wires around it', () => {
    const g = groupNodes(line(), ['t2', 't3', 't1']);
    expect(g.nodes.map((n) => n.id)).toEqual(['in', 't1', 'out', 'out2']);
    expect(ids(g, 't1')).toEqual(['t1s0', 't2s0', 't3s0']);
    expect(g.edges.map((e) => `${e.from.nodeId}->${e.to.nodeId}`).sort()).toEqual(['in->t1', 't1->out', 't1->out2']);
    expect(canUngroup(tf(g, 't1'))).toBe(true);
  });

  it('refuses groups that are not a single line, with a reason', () => {
    expect(canGroup(line(), ['t1'])).toMatchObject({ ok: false, reason: expect.stringMatching(/two or more/) });
    expect(canGroup(line(), ['t1', 't3'])).toMatchObject({ ok: false });
    expect(canGroup(line(), ['in', 't1'])).toMatchObject({ ok: false, reason: expect.stringMatching(/Only Transform/) });
    expect(canGroup(line([1, 0]), ['t1', 't2'])).toMatchObject({ ok: false, reason: expect.stringMatching(/no steps/) });
    expect(groupNodes(line(), ['t1', 't3'])).toEqual(line());
  });

  it('group then ungroup returns the exact original graph', () => {
    fc.assert(
      fc.property(fc.array(fc.integer({ min: 1, max: 3 }), { minLength: 2, maxLength: 5 }), fc.string({ maxLength: 8 }), (stepsPer, notes) => {
        let p = line(stepsPer);
        p = setNodeNotes(p, 't2', notes);
        const all = stepsPer.map((_, i) => `t${i + 1}`);
        expect(graph(ungroupNode(groupNodes(p, all), 't1'))).toEqual(graph(p));
      }),
    );
  });

  it('splitting at an absorbed node’s first step restores that node', () => {
    const p = line([2, 2]);
    const g = groupNodes(p, ['t1', 't2']);
    expect(graph(splitNode(g, 't1', 2))).toEqual(graph(p));
  });

  it('splits a node into two wired one after the other', () => {
    const p = splitNode(line([3]), 't1', 1, 'new');
    expect(ids(p, 't1')).toEqual(['t1s0']);
    expect(ids(p, 'new')).toEqual(['t1s1', 't1s2']);
    expect(p.edges.map((e) => `${e.from.nodeId}->${e.to.nodeId}`).sort()).toEqual(['in->t1', 'new->out', 'new->out2', 't1->new']);
    expect(splitNode(line([3]), 't1', 0)).toEqual(line([3]));
  });

  it('keeps ungrouping possible after the first step of an absorbed node is deleted', () => {
    const g = groupNodes(line([1, 2]), ['t1', 't2']);
    const p = ungroupNode(removeStep(g, 't1', 't2s0'), 't1');
    expect(ids(p, 't2')).toEqual(['t2s1']);
  });
});
