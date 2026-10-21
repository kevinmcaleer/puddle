import { describe, expect, it } from 'vitest';
import { flow } from '../../tests/helpers/projects';
import { ignoreIssue, recordAnalysis, unignoreIssue } from './issues';

const project = flow({ nodes: [{ id: 't', type: 'transform' }] });

describe('ignored issues', () => {
  it('are kept on the node by key, once each, and come back when shown again', () => {
    let p = ignoreIssue(project, 't', 'edgeSpaces:name');
    p = ignoreIssue(p, 't', 'edgeSpaces:name');
    p = ignoreIssue(p, 't', 'duplicateRows');
    expect(p.nodes[0]!.ignoredIssues).toEqual(['edgeSpaces:name', 'duplicateRows']);
    p = unignoreIssue(p, 't', 'edgeSpaces:name');
    expect(p.nodes[0]!.ignoredIssues).toEqual(['duplicateRows']);
    p = unignoreIssue(p, 't', 'duplicateRows');
    expect(p.nodes[0]!.ignoredIssues).toBeUndefined();
    expect(unignoreIssue(p, 't', 'nope')).toBe(p);
  });
});

describe('the kept analysis', () => {
  const found = [
    { key: 'duplicateRows', kind: 'duplicateRows', label: 'Duplicate rows', count: 1 },
    { key: 'edgeSpaces:name', kind: 'edgeSpaces', column: 'name', label: 'Spaces at either end of name', count: 2 },
    { key: 'nearDuplicate:city:Manchestr', kind: 'nearDuplicate', column: 'city', value: 'Manchestr', label: 'Manchestr in city, probably Manchester', count: 1 },
  ];

  it('keeps every issue found with the ones Fix all fixed marked, and the time and row count', () => {
    const p = recordAnalysis(project, 't', found, ['edgeSpaces:name'], '2026-10-21T09:00:00.000Z', 5);
    expect(p.nodes[0]!.analysis).toEqual({
      at: '2026-10-21T09:00:00.000Z',
      rows: 5,
      issues: [found[0], { ...found[1], fixed: true }, found[2]],
    });
  });

  it('on a later Fix all, an issue fixed before stays fixed, since its fix still sits after the node', () => {
    let p = recordAnalysis(project, 't', found, ['edgeSpaces:name'], '2026-10-21T09:00:00.000Z', 5);
    p = recordAnalysis(p, 't', found.slice(0, 2), ['duplicateRows'], '2026-10-21T10:00:00.000Z', 5);
    expect(p.nodes[0]!.analysis).toMatchObject({ at: '2026-10-21T10:00:00.000Z', issues: [{ key: 'duplicateRows', fixed: true }, { key: 'edgeSpaces:name', fixed: true }] });
    expect(p.nodes[0]!.analysis!.issues).toHaveLength(2);
  });
});
