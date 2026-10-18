// The column menu: what a right click on a column header or a cell in the results table offers, as in Power Query.
import type { PivotValuesRead } from '../flow/pivot';
import type { Step } from '../model';
import { STEP_GROUPS, stepForm, type StepGroup } from '../steps';
import { make, QUICK_FIXES, type FixContext } from './fixes';

export interface ColumnMenuContext extends FixContext {
  /** The right-clicked cell, when a cell (not a header) was clicked; null is an empty value. */
  cell?: { column: string; value: string | null };
  /** Read the values a column would turn into columns, from the viewed data, so a pivot arrives ready to run. */
  readPivotValues?: (column: string) => Promise<PivotValuesRead | undefined>;
}

/** A pivot of one column into columns, counting its rows under each value until the editor says what to summarise. */
async function pivotOn(c: ColumnMenuContext, column: string): Promise<Step> {
  const read = await c.readPivotValues?.(column).catch(() => undefined);
  return make('pivot', c, { rows: [], column, pivotValues: read?.values ?? [], moreValues: read?.more ?? false, values: [{ column, agg: 'count' }] });
}

/**
 * One entry of the column menu, in a group or a group's submenu: it adds a step, or opens the Replace values dialog.
 * A submenu is named after the step's group, the same name the quick-fix bar and the Add menu use for it.
 */
export type ColumnAction = { label: string; group: string; submenu?: string; hint?: string } & ({ step: (ctx: ColumnMenuContext) => Step | Promise<Step> } | { replace: { find: string | null } });

const fix = (id: string, option?: string) => (ctx: ColumnMenuContext) => QUICK_FIXES.find((f) => f.id === id)!.build(ctx, option);
const onColumns = (type: string, extra: Record<string, unknown> = {}) => (ctx: ColumnMenuContext) => make(type, ctx, { columns: ctx.columns, ...extra });

type StepAction = Extract<ColumnAction, { step: unknown }>;

/** An entry in the submenu of the step's group, marked "New column" when the step adds one. */
function inGroup(type: string, group: string, label: string, step: StepAction['step']): StepAction {
  const form = stepForm(type);
  if (!form) throw new Error(`Column menu entry ${label} has no step form for ${type}.`);
  return { label, group, submenu: form.group, step, ...(form.newColumn ? { hint: 'New column' } : {}) };
}

/** Submenu entries in the order the menus list their groups, so the column menu reads like the Add menu. */
const byGroup = (actions: StepAction[]) => [...actions].sort((a, b) => STEP_GROUPS.indexOf(a.submenu as StepGroup) - STEP_GROUPS.indexOf(b.submenu as StepGroup));

/** A value as a menu label shows it: quoted, and cut short when long. */
export const shown = (value: string) => `“${value.length > 24 ? `${value.slice(0, 23)}…` : value}”`;

const condition = (column: string, value: string | null) => (value == null || value.trim() === '' ? { column, op: 'empty', value: '' } : { column, op: 'equals', value });

