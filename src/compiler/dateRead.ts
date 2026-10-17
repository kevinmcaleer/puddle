// Reading text as dates: the SQL behind parse dates and date format detection. Formats are strptime formats, plus
// a few named ones for numbers that stand for dates (Excel serial numbers, Unix times). The text is tidied first so
// ordinals (3rd of March), Sept and abbreviations with a full stop (Jan.) read, and %Y never takes a one to three digit
// year (strptime reads 03/04/24 as the year 24 with %d/%m/%Y; %d/%m/%y is the format for it).
import { englishDateNames } from './locales';
import { str } from './sql';

/** Formats for numbers that stand for dates, by name: the pattern of digits each reads, and how. */
export const NUMBER_DATE_FORMATS = {
  // Day 1 is 1 January 1900, and Excel counts a 29 February 1900 that never was, so from March 1900 on day 0 is
  // 30 December 1899. Five digits only: 10000 to 99999 are 1927 to 2173, so ids and years aren't taken for dates.
  'excel serial': { label: 'Excel serial number', time: false, pattern: '^[1-9][0-9]{4}$', sql: (v: string) => `DATE '1899-12-30' + CAST(${v} AS INTEGER)` },
  // Nine or ten digits are 1973 to 2286 in seconds; twelve or thirteen the same years in milliseconds.
  'unix seconds': { label: 'Unix time in seconds', time: true, pattern: '^[1-9][0-9]{8,9}$', sql: (v: string) => `make_timestamp(CAST(${v} AS BIGINT) * 1000000)` },
  'unix milliseconds': { label: 'Unix time in milliseconds', time: true, pattern: '^[1-9][0-9]{11,12}$', sql: (v: string) => `make_timestamp(CAST(${v} AS BIGINT) * 1000)` },
} as const;
type NumberDateFormat = keyof typeof NUMBER_DATE_FORMATS;

export const isNumberDateFormat = (format: string): format is NumberDateFormat => Object.hasOwn(NUMBER_DATE_FORMATS, format);

/** Whether a format reads a time of day as well as a date. */
export const hasTime = (format: string) => (isNumberDateFormat(format) ? NUMBER_DATE_FORMATS[format].time : /%[HIMSfpTXcgnz]/.test(format));

/** The type parse dates makes with these formats: a timestamp if any reads a time. */
export const dateType = (formats: string[]) => (formats.some(hasTime) ? 'TIMESTAMP' : 'DATE');

/**
 * SQL tidying the text in `expr` for strptime: the locale's month and day names in English, ordinals without their
 * suffix (3rd of May becomes 3 May), Sept as Sep, and no full stop after an abbreviated month.
 */
export function dateText(expr: string, locale: string | undefined): string {
  const named = englishDateNames(expr, locale);
  const ordinals = `regexp_replace(${named}, ${str('([0-9])(?:st|nd|rd|th)\\b(?:\\s+of\\b)?')}, ${str('\\1')}, 'gi')`;
  const sept = `regexp_replace(${ordinals}, ${str('\\bsept\\b')}, 'Sep', 'gi')`;
  return `regexp_replace(${sept}, ${str('\\b(jan|feb|mar|apr|jun|jul|aug|sep|oct|nov|dec)\\.')}, ${str('\\1')}, 'gi')`;
}

/**
 * SQL reading the tidied text `v` with one format, or NULL where it doesn't fit. A format with a time zone (%z) is
 * read as the time in UTC. Untyped: strptime gives TIMESTAMP, Excel serial numbers DATE.
 */
export function readDateFormat(v: string, format: string): string {
  if (isNumberDateFormat(format)) {
    const f = NUMBER_DATE_FORMATS[format];
    return `CASE WHEN regexp_full_match(${v}, ${str(f.pattern)}) THEN ${f.sql(v)} END`;
  }
  const read = `try_strptime(${v}, ${str(format)})`;
  // epoch_us of a TIMESTAMPTZ is the UTC instant, without needing the ICU extension or the browser's time zone.
  const plain = /%[zZ]/.test(format) ? `make_timestamp(epoch_us(${read}))` : read;
  return format.includes('%Y') ? `CASE WHEN year(${plain}) >= 1000 THEN ${plain} END` : plain;
}

/**
 * SQL reading the tidied text `v` with the first of `formats` that fits, as DATE or TIMESTAMP. Values none fits are
 * NULL, or with `fail`, stop the query naming the value as written (`raw`).
 */
export function readDates(v: string, formats: string[], opts: { fail?: { raw: string } } = {}): string {
  const as = dateType(formats);
  const reads = formats.map((f) => `CAST(${readDateFormat(v, f)} AS ${as})`);
  if (opts.fail) {
    const { raw } = opts.fail;
    reads.push(`CASE WHEN coalesce(${raw}, '') = '' THEN NULL ELSE error(${str('Puddle: Can’t read “')} || ${raw} || ${str('” as a date with the formats given. Add a format that reads it, or let values no format reads become empty.')}) END`);
  }
  return reads.length === 1 ? reads[0]! : `coalesce(${reads.join(', ')})`;
}
