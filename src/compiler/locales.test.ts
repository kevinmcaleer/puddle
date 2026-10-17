import { afterEach, describe, expect, it, vi } from 'vitest';
import { schemaErrors } from '../steps/forms';
import { englishDateNames, isParseLocale, PARSE_LOCALE_IDS, PARSE_LOCALES, parseLocale } from './locales';
import { parseNumbers } from './steps/clean';
import { parseDates } from './steps/dates';

afterEach(() => vi.restoreAllMocks());

describe('parse locales', () => {
  it('knows each locale’s decimal mark and day and month order', () => {
    expect(parseLocale('de-DE')).toMatchObject({ decimal: ',', dayFirst: true });
    expect(parseLocale('de-CH')).toMatchObject({ decimal: '.', dayFirst: true });
    expect(parseLocale('en-US')).toMatchObject({ decimal: '.', dayFirst: false });
    expect(parseLocale('xx-XX')).toBeUndefined();
    expect(isParseLocale('toString')).toBe(false);
  });

  it('leaves English text alone, and turns other names into English as whole words', () => {
    expect(englishDateNames('v', 'en-GB')).toBe('v');
    expect(englishDateNames('v', undefined)).toBe('v');
    const de = englishDateNames('v', 'de-DE');
    expect(de).toMatch(/^regexp_replace\(regexp_replace\(/);
    expect(de).toContain(`'(^|[^\\pL])(?:märz|maerz)([^\\pL]|$)', '\\1March\\2', 'gi')`);
    expect(de).toContain(`'(^|[^\\pL])(?:(?:okt)\\.?)([^\\pL]|$)', '\\1Oct\\2'`);
  });

  it('every locale’s names are valid patterns to English month and day names', () => {
    const english = /^(January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jul|Aug|Sep|Oct|Dec|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday|1)$/;
    for (const id of PARSE_LOCALE_IDS)
      for (const [pattern, to] of PARSE_LOCALES[id].names) {
        expect(() => new RegExp(pattern, 'iu')).not.toThrow();
        expect(to).toMatch(english);
      }
  });

  it('compiles the same SQL whatever the machine’s own locale says', () => {
    const before = parseNumbers.compile(parseNumbers.params.parse({ columns: ['n'], locale: 'de-DE' }), { input: 'x' });
    // A machine whose Intl writes every number with a point.
    vi.spyOn(Intl, 'NumberFormat').mockImplementation(() => ({ formatToParts: () => [{ type: 'decimal', value: '.' }] }) as unknown as Intl.NumberFormat);
    expect(parseNumbers.compile(parseNumbers.params.parse({ columns: ['n'], locale: 'de-DE' }), { input: 'x' })).toBe(before);
    expect(before).toContain(`replace(`);
  });
});

describe('locale settings on the parse steps', () => {
  it('a locale is optional, so steps from before it keep working, and an empty choice is no locale', () => {
    expect(parseNumbers.params.parse({ columns: ['n'], decimal: ',' })).toEqual({ columns: ['n'], decimal: ',' });
    expect(parseNumbers.params.parse({ columns: ['n'], locale: '' }).locale).toBeUndefined();
    expect(parseDates.params.parse({ columns: ['d'], formats: ['%d/%m/%Y'] }).locale).toBeUndefined();
  });

  it('refuses a locale it doesn’t know', () => {
    expect(schemaErrors(parseNumbers.params, { columns: ['n'], locale: 'xx-XX' })).toEqual({ locale: 'Pick a locale Puddle knows.' });
    expect(schemaErrors(parseDates.params, { columns: ['d'], formats: ['%d'], locale: 'xx-XX' })).toEqual({ locale: 'Pick a locale Puddle knows.' });
  });

  it('a locale sets the decimal mark, and is named in the label', () => {
    const de = parseNumbers.params.parse({ columns: ['n'], decimal: '.', locale: 'de-DE' });
    expect(parseNumbers.compile(de, { input: 'x' })).toBe(parseNumbers.compile(parseNumbers.params.parse({ columns: ['n'], decimal: ',' }), { input: 'x' }));
    expect(parseNumbers.label(de)).toBe('Parsed numbers in n (German)');
    expect(parseNumbers.label(parseNumbers.params.parse({ columns: ['n'] }))).toBe('Parsed numbers in n');
  });

  it('parse dates reads the locale’s names before strptime', () => {
    const sql = parseDates.compile(parseDates.params.parse({ columns: ['d'], formats: ['%d. %B %Y'], locale: 'de-DE' }), { input: 'x' });
    expect(sql).toMatch(/^SELECT \* EXCLUDE \("__puddle_date_text_0"\) REPLACE \(CAST\(CASE WHEN year\(try_strptime\("__puddle_date_text_0", '%d\. %B %Y'\)\)/);
    expect(sql).toContain(`regexp_replace(trim(CAST("d" AS VARCHAR)), '(^|[^\\pL])(?:januar|jänner)`);
    expect(sql).toContain(`'\\1December\\2'`);
    expect(parseDates.compile(parseDates.params.parse({ columns: ['d'], formats: ['%d/%m/%Y'] }), { input: 'x' })).not.toContain('December');
  });
});
