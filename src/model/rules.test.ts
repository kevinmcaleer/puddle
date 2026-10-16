import { addNode } from './edits';
import { createProject, parseProject } from './project';
import { dismissSuggestion } from './rules';

describe('dismissed suggestions', () => {
  const base = () => {
    const p = addNode(createProject('Dismiss'), 'transform', { x: 0, y: 0 });
    return { p, id: p.nodes[0]!.id };
  };

  it('are kept per node, once each', () => {
    const { p, id } = base();
    const once = dismissSuggestion(p, id, 'inSet:status');
    const twice = dismissSuggestion(once, id, 'inSet:status');
    expect(twice.nodes[0]!.dismissedSuggestions).toEqual(['inSet:status']);
    expect(dismissSuggestion(twice, id, 'unique:id').nodes[0]!.dismissedSuggestions).toEqual(['inSet:status', 'unique:id']);
    expect(dismissSuggestion(p, 'other', 'unique:id').nodes[0]!.dismissedSuggestions).toBeUndefined();
  });

  it('survive saving and loading the project', () => {
    const { p, id } = base();
    const saved = JSON.parse(JSON.stringify(dismissSuggestion(p, id, 'notEmpty:email')));
    expect(parseProject(saved).nodes[0]!.dismissedSuggestions).toEqual(['notEmpty:email']);
  });
});
