import { beforeEach, describe, expect, it } from 'vitest';
import { addNode, addStep, createProject, inputEdges, outputEdges, useProjectStore, type Project, type TransformNode } from '../model';
import { stepForm } from '../steps';
import { addNodeAfterSelection, addStepFromMenu, SELECT_FIRST } from './actions';
import { useSession } from './session';

const present = () => useProjectStore.getState().history.present;
const byName = (name: string) => present().nodes.find((n) => n.name === name)!;
const transforms = () => present().nodes.filter((n): n is TransformNode => n.type === 'transform');
const trim = stepForm('trimWhitespace')!;

/** A source feeding an Output, nothing selected. (No engine: the step's defaults come from no columns.) */
function load(stacked = false) {
  let p: Project = createProject('Menu');
  p = { ...p, sources: [{ id: 's', name: 'a.csv', kind: 'clipboard', clipboard: { text: 'a\n1' }, format: 'csv', parseOptions: {}, detectedSchema: [] }] };
  p = { ...p, nodes: [{ id: 'in', type: 'source', sourceId: 's', name: 'a.csv', position: { x: 0, y: 0 }, rules: [] }] };
  p = addNode(p, 'output', { x: 600, y: 0 }, 'in');
  if (stacked) p = { ...p, settings: { ...p.settings, stepsAsNodes: false } };
  useProjectStore.getState().load(p);
  useSession.setState({ selectedNodeId: null, selectedNodeIds: [], selectedStepId: null, selectedColumns: [], notice: null });
}

describe('a step from the Add menu', () => {
  beforeEach(() => load());

  it('goes in a Transform of its own between the selected node and what it fed, selected and viewed', async () => {
    useSession.getState().select('in');
    await addStepFromMenu(trim);
    const [t] = transforms();
    expect(t?.steps.map((s) => s.type)).toEqual(['trimWhitespace']);
    expect(outputEdges(present(), 'in').map((e) => e.to.nodeId)).toEqual([t!.id]);
    expect(inputEdges(present(), byName('Output 1').id).map((e) => e.from.nodeId)).toEqual([t!.id]);
    expect(useSession.getState().selectedNodeId).toBe(t!.id);
    expect(useSession.getState().selectedStepId).toBe(t!.steps[0]!.id);
    expect(present().view).toMatchObject({ viewedNodeId: t!.id, viewedStepIndex: 0 });
  });

  it('after a one-step Transform, makes the next node in the line', async () => {
    useSession.getState().select('in');
    await addStepFromMenu(trim);
    await addStepFromMenu(stepForm('removeBlankRows')!);
    const [first, second] = transforms();
    expect(transforms()).toHaveLength(2);
    expect(inputEdges(present(), second!.id).map((e) => e.from.nodeId)).toEqual([first!.id]);
    expect(inputEdges(present(), byName('Output 1').id).map((e) => e.from.nodeId)).toEqual([second!.id]);
  });

  it('stacks into the selected Transform when the project stacks steps', async () => {
    load(true);
    useSession.getState().select('in');
    await addStepFromMenu(trim);
    await addStepFromMenu(stepForm('removeBlankRows')!);
    expect(transforms()).toHaveLength(1);
    expect(transforms()[0]!.steps.map((s) => s.type)).toEqual(['trimWhitespace', 'removeBlankRows']);
  });

  it('with nothing selected, adds nothing and asks for the node to follow (principle 2), whatever is viewed', async () => {
    useProjectStore.getState().setView({ viewedNodeId: 'in' });
    const before = present();
    await addStepFromMenu(trim);
    expect(present()).toBe(before);
    expect(useSession.getState().notice?.text).toBe(SELECT_FIRST);
  });

  it('adds no node of any kind with nothing selected', () => {
    const before = present();
    for (const type of ['output', 'join', 'append', 'lookup', 'query', 'sql'] as const) addNodeAfterSelection(type);
    expect(present()).toBe(before);
  });

  it('stacks a Transform selected at an earlier step, however the project is set', async () => {
    useSession.getState().select('in');
    await addStepFromMenu(trim);
    const [t] = transforms();
    useProjectStore.getState().apply((p) => addStep(p, t!.id, { id: 'x', type: 'removeBlankRows', label: 'x', enabled: true, params: { columns: [] } }));
    useProjectStore.getState().setView({ viewedNodeId: t!.id, viewedStepIndex: 0 });
    await addStepFromMenu(stepForm('collapseSpaces')!);
    expect(transforms()).toHaveLength(1);
    expect(transforms()[0]!.steps.map((s) => s.type)).toEqual(['trimWhitespace', 'collapseSpaces', 'removeBlankRows']);
  });
});
