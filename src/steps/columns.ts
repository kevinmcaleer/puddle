// Editor forms for the Columns step group.
import { COLUMN_TYPES, SPLIT_TRANSITIONS, type DelimiterKind } from '../compiler';
import { allSelected, pickColumns } from './basic';
import { defineStepForm, type DefaultsContext, type FieldSpec } from './forms';

/** The first selected column, else the first text column, else the first column. */
const oneColumn = (ctx: DefaultsContext) => pickColumns(ctx)[0] ?? ctx.available[0]?.name ?? '';

/** A name not already taken by a column arriving at the step. */
export function freeName(base: string, ctx: DefaultsContext, taken: string[] = []): string {
  const used = new Set([...ctx.available.map((c) => c.name), ...taken]);
  if (!used.has(base)) return base;
  for (let i = 2; ; i++) if (!used.has(`${base}_${i}`)) return `${base}_${i}`;
}

const parts = (column: string, n: number, ctx: DefaultsContext) =>
  Array.from({ length: n }, (_, i) => i).reduce<string[]>((acc, i) => [...acc, freeName(`${column || 'part'}_${i + 1}`, ctx, acc)], []);

defineStepForm({
  type: 'reorderColumns',
  title: 'Move columns to the front',
  group: 'Columns',
  fields: [{ key: 'columns', label: 'Columns', kind: 'columns', hint: 'In the order you pick them.' }],
  defaults: (ctx) => ({ columns: allSelected(ctx) }),
});

defineStepForm({
  type: 'changeType',
  title: 'Change type',
  group: 'Change type',
  fields: [
    { key: 'columns', label: 'Columns', kind: 'columns' },
    { key: 'to', label: 'New type', kind: 'select', options: Object.keys(COLUMN_TYPES).map((t) => ({ value: t, label: t.charAt(0).toUpperCase() + t.slice(1) })) },
    {
      key: 'onError',
      label: 'Values that don’t convert',
      kind: 'select',
      options: [
        { value: 'empty', label: 'Become empty' },
        { value: 'fail', label: 'Stop with an error' },
      ],
    },
  ],
  defaults: (ctx) => ({ columns: allSelected(ctx), to: 'integer', onError: 'empty' }),
});

const SPLIT_TO: FieldSpec = {
  key: 'to',
  label: 'Split into',
  kind: 'select',
  options: [
    { value: 'columns', label: 'Columns' },
    { value: 'rows', label: 'Rows' },
  ],
};
const toColumns = (p: Record<string, unknown>) => p.to !== 'rows';
const NEW_COLUMNS = { key: 'into', label: 'New columns', kind: 'list', of: 'text', when: toColumns } satisfies FieldSpec;
const KEEP_ORIGINAL: FieldSpec = { key: 'keepOriginal', label: 'Keep the original column', kind: 'switch', when: toColumns };

const DELIMITER_LABELS: Record<DelimiterKind, string> = {
  comma: 'Comma',
  semicolon: 'Semicolon',
  colon: 'Colon',
  equals: 'Equals sign',
  space: 'Space',
  tab: 'Tab',
  newline: 'Line break',
  custom: 'Custom',
};

/** How many parts the first row's value splits into, so the new columns match the data (at least two). */
function partsInFirstRow(column: string, delimiter: string, ctx: DefaultsContext): number {
  const value = ctx.firstRow?.[column];
  return Math.max(2, value ? value.split(delimiter).length : 2);
}

defineStepForm({
  type: 'splitByDelimiter',
  title: 'Split by delimiter',
  group: 'Columns',
  needsFirstRow: true,
  fields: [
    { key: 'column', label: 'Column', kind: 'column' },
    { key: 'delimiterKind', label: 'Delimiter', kind: 'select', options: Object.entries(DELIMITER_LABELS).map(([value, label]) => ({ value, label })) },
    { key: 'delimiter', label: 'Custom delimiter', kind: 'text', mono: true, placeholder: ',', when: (p) => p.delimiterKind === 'custom' },
    {
      key: 'at',
      label: 'Split at',
      kind: 'select',
      options: [
        { value: 'each', label: 'Each occurrence of the delimiter' },
        { value: 'left', label: 'Left-most delimiter' },
        { value: 'right', label: 'Right-most delimiter' },
      ],
    },
    SPLIT_TO,
    {
      key: 'quote',
      label: 'Quote character',
      kind: 'select',
      hint: 'Delimiters inside quotes don’t split.',
      options: [
        { value: '"', label: 'Double quote (")' },
        { value: '', label: 'None' },
      ],
    },
    { ...NEW_COLUMNS, hint: 'One name per column. Parts beyond these are dropped.' },
    KEEP_ORIGINAL,
  ],
  defaults: (ctx) => {
    const column = oneColumn(ctx);
    return { column, delimiterKind: 'comma', delimiter: '', at: 'each', to: 'columns', quote: '"', into: parts(column, partsInFirstRow(column, ',', ctx), ctx), keepOriginal: false };
  },
});