/** The menu for the selected columns, with a group for the clicked value first when a cell was clicked. */
export function columnActions(ctx: ColumnMenuContext): ColumnAction[] {
  const one = ctx.columns.length === 1;
  const first = ctx.columns[0] ?? '';
  const cell = ctx.cell;
  const valueActions: ColumnAction[] = cell
    ? [
        { label: `Replace ${cell.value == null ? 'empty values' : shown(cell.value)}…`, group: 'This value', replace: { find: cell.value } },
        {
          label: `Keep rows where ${cell.value == null ? 'empty' : `it is ${shown(cell.value)}`}`,
          group: 'This value',
          step: (c) => make('filterRows', c, { mode: 'keep', match: 'all', conditions: [condition(cell.column, cell.value)], matchCase: true }),
        },
        {
          label: `Remove rows where ${cell.value == null ? 'empty' : `it is ${shown(cell.value)}`}`,
          group: 'This value',
          step: (c) => make('filterRows', c, { mode: 'remove', match: 'all', conditions: [condition(cell.column, cell.value)], matchCase: true }),
        },
      ]
    : [];
  // Kept short, as Power Query's is: the common row operations at the top, the rest in submenus.
  const g = one ? 'This column' : 'These columns';
  return [
    ...valueActions,
    { label: 'Replace values…', group: g, replace: { find: null } },
    { label: 'Remove matching rows…', group: g, step: (c) => make('filterRows', c, { mode: 'remove', conditions: [{ column: first, op: 'equals', value: '' }] }) },
    { label: 'Keep matching rows…', group: g, step: (c) => make('filterRows', c, { mode: 'keep', conditions: [{ column: first, op: 'notEmpty', value: '' }] }) },
    { label: 'Remove empty rows', group: g, step: onColumns('removeBlankRows') },
    { label: 'Remove duplicates', group: g, step: fix('duplicateRows') },
    { label: 'Keep duplicates', group: g, step: onColumns('duplicateRows', { keep: 'duplicates' }) },
    { label: 'Sort ascending', group: g, step: (c) => make('sortRows', c, { keys: c.columns.map((column) => ({ column, descending: false })) }) },
    { label: 'Sort descending', group: g, step: (c) => make('sortRows', c, { keys: c.columns.map((column) => ({ column, descending: true })) }) },

    // The rest, each under its step's group.
    ...byGroup([
      inGroup('trimWhitespace', g, 'Trim', fix('trimWhitespace')),
      inGroup('collapseSpaces', g, 'Collapse spaces', fix('collapseSpaces')),
      inGroup('removeNonPrinting', g, 'Remove non-printing characters', fix('removeNonPrinting')),
      inGroup('emptyToNull', g, 'Empty text to null', fix('emptyToNull')),

      inGroup('parseNumbers', g, 'Parse numbers', fix('parseNumbers')),
      inGroup('parseDates', g, 'Parse dates', fix('parseDates')),
      inGroup('changeType', g, 'To text', onColumns('changeType', { to: 'text' })),
      inGroup('changeType', g, 'To whole number', onColumns('changeType', { to: 'integer' })),
      inGroup('changeType', g, 'To decimal number', onColumns('changeType', { to: 'decimal' })),

      inGroup('renameColumns', g, one ? 'Rename…' : 'Rename columns…', (c) => make('renameColumns', c, { renames: c.columns.map((from) => ({ from, to: from })) })),
      ...(one ? [inGroup('duplicateColumn', g, 'Duplicate column', (c) => make('duplicateColumn', c, {}))] : []),
      ...(one ? [inGroup('splitByDelimiter', g, 'Split column…', (c) => make('splitByDelimiter', c, {}))] : []),
      inGroup('reorderColumns', g, 'Move to the front', onColumns('reorderColumns')),
      inGroup('removeColumns', g, one ? 'Remove column' : 'Remove columns', onColumns('removeColumns')),
      inGroup('removeColumns', g, 'Remove other columns', (c) => make('removeColumns', c, { columns: c.available.map((a) => a.name).filter((n) => !c.columns.includes(n)) })),

      inGroup('fillRows', g, 'Fill down', onColumns('fillRows', { direction: 'down' })),
      inGroup('fillRows', g, 'Fill up', onColumns('fillRows', { direction: 'up' })),

      inGroup('changeCase', g, 'UPPER CASE', fix('changeCase', 'upper')),
      inGroup('changeCase', g, 'lower case', fix('changeCase', 'lower')),
      inGroup('changeCase', g, 'Title Case', fix('changeCase', 'title')),
      inGroup('findReplace', g, 'Find and replace…', onColumns('findReplace')),
    ]),

    // Fields go in Values from the editor, which opens on the new step, each with its own aggregate.
    { label: one ? 'Group by this column…' : 'Group by these columns…', group: 'Summarise', step: (c) => make('pivot', c, { rows: c.columns, column: '', values: [] }) },
    ...(one ? [{ label: 'Pivot into columns…', group: 'Summarise', step: (c: ColumnMenuContext) => pivotOn(c, first) }] : []),
  ];
}

