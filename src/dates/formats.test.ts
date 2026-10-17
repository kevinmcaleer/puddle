import { describe, expect, it } from 'vitest';
import { CANDIDATE_FORMATS, describeFormat, formatsToTry, orderOf, rankFormats, swapDayMonth, unreadValues } from './formats';

/** A distinct value read by `reads`, appearing `count` times. */
const v = (value: string, reads: string[], count = 1) => ({ value, count, reads });

describe('date format ranking', () => {
  it('swaps day and month, and leaves formats without both alone', () => {
    expect(swapDayMonth('%d/%m/%Y')).toBe('%m/%d/%Y');
    expect(swapDayMonth('%m-%d-%y %H:%M')).toBe('%d-%m-%y %H:%M');
    expect(swapDayMonth('%d %B %Y')).toBeUndefined();
  });

  it('knows which formats could mix up day and month', () => {
    expect(orderOf('%d/%m/%Y')).toBe('day');
    expect(orderOf('%m.%d.%y %H:%M')).toBe('month');
    expect(orderOf('%Y-%m-%d')).toBeUndefined();
    expect(orderOf('%d %b %Y')).toBeUndefined();
  });

  it('ranks by values read, then by the candidate order, and drops formats that read nothing', () => {
    const d = rankFormats([v('a', ['%d %B %Y', '%d.%m.%Y'], 9), v('b', ['%Y-%m-%d', '%d %B %Y'], 9), v('c', ['%d %B %Y'])]);
    expect(d.ranked.map((x) => `${x.format} ${x.matched}/${x.total}`)).toEqual(['%d %B %Y 19/19', '%Y-%m-%d 9/19', '%d.%m.%Y 9/19']);
    expect(d.formats).toEqual(['%d %B %Y']);
  });

  it('chooses the fewest formats that read every value, commonest first', () => {
    const d = rankFormats([v('2024-01-02', ['%Y-%m-%d'], 5), v('3 Feb 2024', ['%d %b %Y'], 2), v('March 4, 2024', ['%B %d, %Y'], 3), v('junk', [])]);
    expect(d.formats).toEqual(['%Y-%m-%d', '%B %d, %Y', '%d %b %Y']);
    expect(d.ambiguous).toBeUndefined();
  });

  it('settles day and month order by a value that fits only one way, and says it was unclear', () => {
    const d = rankFormats([v('02/01/2024', ['%d/%m/%Y', '%m/%d/%Y'], 4), v('24/01/2024', ['%d/%m/%Y']), v('2024-01-02', ['%Y-%m-%d'])]);
    expect(d.formats).toEqual(['%d/%m/%Y', '%Y-%m-%d']);
    expect(d.ambiguous).toMatchObject({ order: 'day', byValues: '24/01/2024', example: '02/01/2024', covers: { day: ['%d/%m/%Y', '%Y-%m-%d'], month: ['%m/%d/%Y', '%Y-%m-%d'] } });
    // With no value both ways round, nothing was unclear.
    expect(rankFormats([v('24/01/2024', ['%d/%m/%Y'])])).toEqual({ ranked: expect.any(Array), values: expect.any(Array), formats: ['%d/%m/%Y'] });
  });

  it('leaves an order no value settles to the user, with the formats for either ready', () => {
    const d = rankFormats([v('02/01/2024', ['%d/%m/%Y', '%m/%d/%Y']), v('3 Feb 2024', ['%d %b %Y'])]);
    expect(d.formats).toBeUndefined();
    expect(d.ambiguous).toEqual({ dayFirst: '%d/%m/%Y', monthFirst: '%m/%d/%Y', example: '02/01/2024', covers: { day: ['%d/%m/%Y', '%d %b %Y'], month: ['%m/%d/%Y', '%d %b %Y'] } });
  });

  it('asks when values fit only day first and others only month first', () => {
    const d = rankFormats([v('24/01/2024', ['%d/%m/%Y']), v('01/24/2024', ['%m/%d/%Y'])]);
    expect(d.formats).toBeUndefined();
    expect(d.ambiguous).toMatchObject({ mixed: { day: '24/01/2024', month: '01/24/2024' } });
    expect(rankFormats([v('24/01/2024', ['%d/%m/%Y']), v('01/24/2024', ['%m/%d/%Y'])], [], 'en-US')).toMatchObject({ formats: ['%m/%d/%Y'], ambiguous: { byLocale: 'en-US', order: 'month' } });
  });

  it('puts the project formats first on ties, and lets them settle an unclear order', () => {
    const values = [v('02/01/2024', ['%Y-%m-%d', '%d/%m/%Y', '%m/%d/%Y'])];
    const d = rankFormats(values, ['%m/%d/%Y']);
    expect(d.ranked[0]!.format).toBe('%m/%d/%Y');
    expect(d.formats).toEqual(['%m/%d/%Y']);
    expect(d.ambiguous).toBeUndefined();
  });

  it('nothing matched means nothing is chosen', () => {
    expect(rankFormats([v('junk', [])])).toEqual({ ranked: [], values: [v('junk', [])] });
  });

  it('counts the values a list of formats misses, unless one wasn’t tried', () => {
    const d = { ...rankFormats([v('2024-01-02', ['%Y-%m-%d'], 3), v('junk', [], 2), v('?', [])]), tried: ['%Y-%m-%d', '%d/%m/%Y'] };
    expect(unreadValues(d, ['%Y-%m-%d'])).toEqual({ examples: ['junk', '?'], count: 3, total: 6 });
    expect(unreadValues(d, ['%d/%m/%Y'])).toMatchObject({ count: 6 });
    expect(unreadValues(d, ['%Y-%m-%d', '%e'])).toBeUndefined();
  });

  it('describes formats the way people write them', () => {
    expect(describeFormat('%d/%m/%Y')).toBe('DD/MM/YYYY');
    expect(describeFormat('%b %d, %Y %H:%M')).toBe('Mon DD, YYYY hh:mm');
    expect(describeFormat('%a, %d %b %Y %I:%M %p')).toBe('Wkd, DD Mon YYYY hh:mm AM');
    expect(describeFormat('excel serial')).toBe('Excel serial number');
  });

  it('tries both day and month orders for every separator, and numbers that stand for dates', () => {
    for (const sep of ['/', '-', '.']) for (const f of [`%d${sep}%m${sep}%Y`, `%d${sep}%m${sep}%y`]) expect(CANDIDATE_FORMATS).toEqual(expect.arrayContaining([f, swapDayMonth(f)]));
    expect(CANDIDATE_FORMATS).toEqual(expect.arrayContaining(['excel serial', 'unix seconds', 'unix milliseconds']));
    expect(new Set(CANDIDATE_FORMATS).size).toBe(CANDIDATE_FORMATS.length);
  });
});

describe('date format ranking with a locale', () => {
  it('settles an unclear day and month order by the locale, still saying it was unclear', () => {
    const values = [v('02/01/2024', ['%d/%m/%Y', '%m/%d/%Y'])];
    expect(rankFormats(values, [], 'en-GB')).toMatchObject({ formats: ['%d/%m/%Y'], ambiguous: { dayFirst: '%d/%m/%Y', monthFirst: '%m/%d/%Y', byLocale: 'en-GB', order: 'day' } });
    expect(rankFormats(values, [], 'en-US').formats).toEqual(['%m/%d/%Y']);
    // An unknown locale settles nothing, and a project format still wins.
    expect(rankFormats(values, [], 'xx-XX').formats).toBeUndefined();
    expect(rankFormats(values, ['%m/%d/%Y'], 'en-GB')).toEqual({ ranked: expect.any(Array), values, formats: ['%m/%d/%Y'] });
  });

  it('tries the locale’s own formats after the usual ones', () => {
    expect(formatsToTry([], 'de-DE')).toEqual(expect.arrayContaining(['%d. %B %Y', '%Y-%m-%d']));
    expect(formatsToTry([]).includes('%d. %B %Y')).toBe(false);
  });
});
