import { step } from '../../tests/helpers/projects';
import type { ColumnSchema } from '../model';
import { expectedColumns, mapSteps, matchColumns, missingColumns, stepColumns, suggestedMapping, unmappedReason } from './mapping';

const cols = (...names: string[]): ColumnSchema[] => names.map((name) => ({ name, type: 'VARCHAR' }));

describe('columns a step reads', () => {
  it('reads every kind of column setting', () => {
    expect(stepColumns(step('a', 'trimWhitespace', { columns: ['name', 'email'] }))).toEqual(['name', 'email']);
    expect(stepColumns(step('b', 'splitByDelimiter', { column: 'name', delimiter: ' ', into: ['first', 'last'] }))).toEqual(['name']);
    expect(stepColumns(step('c', 'renameColumns', { renames: [{ from: 'email', to: 'mail' }] }))).toEqual(['email']);
    expect(stepColumns(step('d', 'filterRows', { conditions: [{ column: 'city', op: 'equals', value: 'Leeds' }], match: 'all' }))).toEqual(['city']);
    expect(stepColumns(step('e', 'sortRows', { keys: [{ column: 'joined', descending: true }] }))).toEqual(['joined']);
    const pivot = { rows: ['region'], column: 'month', pivotValues: ['Jan'], values: [{ column: 'sales', agg: 'sum' }], filters: [{ column: 'rep', op: 'notEmpty', value: '' }], names: {} };
    expect(stepColumns(step('f', 'pivot', pivot))).toEqual(['region', 'month', 'sales', 'rep']);
  });

  it('reads only the candidates an expression or query names', () => {
    const add = step('a', 'addColumn', { name: 'total', expression: 'price * quantity + round(tax)' });
    expect(stepColumns(add, ['price', 'quantity', 'tax', 'round', 'id'])).toEqual(['price', 'quantity', 'tax']);
    expect(stepColumns(step('b', 'customSql', { query: 'SELECT name FROM input' }), ['name', 'input'])).toEqual(['name']);
  });

  it('skips settings the form hides for the current choice', () => {
    const shift = step('a', 'shiftDates', { columns: ['start'], by: 'fixed', amount: 1, unit: 'day', amountColumn: 'months' });
    expect(stepColumns(shift)).toEqual(['start']);
    expect(stepColumns({ ...shift, params: { ...shift.params, by: 'column' } })).toEqual(['start', 'months']);
  });

  it('expects the input columns the steps read, in the input’s order, not ones made by earlier steps', () => {
    const steps = [step('a', 'splitByDelimiter', { column: 'name', delimiter: ' ', into: ['first', 'last'] }), step('b', 'trimWhitespace', { columns: ['first', 'Email'] })];
    expect(expectedColumns(steps, [...cols('id', 'email'), { name: 'name', type: 'VARCHAR' }])).toEqual(cols('email', 'name'));
  });
});

describe('matching columns', () => {
  it('finds columns by name ignoring case, and suggests stand-ins that read the same', () => {
    expect(matchColumns(cols('id', 'Name', 'customer_name', 'phone'), cols('ID', 'name', 'Customer Name', 'mobile'))).toEqual([
      { expected: cols('id')[0], found: 'ID' },
      { expected: cols('Name')[0], found: 'name' },
      { expected: cols('customer_name')[0], suggestion: 'Customer Name' },
      { expected: cols('phone')[0], suggestion: undefined },
    ]);
    expect(missingColumns(cols('id', 'phone'), cols('id')).map((m) => m.expected.name)).toEqual(['phone']);
    expect(suggestedMapping(cols('customer_name', 'phone'), cols('Customer Name'))).toEqual({ customer_name: 'Customer Name' });
  });

  it('never suggests a column the template expects under its own name', () => {
    expect(matchColumns(cols('e_mail', 'email'), cols('email'))[0]!.suggestion).toBeUndefined();
  });
});

describe('mapping steps onto an input', () => {
  const steps = [
    step('a', 'trimWhitespace', { columns: ['name', 'email'] }),
    step('b', 'addColumn', { name: 'greeting', expression: "'Dear ' || name" }),
    step('c', 'changeCase', { columns: ['city'], mode: 'upper' }),
    step('d', 'removeColumns', { columns: ['id'] }),
  ];
  const expected = cols('id', 'name', 'email', 'city');

  it('leaves steps as they are when the input has every column, with new ids', () => {
    const mapped = mapSteps(steps, expected, expected, {});
    expect(mapped.map((s) => s.params)).toEqual(steps.map((s) => s.params));
    expect(mapped.every((s) => s.enabled)).toBe(true);
    expect(mapped.map((s) => s.id).some((id) => steps.some((s) => s.id === id))).toBe(false);
  });

  it('renames mapped columns everywhere, expressions included, and relabels the steps', () => {
    const mapped = mapSteps(steps, expected, cols('ID', 'full_name', 'email', 'town'), { name: 'full_name', city: 'town' });
    expect(mapped.map((s) => s.params)).toEqual([
      { columns: ['full_name', 'email'] },
      { name: 'greeting', expression: "'Dear ' || full_name" },
      { columns: ['town'], mode: 'upper' },
      { columns: ['ID'] },
    ]);
    expect(mapped.map((s) => s.label)).toEqual(['Trimmed full_name, email', 'Added greeting', 'Changed town to upper case', 'Removed ID']);
    expect(mapped.every((s) => s.enabled && !s.disabledReason)).toBe(true);
  });

  it('turns off steps whose columns stay unmapped, saying which', () => {
    const mapped = mapSteps(steps, expected, cols('id', 'full_name', 'email'), { name: 'full_name' });
    expect(mapped.map((s) => s.enabled)).toEqual([true, true, false, true]);
    expect(mapped[2]!.disabledReason).toBe(unmappedReason(['city']));
    expect(unmappedReason(['city'])).toBe('Needs city, which the input doesn’t have. Pick a column in the step settings, then turn it on.');
    expect(unmappedReason(['a', 'b', 'c'])).toMatch(/^Needs a, b and c, .* Pick columns/);
  });

  it('ignores a mapping to a column the input doesn’t have', () => {
    expect(mapSteps(steps, expected, cols('id', 'email', 'city'), { name: 'nope' })[0]!.enabled).toBe(false);
  });

  it('keeps a step saved turned off as it was, and labels renamed by hand', () => {
    const own = { ...step('e', 'trimWhitespace', { columns: ['name'] }, false), label: 'Tidy', customLabel: true };
    const [mapped] = mapSteps([own], cols('name'), cols('full_name'), { name: 'full_name' });
    expect(mapped).toMatchObject({ enabled: false, label: 'Tidy', params: { columns: ['full_name'] } });
    expect(mapped!.disabledReason).toBeUndefined();
  });
});
