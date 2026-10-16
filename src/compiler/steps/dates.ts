// The Dates step group. Parse dates turns text into DATE or TIMESTAMP; the rest work on those types:
// extract a part, add or subtract an interval, difference, truncate, format to text.
import { z } from 'zod';
import { ident, list, num, str, strList } from '../sql';
import { defineStep } from './registry';

const Column = z.string().min(1, 'pick a column');
const Columns = z.array(z.string().min(1)).min(1, 'pick at least one column');
const Name = z.string().trim().min(1, 'give the new column a name');
const names = (cols: string[]) => cols.join(', ');

/** SELECT * REPLACE (expr(col) AS col, ...) for each column. */
const replaceEach = (input: string, columns: string[], expr: (col: string) => string) =>
  `SELECT * REPLACE (${list(columns.map((c) => `${expr(c)} AS ${ident(c)}`))}) FROM ${input}`;

/** Whether a strptime format reads a time of day as well as a date. */
export const hasTime = (format: string) => /%[HIMSfpTXcgnz]/.test(format);

export const parseDates = defineStep({
  type: 'parseDates',
  params: z.object({
    columns: Columns,
    formats: z.array(z.string().trim().min(1)).min(1, 'choose a date format'),
    /** Values no format reads become empty, or stop the flow with an error. */
    onError: z.enum(['empty', 'fail']).default('empty'),
  }),
  label: (p) => `Parsed ${p.columns.join(', ')} as ${p.formats.some(hasTime) ? 'date and time' : 'dates'}`,
  compile: (p, { input }) => {
    const formats = p.formats.length === 1 ? str(p.formats[0]!) : strList(p.formats);
    const fn = p.onError === 'fail' ? 'strptime' : 'try_strptime';
    const as = p.formats.some(hasTime) ? 'TIMESTAMP' : 'DATE';
    return `SELECT * REPLACE (${list(p.columns.map((c) => `CAST(${fn}(trim(CAST(${ident(c)} AS VARCHAR)), ${formats}) AS ${as}) AS ${ident(c)}`))}) FROM ${input}`;
  },
});

/** Parts a date can be split into, with the DuckDB function that reads each. Weekdays count from Monday as 1 (ISO). */
export const DATE_PARTS = {
  year: { label: 'Year', fn: 'year' },
  quarter: { label: 'Quarter', fn: 'quarter' },
  month: { label: 'Month', fn: 'month' },
  monthName: { label: 'Month name', fn: 'monthname' },
  week: { label: 'Week of the year', fn: 'week' },
  day: { label: 'Day of the month', fn: 'day' },
  weekday: { label: 'Day of the week', fn: 'isodow' },
  weekdayName: { label: 'Day name', fn: 'dayname' },
  hour: { label: 'Hour', fn: 'hour' },
} as const;
export type DatePart = keyof typeof DATE_PARTS;
const PART_KEYS = Object.keys(DATE_PARTS) as [DatePart, ...DatePart[]];

