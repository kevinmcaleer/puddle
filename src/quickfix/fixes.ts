// The quick fixes: one click on the selected columns adds one step.
import type { Detection } from '../dates';
import type { ColumnSchema, Step } from '../model';
import { newStep, relabel } from '../steps';

export interface FixContext {
  /** Columns selected in the results table; every fix acts on all of them in one step. */
  columns: string[];
  available: ColumnSchema[];
  locale: string;
  /** Detect date formats on a column of the viewed data. */
  detectDates: (column: string) => Promise<Detection | undefined>;
}

export interface QuickFixDef {
  id: string;
  /** The chip's label: short. */
  label: string;
  /** Options shown as a menu from the chip, e.g. Case. */
  options?: { id: string; label: string }[];
  build: (ctx: FixContext, option?: string) => Step | Promise<Step>;
}

/** The locale's decimal mark, so 1.234,50 reads right in de-DE. */
export const decimalFor = (locale: string): '.' | ',' => {
  try {
    return new Intl.NumberFormat(locale).formatToParts(1.5).find((p) => p.type === 'decimal')?.value === ',' ? ',' : '.';
  } catch {
    return '.';
  }
};

/** The step a fix adds, with its settings set to the selection rather than the form's defaults. */
const make = (type: string, ctx: FixContext, params: Record<string, unknown>) => {
  const step = newStep(type, { selected: ctx.columns, available: ctx.available, decimal: decimalFor(ctx.locale) });
  return relabel({ ...step, params: { ...step.params, ...params } });
};

const onColumns = (type: string, label: string): QuickFixDef => ({ id: type, label, build: (ctx) => make(type, ctx, { columns: ctx.columns }) });

export const QUICK_FIXES: QuickFixDef[] = [
  onColumns('trimWhitespace', 'Trim'),
  {
    id: 'changeCase',
    label: 'Case',
    options: [
      { id: 'upper', label: 'UPPER CASE' },
      { id: 'lower', label: 'lower case' },
      { id: 'title', label: 'Title Case' },
      { id: 'sentence', label: 'Sentence case' },
    ],
    build: (ctx, mode = 'title') => make('changeCase', ctx, { columns: ctx.columns, mode }),
  },
  onColumns('collapseSpaces', 'Collapse spaces'),
  onColumns('emptyToNull', 'Empty to null'),
  onColumns('parseNumbers', 'Parse numbers'),
  {
    id: 'parseDates',
    label: 'Parse dates',
    // Detected on the first column; an ambiguous day and month order leaves the formats for the user to choose.
    build: async (ctx) => {
      const detection = ctx.columns[0] ? await ctx.detectDates(ctx.columns[0]) : undefined;
      return make('parseDates', ctx, { columns: ctx.columns, formats: detection?.best ? [detection.best] : [] });
    },
  },
  onColumns('removeNonPrinting', 'Non-printing'),
  {
    id: 'duplicateRows',
    label: 'Remove duplicates',
    build: (ctx) => make('duplicateRows', ctx, { columns: ctx.columns, keep: 'first' }),
  },
];
