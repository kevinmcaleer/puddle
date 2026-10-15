import type { Rule } from '../model';
import { ruleTally, summarise, type RuleResult } from './rules';

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

describe('ruleTally', () => {
  it('counts enabled rules by how they stand, leaving out ones still checking', () => {
    const rules = [rule('a'), rule('b', 'warn'), rule('c'), rule('d'), rule('e', 'fail', false), rule('f')];
    expect(ruleTally(rules, { a: ok(0), b: ok(2), c: ok(1), d: { state: 'error', message: 'x' }, e: ok(9) })).toEqual({ pass: 1, warn: 1, fail: 2 });
    expect(ruleTally([rule('a', 'fail', false)], {})).toBeUndefined();
  });
});
