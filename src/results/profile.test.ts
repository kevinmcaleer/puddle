import { describeProfile, parseProfile, parseTypeSniff, qualityOf } from './profile';

describe('column profiles', () => {
  it('reads SUMMARIZE rows', () => {
    expect(parseProfile([{ column_name: 'id', null_pct: 25, approx_unique: 3, min: '1', max: '9' }])).toEqual({ id: { empty: 0.25, distinct: 3, min: '1', max: '9' } });
    expect(qualityOf({ empty: 0.25 })).toEqual({ valid: 0.75, empty: 0.25, error: 0 });
    expect(qualityOf(undefined)).toBeUndefined();
  });

  it('says a text column looks like numbers or dates only when most of it does', () => {
    const row = { n0: 10, num0: 10, date0: 0, n1: 10, num1: 7, date1: 0, n2: 5, num2: 0, date2: 4, n3: 0, num3: 0, date3: 0 };
    expect(parseTypeSniff(row, ['a', 'b', 'c', 'd'])).toEqual({ a: { kind: 'numbers', share: 1 }, c: { kind: 'dates', share: 0.8 } });
  });

  it('describes a column in one line', () => {
    expect(describeProfile({ empty: 0.25, distinct: 1234, min: '1', max: '9' })).toBe('about 1,234 distinct · 1 to 9 · 25% empty');
    expect(describeProfile({ empty: 0, distinct: 1, min: 'x', max: 'x' })).toBe('about 1 distinct · all x · 0% empty');
    expect(describeProfile({ empty: 0.5, min: null, max: null, looksLike: { kind: 'numbers', share: 0.9 } })).toBe('50% empty · looks like numbers (90%)');
    expect(describeProfile({ empty: 0, looksLike: { kind: 'dates', share: 1 } })).toBe('0% empty · looks like dates');
  });
});

describe('profiles in a display locale', () => {
  it('shows the smallest and largest as the column’s values are shown', () => {
    const rows = [{ column_name: 'when', null_pct: 0, approx_unique: 1500, min: '2026-01-31', max: '2026-12-31' }];
    const p = parseProfile(rows, { when: 'date' }).when!;
    expect(p.kind).toBe('date');
    expect(describeProfile(p, { locale: 'de-DE', dates: 'locale' })).toBe('about 1.500 distinct · 31.01.2026 to 31.12.2026 · 0% empty');
    expect(describeProfile(p, { locale: 'en-GB', dates: 'iso' })).toBe('about 1,500 distinct · 2026-01-31 to 2026-12-31 · 0% empty');
  });
});