defineStepForm({
  type: 'splitByCharacters',
  title: 'Split by number of characters',
  group: 'Columns',
  fields: [
    { key: 'column', label: 'Column', kind: 'column' },
    { key: 'count', label: 'Number of characters', kind: 'number', min: 1 },
    {
      key: 'at',
      label: 'Split',
      kind: 'select',
      options: [
        { value: 'repeat', label: 'Repeatedly' },
        { value: 'left', label: 'Once, as far left as possible' },
        { value: 'right', label: 'Once, as far right as possible' },
      ],
    },
    SPLIT_TO,
    { ...NEW_COLUMNS, hint: 'One name per column. Parts beyond these are dropped.' },
    KEEP_ORIGINAL,
  ],
  defaults: (ctx) => {
    const column = oneColumn(ctx);
    return { column, count: 1, at: 'repeat', to: 'columns', into: parts(column, 2, ctx), keepOriginal: false };
  },
});

defineStepForm({
  type: 'splitByPosition',
  title: 'Split by position',
  group: 'Columns',
  fields: [
    { key: 'column', label: 'Column', kind: 'column' },
    { key: 'positions', label: 'Split after character', kind: 'list', of: 'number', hint: 'Character counts, separated by commas.' },
    SPLIT_TO,
    { ...NEW_COLUMNS, hint: 'One more name than there are positions.' },
    KEEP_ORIGINAL,
  ],
  defaults: (ctx) => {
    const column = oneColumn(ctx);
    return { column, positions: [1], to: 'columns', into: parts(column, 2, ctx), keepOriginal: false };
  },
});

defineStepForm({
  type: 'splitByTransition',
  title: 'Split by character transition',
  group: 'Columns',
  fields: [
    { key: 'column', label: 'Column', kind: 'column' },
    {
      key: 'transition',
      label: 'Split from',
      kind: 'select',
      options: Object.entries(SPLIT_TRANSITIONS).map(([value, t]) => ({ value, label: t.label.charAt(0).toUpperCase() + t.label.slice(1) })),
    },
    SPLIT_TO,
    { ...NEW_COLUMNS, hint: 'One name per column. Parts beyond these are dropped.' },
    KEEP_ORIGINAL,
  ],
  defaults: (ctx) => {
    const column = oneColumn(ctx);
    return { column, transition: 'lowerUpper', to: 'columns', into: parts(column, 2, ctx), keepOriginal: false };
  },
});

defineStepForm({
  type: 'mergeColumns',
  title: 'Merge columns',
  group: 'Columns',
  fields: [
    { key: 'columns', label: 'Columns', kind: 'columns', hint: 'In the order you pick them.' },
    { key: 'separator', label: 'Separator', kind: 'text', mono: true, hint: 'Empty values are skipped.' },
    { key: 'into', label: 'New column', kind: 'text', mono: true },
    { key: 'keepOriginals', label: 'Keep the original columns', kind: 'switch' },
  ],
  defaults: (ctx) => ({ columns: allSelected(ctx), separator: ' ', into: freeName('merged', ctx), keepOriginals: false }),
});

defineStepForm({
  type: 'addIndex',
  title: 'Add index column',
  group: 'Columns',
  newColumn: true,
  fields: [
    { key: 'name', label: 'Name', kind: 'text', mono: true },
    { key: 'start', label: 'Start at', kind: 'number' },
  ],
  defaults: (ctx) => ({ name: freeName('index', ctx), start: 1 }),
});

defineStepForm({
  type: 'duplicateColumn',
  title: 'Duplicate column',
  group: 'Columns',
  newColumn: true,
  fields: [
    { key: 'column', label: 'Column', kind: 'column' },
    { key: 'into', label: 'New column', kind: 'text', mono: true },
  ],
  defaults: (ctx) => {
    const column = oneColumn(ctx);
    return { column, into: freeName(`${column || 'column'}_copy`, ctx) };
  },
});

defineStepForm({
  type: 'addColumn',
  title: 'Add column from expression',
  group: 'Columns',
  newColumn: true,
  fields: [
    { key: 'name', label: 'Name', kind: 'text', mono: true },
    { key: 'expression', label: 'Expression', kind: 'expression', hint: 'A DuckDB SQL expression, such as price * quantity.' },
  ],
  defaults: (ctx) => ({ name: freeName('new_column', ctx), expression: '' }),
});
