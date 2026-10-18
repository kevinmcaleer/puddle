// The quick fixes: one click on the selected columns adds one step.
import { parseLocale } from '../compiler';
import type { Detection } from '../dates';
import type { ColumnSchema, Step } from '../model';
import { newStep, relabel, STEP_GROUPS, stepForm, type StepGroup } from '../steps';

export interface FixContext {
  /** Columns selected in the results table; every fix acts on all of them in one step. */
  columns: string[];
  available: ColumnSchema[];
  locale: string;
  /** Detect date formats on a column of the viewed data. */
  detectDates: (column: string) => Promise<Detection | undefined>;
}

export interface QuickFixDef {
  /** The step type the fix adds. */
  id: string;
  /** The chip's label: short. */
  label: string;
  /** The step's group, the same one the column menu and the Add menu file it under. */
  group: StepGroup;
  /** Options shown as a menu from the chip, e.g. Case. */
  options?: { id: string; label: string }[];
  build: (ctx: FixContext, option?: string) => Step | Promise<Step>;
}

/** The locale's decimal mark, so 1.234,50 reads right in de-DE: from the steps' own table, else the browser's. */
export const decimalFor = (locale: string): '.' | ',' => {
  const known = parseLocale(locale);
  if (known) return known.decimal;
  try {
    return new Intl.NumberFormat(locale).formatToParts(1.5).find((p) => p.type === 'decimal')?.value === ',' ? ',' : '.';
  } catch {
    return '.';
  }
};

/** The step a fix adds, with its settings set to the selection rather than the form's defaults. */
export const make = (type: string, ctx: FixContext, params: Record<string, unknown>) => {
  const step = newStep(type, { selected: ctx.columns, available: ctx.available, decimal: decimalFor(ctx.locale), locale: ctx.locale });
  return relabel({ ...step, params: { ...step.params, ...params } });
};

/** The group of the step a fix adds: one grouping, shared with the column menu and the Add menu. */
const groupOf = (type: string): StepGroup => {
  const form = stepForm(type);
  if (!form) throw new Error(`Quick fix ${type} has no step form.`);
  return form.group;
};

const onColumns = (type: string, label: string): Omit<QuickFixDef, 'group'> => ({ id: type, label, build: (ctx) => make(type, ctx, { columns: ctx.columns }) });

const FIXES: Omit<QuickFixDef, 'group'>[] = [
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
    // Detected on the first column: the formats that together read it. An ambiguous day and month order leaves them for the user to choose.
    build: async (ctx) => {
      const detection = ctx.columns[0] ? await ctx.detectDates(ctx.columns[0]) : undefined;
      return make('parseDates', ctx, { columns: ctx.columns, formats: detection?.formats ?? [] });
    },
  },
  onColumns('removeNonPrinting', 'Non-printing'),
  {
    id: 'duplicateRows',
    label: 'Remove duplicates',
    build: (ctx) => make('duplicateRows', ctx, { columns: ctx.columns, keep: 'first' }),
  },
];

/** The quick fixes in the order the chips show them: by their step's group, as the menus list the groups. */
export const QUICK_FIXES: QuickFixDef[] = FIXES.map((f) => ({ ...f, group: groupOf(f.id) })).sort((a, b) => STEP_GROUPS.indexOf(a.group) - STEP_GROUPS.indexOf(b.group));