/** The new column a part goes into when it doesn't replace the date: joined_year, joined_weekday_name. */
export const partColumn = (column: string, part: DatePart) => `${column}_${part.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`)}`;

export const extractDatePart = defineStep({
  type: 'extractDatePart',
  params: z.object({
    columns: Columns,
    part: z.enum(PART_KEYS),
    /** Replace each date with its part, or add the part as a new column. */
    replace: z.boolean().default(false),
  }),
  label: (p) => `Extracted ${DATE_PARTS[p.part].label.toLowerCase()} from ${names(p.columns)}`,
  compile: (p, { input }) => {
    const expr = (c: string) => `${DATE_PARTS[p.part].fn}(${ident(c)})`;
    if (p.replace) return replaceEach(input, p.columns, expr);
    return `SELECT *, ${list(p.columns.map((c) => `${expr(c)} AS ${ident(partColumn(c, p.part))}`))} FROM ${input}`;
  },
});

/** Interval units, each with the DuckDB to_* function that builds it and how many of that function's unit one takes. */
export const INTERVAL_UNITS = {
  years: { label: 'Years', one: 'year', fn: 'to_months', times: 12, diff: 'year' },
  quarters: { label: 'Quarters', one: 'quarter', fn: 'to_months', times: 3, diff: 'quarter' },
  months: { label: 'Months', one: 'month', fn: 'to_months', times: 1, diff: 'month' },
  weeks: { label: 'Weeks', one: 'week', fn: 'to_days', times: 7, diff: 'week' },
  days: { label: 'Days', one: 'day', fn: 'to_days', times: 1, diff: 'day' },
  hours: { label: 'Hours', one: 'hour', fn: 'to_hours', times: 1, diff: 'hour' },
  minutes: { label: 'Minutes', one: 'minute', fn: 'to_minutes', times: 1, diff: 'minute' },
  seconds: { label: 'Seconds', one: 'second', fn: 'to_seconds', times: 1, diff: 'second' },
} as const;
export type IntervalUnit = keyof typeof INTERVAL_UNITS;
const UNIT_KEYS = Object.keys(INTERVAL_UNITS) as [IntervalUnit, ...IntervalUnit[]];

/** An interval of `amount` (SQL) units. Every unit but seconds takes whole numbers, so a column's amounts are rounded. */
function interval(unit: IntervalUnit, amount: number | string): string {
  const u = INTERVAL_UNITS[unit];
  // A fixed amount is a whole number already; a column's is cast.
  const n = typeof amount === 'number' ? num(amount * u.times) : `${unit === 'seconds' ? `CAST(${amount} AS DOUBLE)` : `CAST(round(${amount}) AS INTEGER)`}${u.times === 1 ? '' : ` * ${num(u.times)}`}`;
  return `${u.fn}(${n})`;
}

export const shiftDates = defineStep({
  type: 'shiftDates',
  params: z
    .object({
      columns: Columns,
      direction: z.enum(['add', 'subtract']).default('add'),
      /** A fixed amount, or each row's amount from a number column. */
      by: z.enum(['fixed', 'column']).default('fixed'),
      amount: z.number().int('use a whole number').nonnegative('use a positive amount; choose subtract to go back').optional(),
      amountColumn: z.string().optional(),
      unit: z.enum(UNIT_KEYS),
      /** A date plus an interval is a timestamp in DuckDB; without this the result is a date again. */
      keepTime: z.boolean().default(false),
    })
    .superRefine((p, ctx) => {
      if (p.by === 'fixed' && p.amount == null) ctx.addIssue({ code: 'custom', path: ['amount'], message: 'give the amount' });
      if (p.by === 'column' && !p.amountColumn) ctx.addIssue({ code: 'custom', path: ['amountColumn'], message: 'pick the column with the amounts' });
    }),
  label: (p) => {
    const u = INTERVAL_UNITS[p.unit];
    const how = p.by === 'fixed' ? `${p.amount} ${p.amount === 1 ? u.one : u.label.toLowerCase()}` : `the ${u.label.toLowerCase()} in ${p.amountColumn}`;
    return p.direction === 'add' ? `Added ${how} to ${names(p.columns)}` : `Subtracted ${how} from ${names(p.columns)}`;
  },
  compile: (p, { input }) => {
    const iv = interval(p.unit, p.by === 'fixed' ? (p.amount ?? 0) : ident(p.amountColumn ?? ''));
    const op = p.direction === 'add' ? '+' : '-';
    return replaceEach(input, p.columns, (c) => (p.keepTime ? `(${ident(c)} ${op} ${iv})` : `CAST(${ident(c)} ${op} ${iv} AS DATE)`));
  },
});

export const dateDifference = defineStep({
  type: 'dateDifference',
  params: z.object({ start: Column, end: Column, unit: z.enum(UNIT_KEYS), into: Name }),
  label: (p) => `Added ${INTERVAL_UNITS[p.unit].label.toLowerCase()} from ${p.start} to ${p.end} as ${p.into}`,
  // date_sub counts whole units: 15 January to 14 February is 0 months, and a later start gives a negative number.
  compile: (p, { input }) => `SELECT *, date_sub(${str(INTERVAL_UNITS[p.unit].diff)}, ${ident(p.start)}, ${ident(p.end)}) AS ${ident(p.into)} FROM ${input}`,
});

/** Truncation through time_bucket, which keeps a DATE a DATE (date_trunc makes it a TIMESTAMP). Weeks start on Monday. */
export const TRUNCATE_TO = {
  year: { label: 'Year', width: "INTERVAL '1 year'" },
  quarter: { label: 'Quarter', width: "INTERVAL '3 months'" },
  month: { label: 'Month', width: "INTERVAL '1 month'" },
  week: { label: 'Week', width: "INTERVAL '7 days'" },
  day: { label: 'Day', width: "INTERVAL '1 day'" },
  hour: { label: 'Hour', width: "INTERVAL '1 hour'" },
} as const;
export type TruncateTo = keyof typeof TRUNCATE_TO;

export const truncateDates = defineStep({
  type: 'truncateDates',
  params: z.object({ columns: Columns, to: z.enum(Object.keys(TRUNCATE_TO) as [TruncateTo, ...TruncateTo[]]) }),
  label: (p) => `Truncated ${names(p.columns)} to the ${p.to}`,
  compile: (p, { input }) => replaceEach(input, p.columns, (c) => `time_bucket(${TRUNCATE_TO[p.to].width}, ${ident(c)})`),
});

export const formatDates = defineStep({
  type: 'formatDates',
  params: z.object({ columns: Columns, format: z.string().min(1, 'give a format') }),
  label: (p) => `Formatted ${names(p.columns)} as ${p.format}`,
  compile: (p, { input }) => replaceEach(input, p.columns, (c) => `strftime(${ident(c)}, ${str(p.format)})`),
});
