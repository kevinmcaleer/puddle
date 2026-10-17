import { flow, src, step } from '../../tests/helpers/projects';
import { useProjectStore, type TransformNode } from '../model';
import { insertTemplate } from './insert';
import { createTemplate, notTemplatable, searchTemplates } from './template';

const origin = { nodeId: 'gone', name: 'Gone', position: { x: 0, y: 0 }, rules: [], edgeId: 'e9' };

describe('creating templates', () => {
  it('keeps steps and expected columns, never where a step came from or why it was off', () => {
    const t = createTemplate({
      name: '  Tidy names ',
      description: ' Trims names. ',
      steps: [{ ...step('a', 'trimWhitespace', { columns: ['name'] }), origin }, { ...step('b', 'changeCase', { columns: ['name'], mode: 'upper' }, false), disabledReason: 'Needs name' }],
      expectedColumns: [{ name: 'name', type: 'VARCHAR', extra: 'x' } as never],
    });
    expect(t).toMatchObject({ name: 'Tidy names', description: 'Trims names.', expectedColumns: [{ name: 'name', type: 'VARCHAR' }] });
    expect(t.steps.map((s) => [s.id, s.enabled])).toEqual([
      ['a', true],
      ['b', false],
    ]);
    expect(JSON.stringify(t)).not.toMatch(/origin|disabledReason|extra|gone/);
  });

  it('leaves out steps set up from one table’s rows, which would carry its data', () => {
    const transpose = step('t', 'transpose', { columns: ['a'], rowCount: 2, headerValues: ['Ada Lovelace', 'Grace Hopper'], headers: true });
    expect(notTemplatable(transpose)).toMatch(/Transpose/);
    const t = createTemplate({ name: 'Mixed', steps: [step('a', 'trimWhitespace', { columns: ['name'] }), transpose], expectedColumns: [] });
    expect(t.steps.map((s) => s.type)).toEqual(['trimWhitespace']);
    expect(JSON.stringify(t)).not.toMatch(/Ada Lovelace/);
  });

  it('refuses a template with no name or no steps', () => {
    expect(() => createTemplate({ name: ' ', steps: [step('a', 'trimWhitespace', { columns: ['name'] })], expectedColumns: [] })).toThrow();
    expect(() => createTemplate({ name: 'Empty', steps: [], expectedColumns: [] })).toThrow();
  });

  it('searches names, descriptions and expected columns, every word', () => {
    const a = createTemplate({ name: 'Tidy names', description: 'For contact lists', steps: [step('a', 'trimWhitespace', { columns: ['name'] })], expectedColumns: [{ name: 'email', type: 'VARCHAR' }] });
    const b = createTemplate({ name: 'Fix dates', steps: [step('a', 'trimWhitespace', { columns: ['joined'] })], expectedColumns: [{ name: 'joined', type: 'VARCHAR' }] });
    expect(searchTemplates([a, b], '')).toEqual([a, b]);
    expect(searchTemplates([a, b], 'CONTACT')).toEqual([a]);
    expect(searchTemplates([a, b], 'joined')).toEqual([b]);
    expect(searchTemplates([a, b], 'tidy dates')).toEqual([]);
  });
});

describe('inserting a template', () => {
  const project = () =>
    flow({
      sources: [src({ id: 'c', format: 'csv' })],
      nodes: [
        { id: 'in', type: 'source', sourceId: 'c' },
        { id: 't', type: 'transform' },
      ],
      wires: [['in', 't']],
    });
  const steps = [step('x', 'trimWhitespace', { columns: ['name'] })];

  it('adds a Transform node named after the template, holding its steps, wired after the chosen node', () => {
    const p = insertTemplate(project(), 'Tidy names', steps, { x: 300, y: 0 }, 'in', 'new');
    const node = p.nodes.find((n) => n.id === 'new') as TransformNode;
    expect(node).toMatchObject({ type: 'transform', name: 'Tidy names', steps, position: { x: 300, y: 0 } });
    expect(p.edges.filter((e) => e.to.nodeId === 'new').map((e) => e.from.nodeId)).toEqual(['in']);
  });

  it('numbers the name when a node already has it, and leaves the node unwired with nothing chosen', () => {
    const once = insertTemplate(project(), 'Tidy names', steps, { x: 0, y: 0 }, undefined, 'a');
    const twice = insertTemplate(once, 'Tidy names', steps, { x: 0, y: 0 }, undefined, 'b');
    expect(twice.nodes.find((n) => n.id === 'b')!.name).toBe('Tidy names 2');
    expect(twice.edges.some((e) => e.to.nodeId === 'b')).toBe(false);
  });

  it('is one undo step', () => {
    const store = useProjectStore.getState();
    store.load(project());
    store.apply((p) => insertTemplate(p, 'Tidy names', steps, { x: 0, y: 0 }, 't', 'new'));
    expect(useProjectStore.getState().history.present.nodes).toHaveLength(3);
    useProjectStore.getState().undo();
    const back = useProjectStore.getState().history.present;
    expect(back.nodes.map((n) => n.id)).toEqual(['in', 't']);
    expect(back.edges).toHaveLength(1);
    expect(useProjectStore.getState().canUndo()).toBe(false);
  });
});
