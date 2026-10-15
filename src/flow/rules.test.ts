import type { Rule } from '../model';
import { summarise, type RuleResult } from './rules';

const rule = (id: string, severity: 'fail' | 'warn' = 'fail', enabled = true): Rule => ({ id, type: 'notEmpty', label: id, enabled, severity, params: { column: 'a' } });
const ok = (failures: number): RuleResult => ({ state: 'ok', failures, total: 10 });

describe('summarise', () => {
  it('has nothing to say without enabled rules', () => {
    expect(summarise([], {})).toBeUndefined();
    expect(summarise([rule('a', 'fail', false)], { a: ok(3) })).toBeUndefined();
  });

  it('reports the worst result, in words', () => {
    expect(summarise([rule('a'), rule('b')], { a: ok(0), b: ok(0) })).toEqual({ status: 'pass', label: '2 rules pass' });
    expect(summarise([rule('a')], { a: ok(0) })).toEqual({ status: 'pass', label: 'Rule passes' });
    expect(summarise([rule('a', 'warn'), rule('b')], { a: ok(2), b: ok(0) })).toEqual({ status: 'warn', label: '1 warning' });
    expect(summarise([rule('a', 'warn'), rule('b')], { a: ok(2), b: ok(1) })).toEqual({ status: 'fail', label: '1 rule failing' });
    expect(summarise([rule('a'), rule('b')], { a: ok(1), b: { state: 'error', message: 'x' } })).toEqual({ status: 'fail', label: '1 rule can’t run' });
  });

  it('waits while any rule is still being checked', () => {
    expect(summarise([rule('a'), rule('b')], { a: ok(0) })).toEqual({ status: 'pending', label: 'Checking rules' });
    expect(summarise([rule('a')], undefined)).toEqual({ status: 'pending', label: 'Checking rules' });
  });
});
