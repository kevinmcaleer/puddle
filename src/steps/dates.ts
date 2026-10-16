// Editor forms for the Dates step group. Parse dates detects formats when the step is added and again in the form.
import { DATE_PARTS, INTERVAL_UNITS, TRUNCATE_TO } from '../compiler';
import { describeFormat, strftime } from '../dates';
import { columnKind } from '../ui/columnKind';
import { isKind, pickColumns, pickKind } from './basic';
import { freeName } from './columns';
import { defineStepForm, type DefaultsContext } from './forms';

const options = (o: Record<string, { label: string }>) => Object.entries(o).map(([value, { label }]) => ({ value, label }));
const when = (key: string, ...values: string[]) => (p: Record<string, unknown>) => values.includes(String(p[key]));
const dateColumns = { key: 'columns', label: 'Columns', kind: 'columns', expects: 'date' } as const;

/** Whether the first column the step starts with holds a time of day. */
const firstHasTime = (ctx: DefaultsContext, columns: string[]) => columnKind(ctx.available.find((c) => c.name === columns[0])?.type ?? '') === 'timestamp';

defineStepForm({
  type: 'parseDates',
  title: 'Parse dates',
  group: 'Dates',
  fields: [
    { key: 'columns', label: 'Columns', kind: 'columns' },
    { key: 'formats', label: 'Formats', kind: 'dateFormats', hint: 'Tried in order; each value is read by the first that fits.' },
    {
      key: 'onError',
      label: 'Values no format reads',
      kind: 'select',
      options: [
        { value: 'empty', label: 'Become empty' },
        { value: 'fail', label: 'Stop with an error' },
      ],
    },
  ],
  detectsDates: true,
  // An ambiguous day and month order leaves formats empty, so the form asks.
  defaults: (ctx) => ({ columns: pickColumns(ctx).slice(0, 1), formats: ctx.dates?.best ? [ctx.dates.best] : [], onError: 'empty' }),
});

defineStepForm({
  type: 'extractDatePart',
  title: 'Extract date part',
  group: 'Dates',
  fields: [
    dateColumns,
    { key: 'part', label: 'Part', kind: 'select', options: options(DATE_PARTS), hint: 'Days of the week count from Monday as 1.' },
    { key: 'replace', label: 'Replace the dates with the part', kind: 'switch' },
  ],
  defaults: (ctx) => ({ columns: pickKind(ctx, 'date'), part: 'year', replace: false }),
});

defineStepForm({
  type: 'shiftDates',
  title: 'Add or subtract time',
  group: 'Dates',
  fields: [
    dateColumns,
    {
      key: 'direction',
      label: 'Direction',
      kind: 'select',
      options: [
        { value: 'add', label: 'Add' },
        { value: 'subtract', label: 'Subtract' },
      ],
    },
    {
      key: 'by',
      label: 'Amount',
      kind: 'select',
      options: [
        { value: 'fixed', label: 'The same for every row' },
        { value: 'column', label: 'From a column' },
      ],
    },
    { key: 'amount', label: 'How many', kind: 'number', min: 0, when: when('by', 'fixed') },
    { key: 'amountColumn', label: 'Amount column', kind: 'column', expects: 'number', when: when('by', 'column') },
    { key: 'unit', label: 'Unit', kind: 'select', options: options(INTERVAL_UNITS) },
    { key: 'keepTime', label: 'Keep the time of day', kind: 'switch' },
  ],
  defaults: (ctx) => {
    const columns = pickKind(ctx, 'date');
    const amountColumn = ctx.available.find((c) => isKind(c.type, 'number'))?.name ?? '';
    return { columns, direction: 'add', by: 'fixed', amount: 1, amountColumn, unit: 'days', keepTime: firstHasTime(ctx, columns) };
  },
});

defineStepForm({
  type: 'dateDifference',
  title: 'Time between dates',
  group: 'Dates',
  fields: [
    { key: 'start', label: 'From', kind: 'column', expects: 'date' },
    { key: 'end', label: 'To', kind: 'column', expects: 'date' },
    { key: 'unit', label: 'In', kind: 'select', options: options(INTERVAL_UNITS), hint: 'Whole units: 15 January to 14 February is 0 months. An earlier To gives a negative number.' },
    { key: 'into', label: 'New column', kind: 'text', mono: true },
  ],
  defaults: (ctx) => {
    const dates = ctx.selected.length ? ctx.selected : ctx.available.filter((c) => isKind(c.type, 'date')).map((c) => c.name);
    return { start: dates[0] ?? '', end: dates[1] ?? dates[0] ?? '', unit: 'days', into: freeName('difference', ctx) };
  },
});

defineStepForm({
  type: 'truncateDates',
  title: 'Truncate dates',
  group: 'Dates',
  fields: [dateColumns, { key: 'to', label: 'To the start of the', kind: 'select', options: options(TRUNCATE_TO), hint: 'Weeks start on Monday.' }],
  defaults: (ctx) => ({ columns: pickKind(ctx, 'date'), to: 'month' }),
});

/** The format written out for an example date, so the form shows what it makes before it runs. */
export function formatExample(format: unknown): string | undefined {
  if (typeof format !== 'string' || !format) return undefined;
  const out = strftime(format);
  return out == null ? `Reads as ${describeFormat(format)}. Part of it can’t be previewed here; the result shows what DuckDB makes of it.` : `Friday 1 March 2024 at 14:05:09 becomes ${out}`;
}

defineStepForm({
  type: 'formatDates',
  title: 'Format dates as text',
  group: 'Dates',
  fields: [dateColumns, { key: 'format', label: 'Format', kind: 'text', mono: true, placeholder: '%d/%m/%Y', liveHint: (p) => formatExample(p.format) }],
  defaults: (ctx) => ({ columns: pickKind(ctx, 'date'), format: '%d/%m/%Y' }),
});
