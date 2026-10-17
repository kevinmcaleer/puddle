import { describe, expect, it } from 'vitest';
import { dateText, dateType, hasTime, readDateFormat, readDates } from './dateRead';

describe('reading dates', () => {
  it('tidies ordinals, Sept and abbreviations with a full stop before strptime sees them', () => {
    const sql = dateText('v', undefined);
    expect(sql).toContain(`'([0-9])(?:st|nd|rd|th)\\b(?:\\s+of\\b)?', '\\1', 'gi'`);
    expect(sql).toContain(`'\\bsept\\b', 'Sep', 'gi'`);
    // Locale names are turned into English first, so the tidying sees them.
    expect(dateText('v', 'de-DE')).toMatch(/^regexp_replace\(regexp_replace\(regexp_replace\(regexp_replace\(/);
  });

  it('never takes a short year for %Y, and reads a time zone as UTC', () => {
    expect(readDateFormat('v', '%d/%m/%Y')).toBe(`CASE WHEN year(try_strptime(v, '%d/%m/%Y')) >= 1000 THEN try_strptime(v, '%d/%m/%Y') END`);
    expect(readDateFormat('v', '%d/%m/%y')).toBe(`try_strptime(v, '%d/%m/%y')`);
    expect(readDateFormat('v', '%Y-%m-%dT%H:%M:%S%z')).toContain(`make_timestamp(epoch_us(try_strptime(v, '%Y-%m-%dT%H:%M:%S%z')))`);
  });

  it('reads numbers that stand for dates only when they have the right number of digits', () => {
    expect(readDateFormat('v', 'excel serial')).toBe(`CASE WHEN regexp_full_match(v, '^[1-9][0-9]{4}$') THEN DATE '1899-12-30' + CAST(v AS INTEGER) END`);
    expect(readDateFormat('v', 'unix seconds')).toContain(`'^[1-9][0-9]{8,9}$'`);
    expect(hasTime('excel serial')).toBe(false);
    expect(hasTime('unix milliseconds')).toBe(true);
  });

  it('tries each format in turn, as a timestamp if any reads a time', () => {
    expect(dateType(['%Y-%m-%d', 'excel serial'])).toBe('DATE');
    expect(dateType(['%Y-%m-%d', '%d/%m/%Y %H:%M'])).toBe('TIMESTAMP');
    expect(readDates('v', ['%d %b %y'])).toBe(`CAST(try_strptime(v, '%d %b %y') AS DATE)`);
    expect(readDates('v', ['%d %b %y', 'unix seconds'])).toMatch(/^coalesce\(CAST\(try_strptime\(v, '%d %b %y'\) AS TIMESTAMP\), CAST\(CASE WHEN regexp_full_match/);
  });

  it('stops on a value no format reads when asked to, naming it as written', () => {
    const sql = readDates('v', ['%d %b %y'], { fail: { raw: 'r' } });
    expect(sql).toContain(`CASE WHEN coalesce(r, '') = '' THEN NULL ELSE error('Puddle: Can’t read “' || r || '”`);
  });
});
