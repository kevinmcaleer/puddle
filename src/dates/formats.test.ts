import { describe, expect, it } from 'vitest';
import { describeFormat, rankFormats, swapDayMonth } from './formats';

const m = (format: string, matched: number, total = 10) => ({ format, matched, total });

describe('date format ranking', () => {
  it('swaps day and month, and leaves formats without both alone', () => {
    expect(swapDayMonth('%d/%m/%Y')).toBe('%m/%d/%Y');
    expect(swapDayMonth('%m-%d-%y %H:%M')).toBe('%d-%m-%y %H:%M');
    expect(swapDayMonth('%d %B %Y')).toBeUndefined();
  });

  it('ranks by share read, then by the candidate order, dropping formats that read nothing', () => {
    const d = rankFormats([m('%d.%m.%Y', 9), m('%Y-%m-%d', 9), m('%d/%m/%Y', 0), m('%d %B %Y', 10)]);
    expect(d.ranked.map((x) => x.format)).toEqual(['%d %B %Y', '%Y-%m-%d', '%d.%m.%Y']);
    expect(d.best).toBe('%d %B %Y');
  });

  it('flags equal day-first and month-first matches instead of choosing', () => {
    const d = rankFormats([m('%d/%m/%Y', 10), m('%m/%d/%Y', 10)]);
    expect(d.best).toBeUndefined();
    expect(d.ambiguous).toEqual({ dayFirst: '%d/%m/%Y', monthFirst: '%m/%d/%Y', example: undefined });
    // One value with a day over 12 settles it.
    expect(rankFormats([m('%d/%m/%Y', 10), m('%m/%d/%Y', 9)]).best).toBe('%d/%m/%Y');
  });

  it('puts the project formats first on ties, and lets them settle the order', () => {
    const d = rankFormats([m('%Y-%m-%d', 10), m('%d/%m/%Y', 10), m('%m/%d/%Y', 10)], ['%m/%d/%Y']);
    expect(d.ranked[0]!.format).toBe('%m/%d/%Y');
    expect(d.best).toBe('%m/%d/%Y');
  });

  it('nothing matched means nothing is chosen', () => {
    expect(rankFormats([m('%Y-%m-%d', 0)])).toEqual({ ranked: [] });
  });

  it('describes formats the way people write them', () => {
    expect(describeFormat('%d/%m/%Y')).toBe('DD/MM/YYYY');
    expect(describeFormat('%b %d, %Y %H:%M')).toBe('Mon DD, YYYY hh:mm');
  });
});
