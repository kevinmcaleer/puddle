// Editor forms for the Columns step group.
import { COLUMN_TYPES } from '../compiler';
import { allSelected, pickColumns } from './basic';
import { defineStepForm, type DefaultsContext } from './forms';

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
  group: 'Columns',
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

defineStepForm({
  type: 'splitByDelimiter',
  title: 'Split by delimiter',
  group: 'Columns',
  fields: [
    { key: 'column', label: 'Column', kind: 'column' },
    { key: 'delimiter', label: 'Delimiter', kind: 'text', mono: true, placeholder: ',' },
    { key: 'into', label: 'New columns', kind: 'list', of: 'text', hint: 'Names for the parts, separated by commas.' },
    { key: 'keepOriginal', label: 'Keep the original column', kind: 'switch' },
  ],
  defaults: (ctx) => {
    const column = oneColumn(ctx);
    return { column, delimiter: ',', into: parts(column, 2, ctx), keepOriginal: false };
  },
});

defineStepForm({
  type: 'splitByPosition',
  title: 'Split by position',
  group: 'Columns',
  fields: [
    { key: 'column', label: 'Column', kind: 'column' },
    { key: 'positions', label: 'Split after character', kind: 'list', of: 'number', hint: 'Character counts, separated by commas.' },
    { key: 'into', label: 'New columns', kind: 'list', of: 'text', hint: 'One more name than there are positions.' },
    { key: 'keepOriginal', label: 'Keep the original column', kind: 'switch' },
  ],
  defaults: (ctx) => {
    const column = oneColumn(ctx);
    return { column, positions: [1], into: parts(column, 2, ctx), keepOriginal: false };
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
  fields: [
    { key: 'name', label: 'Name', kind: 'text', mono: true },
    { key: 'expression', label: 'Expression', kind: 'expression', hint: 'A DuckDB SQL expression, such as price * quantity.' },
  ],
  defaults: (ctx) => ({ name: freeName('new_column', ctx), expression: '' }),
});
