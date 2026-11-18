import { describe, expect, it } from 'vitest';
import { findingsHeadline } from './headline';
import type { Issue } from './issues';

const issue = (key: string, severity: Issue['severity'], fix = true): Issue => ({ key, kind: key, severity, count: 1, examples: [], fix: fix ? { type: 'trimWhitespace', params: {} } : undefined }) as unknown as Issue;
const source = { type: 'source', name: 'sales.csv' };
const seven = Array.from({ length: 7 }, (_, i) => issue(`fix${i}`, 'fix'));

describe('the findings headline over a source’s rows', () => {
  it('says how many problems Fix all would fix, and where', () => {
    expect(findingsHeadline(source, seven, false)).toEqual({ count: 7, text: '7 problems found in sales.csv' });
    expect(findingsHeadline(source, [seven[0]!], false)?.text).toBe('1 problem found in sales.csv');
  });

  it('counts suggestions only when Fix all applies them, and never notes (info) or issues without a fix', () => {
    const mixed = [...seven.slice(0, 2), issue('s', 'suggest'), issue('n', 'info', false), issue('nofix', 'fix', false)];
    expect(findingsHeadline(source, mixed, false)?.count).toBe(2);
    expect(findingsHeadline(source, mixed, true)?.count).toBe(3);
  });

  it('goes once the issues are fixed or ignored: nothing open is left to fix', () => {
    expect(findingsHeadline(source, [], false)).toBeNull();
    expect(findingsHeadline(source, [issue('s', 'suggest'), issue('n', 'info', false)], false)).toBeNull();
  });

  it('stays away once dismissed for the node', () => {
    expect(findingsHeadline({ ...source, findingsDismissed: true }, seven, false)).toBeNull();
  });

  it('is for sources only: a Transform’s issues stay on its Issues panel', () => {
    expect(findingsHeadline({ type: 'transform', name: 'Transform 1' }, seven, false)).toBeNull();
  });
});
