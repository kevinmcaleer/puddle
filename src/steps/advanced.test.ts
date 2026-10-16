import { describe, expect, it } from 'vitest';
import { fieldErrors, newStep, stepForm } from '.';

describe('custom SQL form', () => {
  it('starts with a query that runs, in the Advanced group', () => {
    const step = newStep('customSql', { selected: [], available: [{ name: 'id', type: 'BIGINT' }] });
    expect(step.params).toEqual({ query: 'SELECT *\nFROM input' });
    expect(step.label).toBe('Ran custom SQL');
    expect(fieldErrors(step)).toEqual({});
    expect(stepForm('customSql')!.group).toBe('Advanced');
  });

  it('says why a query is refused, as a sentence, before anything runs', () => {
    expect(fieldErrors({ type: 'customSql', params: { query: "SELECT * FROM 'other.csv'" } })).toEqual({
      query: "FROM 'other.csv' isn’t allowed: a step can only read its input, not files.",
    });
    expect(fieldErrors({ type: 'customSql', params: { query: 'ATTACH \'x.db\'' } }).query).toMatch(/^ATTACH isn’t allowed/);
  });
});
