// The column menu: what a right click on a column header or a cell in the results table offers, as in Power Query.
import type { PivotValuesRead } from '../flow/pivot';
import type { Step } from '../model';
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

/** One entry of the column menu, in a group or a group's submenu: it adds a step, or opens the Replace values dialog. */
export type ColumnAction = { label: string; group: string; submenu?: string } & ({ step: (ctx: ColumnMenuContext) => Step | Promise<Step> } | { replace: { find: string | null } });

const fix = (id: string, option?: string) => (ctx: ColumnMenuContext) => QUICK_FIXES.find((f) => f.id === id)!.build(ctx, option);
const onColumns = (type: string, extra: Record<string, unknown> = {}) => (ctx: ColumnMenuContext) => make(type, ctx, { columns: ctx.columns, ...extra });

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

    { label: 'Trim', group: g, submenu: 'Clean', step: fix('trimWhitespace') },
    { label: 'Collapse spaces', group: g, submenu: 'Clean', step: fix('collapseSpaces') },
    { label: 'Remove non-printing characters', group: g, submenu: 'Clean', step: fix('removeNonPrinting') },
    { label: 'Empty text to null', group: g, submenu: 'Clean', step: fix('emptyToNull') },
    { label: 'Fill down', group: g, submenu: 'Clean', step: onColumns('fillRows', { direction: 'down' }) },
    { label: 'Fill up', group: g, submenu: 'Clean', step: onColumns('fillRows', { direction: 'up' }) },

    { label: 'UPPER CASE', group: g, submenu: 'Text', step: fix('changeCase', 'upper') },
    { label: 'lower case', group: g, submenu: 'Text', step: fix('changeCase', 'lower') },
    { label: 'Title Case', group: g, submenu: 'Text', step: fix('changeCase', 'title') },
    { label: 'Find and replace…', group: g, submenu: 'Text', step: onColumns('findReplace') },
    ...(one ? [{ label: 'Split column…', group: g, submenu: 'Text', step: (c: ColumnMenuContext) => make('splitByDelimiter', c, {}) }] : []),

    { label: 'Parse numbers', group: g, submenu: 'Change type', step: fix('parseNumbers') },
    { label: 'Parse dates', group: g, submenu: 'Change type', step: fix('parseDates') },
    { label: 'To text', group: g, submenu: 'Change type', step: onColumns('changeType', { to: 'text' }) },
    { label: 'To whole number', group: g, submenu: 'Change type', step: onColumns('changeType', { to: 'integer' }) },
    { label: 'To decimal number', group: g, submenu: 'Change type', step: onColumns('changeType', { to: 'decimal' }) },

    { label: one ? 'Rename…' : 'Rename columns…', group: g, submenu: 'Columns', step: (c) => make('renameColumns', c, { renames: c.columns.map((from) => ({ from, to: from })) }) },
    ...(one ? [{ label: 'Duplicate column', group: g, submenu: 'Columns', step: (c: ColumnMenuContext) => make('duplicateColumn', c, {}) }] : []),
    { label: 'Move to the front', group: g, submenu: 'Columns', step: onColumns('reorderColumns') },
    { label: one ? 'Remove column' : 'Remove columns', group: g, submenu: 'Columns', step: onColumns('removeColumns') },
    { label: 'Remove other columns', group: g, submenu: 'Columns', step: (c) => make('removeColumns', c, { columns: c.available.map((a) => a.name).filter((n) => !c.columns.includes(n)) }) },

    // Fields go in Values from the editor, which opens on the new step, each with its own aggregate.
    { label: one ? 'Group by this column…' : 'Group by these columns…', group: 'Summarise', step: (c) => make('pivot', c, { rows: c.columns, column: '', values: [] }) },
    ...(one ? [{ label: 'Pivot into columns…', group: 'Summarise', step: (c: ColumnMenuContext) => pivotOn(c, first) }] : []),
  ];
}

