import { ruleTypes } from '../compiler';
import { newRule, ruleErrors, ruleForm, ruleForms, ruleLabel } from './forms';

const available = [
  { name: 'id', type: 'BIGINT' },
  { name: 'email', type: 'VARCHAR' },
];

describe('rule forms', () => {
  it('gives every rule type a form', () => {
    expect(ruleForms().map((f) => f.type).sort()).toEqual([...ruleTypes()].sort());
  });

  it('starts a new rule on the selected column, or the first one', () => {
    expect(newRule('notEmpty', { selected: ['email'], available }).params).toEqual({ column: 'email' });
    expect(newRule('notEmpty', { selected: [], available }).params).toEqual({ column: 'id' });
    expect(newRule('unique', { selected: ['id', 'email'], available }).params).toEqual({ columns: ['id', 'email'] });
    const r = newRule('noEdgeSpaces', { selected: ['email'], available });
    expect(r).toMatchObject({ type: 'noEdgeSpaces', enabled: true, severity: 'fail', label: 'No leading or trailing spaces in email' });
  });

  it('writes each rule as the expectation it checks', () => {
    expect(ruleLabel({ type: 'unique', params: { columns: ['id'] } })).toBe('id is unique');
    expect(ruleLabel({ type: 'unique', params: { columns: ['id', 'email'] } })).toBe('id, email together are unique');
    expect(ruleLabel({ type: 'matchesPattern', params: { column: 'email', preset: 'email' } })).toBe('email is an email address');
    expect(ruleLabel({ type: 'inSet', params: { column: 'c', values: ['a', 'b', 'c', 'd', 'e'] } })).toBe('c is one of a, b, c and 2 more');
    expect(ruleLabel({ type: 'inRange', params: { column: 'n', min: '1', max: '' } })).toBe('n is at least 1');
    expect(ruleLabel({ type: 'inRange', params: { column: 'n', min: '', max: '9' } })).toBe('n is at most 9');
    // Incomplete settings fall back to the form's title.
    expect(ruleLabel({ type: 'inSet', params: { column: 'c', values: [] } })).toBe('One of a set of values');
  });

  it('says what is missing before the rule runs', () => {
    expect(ruleErrors({ type: 'inSet', params: { column: 'c', values: [] } })).toEqual({ values: 'List the allowed values.' });
    expect(ruleErrors({ type: 'inRange', params: { column: 'c', min: '', max: '' } })).toEqual({ min: 'Give a lowest or highest value.' });
    expect(ruleErrors({ type: 'notEmpty', params: { column: 'c' } })).toEqual({});
  });

  it('shows the pattern field only for your own pattern', () => {
    const field = ruleForm('matchesPattern')!.fields.find((f) => f.key === 'pattern')!;
    expect(field.when?.({ preset: 'email' })).toBe(false);
    expect(field.when?.({ preset: 'custom' })).toBe(true);
  });
});
