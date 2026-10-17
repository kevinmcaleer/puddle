import { createProject, parseProject, type ColumnSchema, type Project, type Step, type TransformNode } from '../model';
import { matchSource, MATCH_NODE_NAME } from './match';

const v = (name: string): ColumnSchema => ({ name, type: 'VARCHAR' });
const step = (id: string, type: string, params: Record<string, unknown>): Step => ({ id, type, label: `${type} ${id}`, enabled: true, params });
const expected = [v('name'), v('email'), v('city')];

/** A recipe-made project: source `s` (expecting name, email, city) feeding `feeds`. */
function project(feeds: 'transform' | 'join'): Project {
  const base = createProject('Recipe', new Date('2026-10-01T00:00:00Z'));
  const steps = [step('a', 'trimWhitespace', { columns: ['name', 'email'] }), step('b', 'changeCase', { columns: ['city'], mode: 'title' }), step('c', 'duplicateRows', { columns: [] })];
  return parseProject({
    ...base,
    sources: [
      { id: 's', name: 'Contacts', kind: 'file', format: 'csv', parseOptions: {}, detectedSchema: expected, expected },
      { id: 's2', name: 'Other', kind: 'file', format: 'csv', parseOptions: {}, detectedSchema: [] },
    ],
    nodes: [
      { id: 'in', type: 'source', name: 'Contacts', sourceId: 's', position: { x: 10, y: 20 } },
      { id: 'in2', type: 'source', name: 'Other', sourceId: 's2' },
      feeds === 'transform' ? { id: 't', type: 'transform', name: 'Tidy', steps } : { id: 'j', type: 'join', name: 'Join' },
      { id: 'after', type: 'transform', name: 'After', steps: [step('d', 'changeCase', { columns: ['city'], mode: 'upper' }), step('e', 'changeCase', { columns: ['other'], mode: 'upper' })] },
      { id: 'side', type: 'transform', name: 'Side', steps: [step('f', 'trimWhitespace', { columns: ['city'] })] },
    ],
    edges:
      feeds === 'transform'
        ? [
            { id: 'e1', from: { nodeId: 'in' }, to: { nodeId: 't', port: 0 } },
            { id: 'e2', from: { nodeId: 't' }, to: { nodeId: 'after', port: 0 } },
            { id: 'e3', from: { nodeId: 'in2' }, to: { nodeId: 'side', port: 0 } },
          ]
        : [
            { id: 'e1', from: { nodeId: 'in' }, to: { nodeId: 'j', port: 'left' } },
            { id: 'e2', from: { nodeId: 'in2' }, to: { nodeId: 'j', port: 'right' } },
            { id: 'e3', from: { nodeId: 'j' }, to: { nodeId: 'after', port: 0 } },
          ],
  });
}

const transform = (p: Project, id: string) => p.nodes.find((n) => n.id === id) as TransformNode;

describe('matchSource', () => {
  it('only stops expecting columns when the file has them all, whatever their case', () => {
    const p = project('transform');
    const next = matchSource(p, 's', [v('Name'), v('EMAIL'), v('city'), v('extra')], {});
    expect(next.sources[0]!.expected).toBeUndefined();
    expect(next.nodes).toEqual(p.nodes);
    expect(next.edges).toEqual(p.edges);
  });

  it('renames mapped columns back to the recipe’s names at the start of the Transform node the source feeds', () => {
    const next = matchSource(project('transform'), 's', [v('full_name'), v('email'), v('town')], { name: 'full_name', city: 'town' });
    const t = transform(next, 't');
    expect(t.steps.map((s) => s.type)).toEqual(['renameColumns', 'trimWhitespace', 'changeCase', 'duplicateRows']);
    expect(t.steps[0]!.params).toEqual({ renames: [{ from: 'full_name', to: 'name' }, { from: 'town', to: 'city' }] });
    expect(t.steps[0]!.label).toBe('Renamed 2 columns');
    expect(t.steps.every((s) => s.enabled)).toBe(true);
    expect(next.sources[0]!.expected).toBeUndefined();
  });

  it('adds a Match columns node when the source doesn’t feed a Transform node of its own', () => {
    const p = project('join');
    const next = matchSource(p, 's', [v('full_name'), v('email'), v('city')], { name: 'full_name' });
    const added = next.nodes.find((n) => n.name === MATCH_NODE_NAME) as TransformNode;
    expect(added.steps.map((s) => s.label)).toEqual(['Renamed full_name to name']);
    expect(added.position).toEqual({ x: 130, y: 120 });
    expect(next.edges.find((e) => e.to.nodeId === added.id)?.from.nodeId).toBe('in');
    expect(next.edges.find((e) => e.to.nodeId === 'j' && e.to.port === 'left')?.from.nodeId).toBe(added.id);
    expect(next.edges.find((e) => e.to.nodeId === 'j' && e.to.port === 'right')?.from.nodeId).toBe('in2');
  });

  it('turns off steps after the source that read a column left unmapped, saying which, and leaves other branches alone', () => {
    const next = matchSource(project('transform'), 's', [v('name'), v('email')], { city: '' });
    const t = transform(next, 't');
    expect(t.steps.map((s) => s.enabled)).toEqual([true, false, true]);
    expect(t.steps[1]!.disabledReason).toMatch(/^Needs city, which the input doesn’t have/);
    expect(transform(next, 'after').steps.map((s) => s.enabled)).toEqual([false, true]);
    expect(transform(next, 'side').steps[0]!.enabled).toBe(true);
  });

  it('ignores a mapping to a column the file doesn’t have', () => {
    const next = matchSource(project('transform'), 's', [v('name'), v('email')], { city: 'nowhere' });
    expect(transform(next, 't').steps.map((s) => s.type)).toEqual(['trimWhitespace', 'changeCase', 'duplicateRows']);
    expect(transform(next, 't').steps[1]!.enabled).toBe(false);
  });

  it('does nothing but forget the expectation for a source that has none', () => {
    const p = project('transform');
    expect(matchSource(p, 's2', [v('x')], {})).toEqual(p);
  });
});
