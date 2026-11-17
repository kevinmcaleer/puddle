import { describe, expect, it } from 'vitest';
import { flow, step } from '../../tests/helpers/projects';
import { fixedIssueKeys, ignoreIssue, recordAnalysis, unignoreIssue } from './issues';
import { removeStep, toggleStep } from './steps';

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

  // Regression (#272): a source went on warning of issues that the steps after it had fixed.
  describe('issues fixed by steps', () => {
    const fixing = flow({
      nodes: [
        { id: 't', type: 'transform' },
        { id: 'fix', type: 'transform', steps: [step('trim', 'trimWhitespace', { columns: ['name'] }), step('dedupe', 'duplicateRows', { columns: [], keep: 'first' })] },
      ],
      wires: [['t', 'fix']],
    });
    const fixed = recordAnalysis(fixing, 't', found, ['edgeSpaces:name', 'duplicateRows'], '2026-10-21T09:00:00.000Z', 5, { 'edgeSpaces:name': ['trim'], duplicateRows: ['dedupe'] });

    it('are kept with the steps that fix them, and count as fixed while those steps are there and on', () => {
      expect(fixed.nodes[0]!.analysis!.issues.map((i) => i.fixedBy)).toEqual([['dedupe'], ['trim'], undefined]);
      expect([...fixedIssueKeys(fixed, 't')].sort()).toEqual(['duplicateRows', 'edgeSpaces:name']);
      expect(fixedIssueKeys(fixed, 'fix').size).toBe(0);
    });

    it('are open again when a fix’s step is deleted or turned off', () => {
      expect([...fixedIssueKeys(removeStep(fixed, 'fix', 'trim'), 't')]).toEqual(['duplicateRows']);
      expect([...fixedIssueKeys(toggleStep(fixed, 'fix', 'dedupe'), 't')]).toEqual(['edgeSpaces:name']);
      expect([...fixedIssueKeys(toggleStep(toggleStep(fixed, 'fix', 'dedupe'), 'fix', 'dedupe'), 't')].sort()).toEqual(['duplicateRows', 'edgeSpaces:name']);
    });

    it('keep their steps through a later Fix all or an ignore', () => {
      const later = recordAnalysis(fixed, 't', found, [], '2026-10-21T10:00:00.000Z', 5);
      expect(later.nodes[0]!.analysis!.issues.map((i) => i.fixedBy)).toEqual([['dedupe'], ['trim'], undefined]);
    });

    it('are not counted when only marked fixed, with no steps named (a read option, or a project saved before)', () => {
      const marked = recordAnalysis(fixing, 't', found, ['edgeSpaces:name'], '2026-10-21T09:00:00.000Z', 5);
      expect(fixedIssueKeys(marked, 't').size).toBe(0);
    });
  });
});
