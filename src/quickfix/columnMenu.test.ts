import { describe, expect, it } from 'vitest';
import { stepDef } from '../compiler';
import '../steps';
import { holdsReplacement, replacementProblem } from '../steps';
import { columnActions, shown, type ColumnMenuContext } from './columnMenu';

const ctx = (over: Partial<ColumnMenuContext> = {}): ColumnMenuContext => ({
  columns: ['city'],
  available: [
    { name: 'id', type: 'BIGINT' },
    { name: 'city', type: 'VARCHAR' },
    { name: 'joined', type: 'VARCHAR' },
  ],
  locale: 'en-GB',
  detectDates: async () => ({ ranked: [], formats: ['%d/%m/%Y'] }),
  ...over,
});

const action = (c: ColumnMenuContext, label: string) => {
  const a = columnActions(c).find((x) => x.label === label);
  if (!a) throw new Error(`No ${label} in ${columnActions(c).map((x) => x.label).join(', ')}`);
  return a;
};
const build = async (c: ColumnMenuContext, label: string) => {
  const a = action(c, label);
  if (!('step' in a)) throw new Error(`${label} opens a dialog`);
  return a.step(c);
};

describe('the column menu', () => {
  // An entry ending in … adds its step for the inspector's form to finish (a value to find, a new name).
  it('every entry that adds a step adds a valid one for the clicked column, unless it asks for more', async () => {
    for (const a of columnActions(ctx())) {
      if (!('step' in a) || a.label.endsWith('…')) continue;
      const step = await a.step(ctx());
      expect(stepDef(step.type)!.params.safeParse(step.params).success, a.label).toBe(true);
    }
  });

  it('a cell adds this value’s group first: replace it, or keep or remove the rows that have it', async () => {
    const c = ctx({ cell: { column: 'city', value: 'Paris' } });
    expect(columnActions(c).slice(0, 3).map((a) => a.label)).toEqual(['Replace “Paris”…', 'Keep rows where it is “Paris”', 'Remove rows where it is “Paris”']);
    expect(action(c, 'Replace “Paris”…')).toMatchObject({ replace: { find: 'Paris' } });
    const removed = await build(c, 'Remove rows where it is “Paris”');
    expect(removed.params).toMatchObject({ mode: 'remove', conditions: [{ column: 'city', op: 'equals', value: 'Paris' }], matchCase: true });
    expect(removed.label).toBe('Removed rows where city is Paris');
  });

  it('an empty cell matches empty values', async () => {
    const c = ctx({ cell: { column: 'city', value: null } });
    expect(action(c, 'Replace empty values…')).toMatchObject({ replace: { find: null } });
    expect((await build(c, 'Keep rows where empty')).params).toMatchObject({ mode: 'keep', conditions: [{ column: 'city', op: 'empty' }] });
  });

  it('acts on every selected column, and offers one-column entries only for one', async () => {
    const two = ctx({ columns: ['city', 'joined'] });
    expect((await build(two, 'Remove columns')).params).toEqual({ columns: ['city', 'joined'] });
    expect((await build(two, 'Remove other columns')).params).toEqual({ columns: ['id'] });
    expect((await build(two, 'Sort descending')).params).toEqual({ keys: [{ column: 'city', descending: true }, { column: 'joined', descending: true }] });
    expect(columnActions(two).some((a) => a.label === 'Split column…')).toBe(false);
    expect((await build(ctx(), 'Duplicate column')).params).toEqual({ column: 'city', into: 'city_copy' });
  });

  it('keeps only the rows whose value repeats, or removes the repeats', async () => {
    const kept = await build(ctx(), 'Keep duplicates');
    expect(kept).toMatchObject({ type: 'duplicateRows', params: { columns: ['city'], keep: 'duplicates' }, label: 'Kept only duplicate rows by city' });
    expect((await build(ctx(), 'Remove duplicates')).params).toEqual({ columns: ['city'], keep: 'first' });
  });

  it('cuts long values short in its labels', () => {
    expect(shown('a'.repeat(40))).toBe(`“${'a'.repeat(23)}…”`);
  });
});

describe('replace values settings', () => {
  it('knows which columns can hold a replacement as it is', () => {
    expect(holdsReplacement('VARCHAR', 'empty')).toBe(true);
    expect(holdsReplacement('BIGINT', '12')).toBe(true);
    expect(holdsReplacement('BIGINT', 'empty')).toBe(false);
    expect(holdsReplacement('DOUBLE', '-1.5')).toBe(true);
    expect(holdsReplacement('DATE', 'empty')).toBe(false);
  });

  it('warns when a number column would be given a word, unless it turns into text or takes null', () => {
    const columns = ctx().available;
    expect(replacementProblem({ columns: ['id', 'city'], replace: 'empty' }, columns)).toMatch(/^id can’t hold "empty"/);
    expect(replacementProblem({ columns: ['id'], replace: 'empty', toText: true }, columns)).toBeUndefined();
    expect(replacementProblem({ columns: ['id'], replace: 'empty', replaceWithNull: true }, columns)).toBeUndefined();
    expect(replacementProblem({ columns: ['city'], replace: 'empty' }, columns)).toBeUndefined();
  });
});
