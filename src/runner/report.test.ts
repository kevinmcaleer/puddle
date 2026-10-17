import { describe, expect, it } from 'vitest';
import { flow } from '../../tests/helpers/projects';
import { qualityMarkdown, ruleStatus } from './report';

describe('the runner’s quality report', () => {
  it('grades each rule from its result and severity', () => {
    expect(ruleStatus('fail', undefined)).toBe('pending');
    expect(ruleStatus('fail', { state: 'ok', failures: 0, total: 9 })).toBe('pass');
    expect(ruleStatus('fail', { state: 'ok', failures: 2, total: 9 })).toBe('fail');
    expect(ruleStatus('warn', { state: 'ok', failures: 2, total: 9 })).toBe('warn');
    expect(ruleStatus('warn', { state: 'error', message: 'x' })).toBe('error');
  });

  it('writes a table per node with rules, and says so when there are none', () => {
    const p = flow({ nodes: [{ id: 'a', type: 'transform' }, { id: 'b', type: 'transform' }], wires: [] });
    p.name = 'Shop';
    expect(qualityMarkdown(p, {}, '2026-10-17T03:00:00.000Z')).toBe('# Quality report: Shop\n\nGenerated 2026-10-17T03:00:00.000Z by puddle-run.\n\nNo rules are set on this project.\n');
    p.nodes[0]!.rules = [
      { id: 'r1', type: 'notEmpty', label: 'email is filled in', params: { column: 'email' }, severity: 'fail', enabled: true },
      { id: 'r2', type: 'unique', label: 'id | unique', params: { column: 'id' }, severity: 'warn', enabled: true },
      { id: 'r3', type: 'unique', label: 'off', params: { column: 'id' }, severity: 'warn', enabled: false },
    ];
    const md = qualityMarkdown(p, { a: { r1: { state: 'ok', failures: 3, total: 10 }, r2: { state: 'error', message: 'no such column' } } }, 'now');
    expect(md).toContain('2 rules: 0 pass, 0 warn, 1 fail, 1 can’t run.');
    expect(md).toContain('## a\n\n| Rule | Severity | Result | Failing rows |');
    expect(md).toContain('| email is filled in | fail | Fail | 3 of 10 |');
    expect(md).toContain('| id \\| unique | warn | Can’t run | no such column |');
    expect(md).not.toContain('| off |');
    expect(md).not.toContain('## b');
  });
});
