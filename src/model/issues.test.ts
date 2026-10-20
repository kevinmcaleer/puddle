import { describe, expect, it } from 'vitest';
import { flow } from '../../tests/helpers/projects';
import { ignoreIssue, unignoreIssue } from './issues';

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
