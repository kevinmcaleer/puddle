import { abbreviate, formatBytes, formatDateText, formatInstant, formatNumberText, formatValue, fullCount } from './format';

describe('formatBytes', () => {
  it('writes sizes in binary units', () => {
    expect([0, 512, 4300, 5_314_560, 3.1 * 2 ** 30].map(formatBytes)).toEqual(['0 B', '512 B', '4.2 KB', '5.1 MB', '3.1 GB']);
    expect(formatBytes(1024)).toBe('1 KB');
  });
});

describe('display locale formatting', () => {
  const gb = { locale: 'en-GB', dates: 'locale' } as const;
  const de = { locale: 'de-DE', dates: 'locale' } as const;
  const us = { locale: 'en-US', dates: 'locale' } as const;

  it('writes numbers with the locale’s grouping and decimal mark, keeping every digit', () => {
    expect(formatNumberText('1234567.891', 'en-GB')).toBe('1,234,567.891');
    expect(formatNumberText('1234567.891', 'de-DE')).toBe('1.234.567,891');
    expect(formatNumberText('-12', 'de-DE')).toBe('-12');
    expect(formatNumberText('-0.5', 'fr-FR')).toBe('-0,5');
    // Past a double's precision: a HUGEINT or DECIMAL(38) keeps its digits.
    expect(formatNumberText('123456789012345678901234567890', 'en-GB')).toBe('123,456,789,012,345,678,901,234,567,890');
    expect(formatNumberText('1.5e-07', 'de-DE')).toBe('1,5e-07');
    expect(formatNumberText('inf', 'de-DE')).toBe('inf');
  });

  it('writes dates and timestamps in the locale’s short form, or ISO when asked', () => {
    expect(formatDateText('2026-12-31', gb)).toBe('31/12/2026');
    expect(formatDateText('2026-12-31', us)).toBe('12/31/2026');
    expect(formatDateText('2026-12-31', de)).toBe('31.12.2026');
    expect(formatDateText('2026-12-31 14:05:09', gb)).toBe('31/12/2026, 14:05:09');
    expect(formatDateText('2026-12-31 14:05:09.123456', de)).toBe('31.12.2026, 14:05:09,123456');
    expect(formatDateText('2026-03-01 09:00:00+01', gb)).toBe('01/03/2026, 09:00:00 +01');
    expect(formatDateText('2026-12-31 14:05:09', { locale: 'de-DE', dates: 'iso' })).toBe('2026-12-31 14:05:09');
  });

  it('leaves values it can’t place as DuckDB wrote them', () => {
    expect(formatDateText('infinity', gb)).toBe('infinity');
    expect(formatDateText('0044-03-15 (BC)', gb)).toBe('0044-03-15 (BC)');
    expect(formatDateText('0999-01-01', gb)).toBe('0999-01-01');
    expect(formatDateText('1000-01-01', gb)).toBe('01/01/1000');
  });

  it('formats a cell by its column’s kind, leaving text alone', () => {
    expect(formatValue('1234.5', 'decimal', de)).toBe('1.234,5');
    expect(formatValue('2026-12-31', 'date', de)).toBe('31.12.2026');
    expect(formatValue('1234.5', 'text', de)).toBe('1234.5');
  });

  it('counts in the locale', () => {
    expect(fullCount(1204113, gb)).toBe('1,204,113');
    expect(fullCount(1204113, de)).toBe('1.204.113');
    expect([abbreviate(1204, gb), abbreviate(12_345, gb), abbreviate(1_250_000, gb), abbreviate(12_000_000, gb)]).toEqual(['1,204', '12k', '1.3M', '12M']);
    expect([abbreviate(1204, de), abbreviate(1_250_000, de)]).toEqual(['1.204', '1,3M']);
    expect(abbreviate(null, gb)).toBeNull();
  });
});

describe('formatInstant', () => {
  it('writes a moment the display locale’s way, to the second when asked', () => {
    const iso = '2026-10-16T08:30:05.000Z';
    // In this computer's time zone, so only the date and the minutes and seconds are pinned.
    expect(formatInstant(iso, false, { locale: 'en-GB', dates: 'locale' })).toMatch(/^1[67] Oct 2026, \d\d:30$/);
    expect(formatInstant(iso, true, { locale: 'en-GB', dates: 'locale' })).toMatch(/^1[67] Oct 2026, \d\d:30:05$/);
    expect(formatInstant(iso, false, { locale: 'de-DE', dates: 'locale' })).toMatch(/^1[67]\. Okt\. 2026, \d\d:30$/);
  });
});
