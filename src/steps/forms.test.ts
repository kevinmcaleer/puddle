import { describe, expect, it } from 'vitest';
import { stepDef } from '../compiler';
import { fieldErrors, labelFor, newStep, stepForm, stepForms } from '.';

const available = [
  { name: 'id', type: 'BIGINT' },
  { name: 'name', type: 'VARCHAR' },
  { name: 'email', type: 'VARCHAR' },
];

describe('step forms', () => {
  it('every form has a compiler step and every field names a param the step reads', () => {
    expect(stepForms().length).toBeGreaterThan(0);
    for (const form of stepForms()) {
      expect(stepDef(form.type), form.type).toBeDefined();
      const defaults = form.defaults({ selected: ['name'], available });
      for (const f of form.fields) expect(Object.keys(defaults), `${form.type}.${f.key}`).toContain(f.key);
    }
  });

  it('a new step starts from the selected columns, else the first text column', () => {
    expect(newStep('trimWhitespace', { selected: ['email'], available }).params).toEqual({ columns: ['email'] });
    expect(newStep('trimWhitespace', { selected: [], available }).params).toEqual({ columns: ['name'] });
    const step = newStep('changeCase', { selected: ['name', 'email'], available });
    expect(step).toMatchObject({ type: 'changeCase', enabled: true, label: 'Changed name, email to title case' });
  });

  it('a step that is incomplete is labelled by its title and says which field is missing', () => {
    const step = newStep('removeColumns', { selected: [], available });
    expect(step.label).toBe(stepForm('removeColumns')!.title);
    expect(fieldErrors(step)).toEqual({ columns: 'Pick at least one column.' });
    expect(fieldErrors({ type: 'removeColumns', params: { columns: ['id'] } })).toEqual({});
  });

  it('a renamed step keeps its name when its settings change; an unrenamed one follows them', () => {
    const base = { type: 'trimWhitespace', params: { columns: ['name'] }, label: 'Tidy names' };
    expect(labelFor({ ...base, customLabel: true })).toBe('Tidy names');
    expect(labelFor({ ...base, customLabel: false })).toBe('Trimmed name');
    expect(labelFor({ ...base, params: { columns: ['name', 'email'] } })).toBe('Trimmed name, email');
  });

  it('refuses an unknown step type', () => {
    expect(() => newStep('nope', { selected: [], available })).toThrow(/Unknown step type/);
  });
});
