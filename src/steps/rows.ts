// Editor forms for the Rows step group.
import { headerNames } from '../compiler';
import { allSelected, pickColumns } from './basic';
import { defineStepForm } from './forms';

defineStepForm({
  type: 'filterRows',
  title: 'Filter rows',
  group: 'Rows',
  fields: [
    {
      key: 'mode',
      label: 'Rows that match',
      kind: 'select',
      options: [
        { value: 'keep', label: 'Keep them' },
        { value: 'remove', label: 'Remove them' },
      ],
    },
    {
      key: 'match',
      label: 'Match',
      kind: 'select',
      options: [
        { value: 'all', label: 'All conditions' },
        { value: 'any', label: 'Any condition' },
      ],
    },
    { key: 'conditions', label: 'Conditions', kind: 'conditions' },
    { key: 'matchCase', label: 'Match case', kind: 'switch' },
  ],
  defaults: (ctx) => ({
    mode: 'keep',
    match: 'all',
    conditions: [{ column: pickColumns(ctx)[0] ?? ctx.available[0]?.name ?? '', op: 'notEmpty', value: '' }],
    matchCase: false,
  }),
});

defineStepForm({
  type: 'realignRows',
  title: 'Realign rows',
  group: 'Rows',
  fields: [
    {
      key: 'rows',
      label: 'Rows to realign',
      kind: 'select',
      options: [
        { value: 'where', label: 'Those matching the conditions' },
        { value: 'from', label: 'From a row number down' },
      ],
    },
    { key: 'from', label: 'From row', kind: 'number', min: 1, hint: 'Counted from 1, in the order the rows come in.' },
    { key: 'conditions', label: 'Conditions', kind: 'conditions', hint: 'A column that is empty only on the shifted rows picks them out.' },
    {
      key: 'match',
      label: 'Match',
      kind: 'select',
      options: [
        { value: 'all', label: 'All conditions' },
        { value: 'any', label: 'Any condition' },
      ],
    },
    { key: 'columns', label: 'Columns that moved', kind: 'columns', hint: 'In table order, from the first column that moved to the last. Each takes the value of its neighbour; the moved columns are read as text, so add Change type after.' },
    {
      key: 'direction',
      label: 'Move cells',
      kind: 'select',
      options: [
        { value: 'right', label: 'Right (a cell was deleted)' },
        { value: 'left', label: 'Left (a cell was inserted)' },
      ],
    },
    { key: 'by', label: 'By', kind: 'number', min: 1, hint: 'Columns.' },
  ],
  defaults: (ctx) => {
    const first = pickColumns(ctx)[0] ?? ctx.available[0]?.name ?? '';
    const start = Math.max(0, ctx.available.findIndex((c) => c.name === first));
    return { rows: 'where', from: 1, conditions: [{ column: ctx.available[ctx.available.length - 1]?.name ?? first, op: 'empty', value: '' }], match: 'all', matchCase: false, columns: ctx.available.slice(start).map((c) => c.name), direction: 'right', by: 1 };
  },
});

defineStepForm({
  type: 'sortRows',
  title: 'Sort rows',
  group: 'Rows',
  fields: [{ key: 'keys', label: 'Sort by', kind: 'sortKeys', hint: 'Ties keep their order. Empty values go last.' }],
  defaults: (ctx) => ({ keys: (ctx.selected.length ? ctx.selected : ctx.available.slice(0, 1).map((c) => c.name)).map((column) => ({ column, descending: false })) }),
});

defineStepForm({
  type: 'removeRows',
  title: 'Remove top or bottom rows',
  group: 'Rows',
  fields: [
    {
      key: 'from',
      label: 'From the',
      kind: 'select',
      options: [
        { value: 'top', label: 'Top' },
        { value: 'bottom', label: 'Bottom' },
      ],
    },
    { key: 'count', label: 'Rows', kind: 'number', min: 1 },
  ],
  defaults: () => ({ from: 'top', count: 1 }),
});

defineStepForm({
  type: 'removeBlankRows',
  title: 'Remove blank rows',
  group: 'Rows',
  fields: [{ key: 'columns', label: 'Blank in', kind: 'columns', hint: 'Pick none to remove rows where every column is blank.' }],
  defaults: (ctx) => ({ columns: allSelected(ctx) }),
});

defineStepForm({
  type: 'duplicateRows',
  title: 'Remove duplicates',
  group: 'Rows',
  fields: [
    { key: 'columns', label: 'Compare', kind: 'columns', hint: 'Pick none to compare whole rows.' },
    {
      key: 'keep',
      label: 'Keep',
      kind: 'select',
      options: [
        { value: 'first', label: 'The first of each, removing the rest' },
        { value: 'duplicates', label: 'Only rows that have duplicates' },
      ],
    },
  ],
  defaults: (ctx) => ({ columns: allSelected(ctx), keep: 'first' }),
});

defineStepForm({
  type: 'fillRows',
  title: 'Fill down or up',
  group: 'Rows',
  fields: [
    { key: 'columns', label: 'Columns', kind: 'columns', hint: 'Empty cells take the nearest value above, or below.' },
    {
      key: 'direction',
      label: 'Direction',
      kind: 'select',
      options: [
        { value: 'down', label: 'Down' },
        { value: 'up', label: 'Up' },
      ],
    },
  ],
  defaults: (ctx) => ({ columns: allSelected(ctx), direction: 'down' }),
});

defineStepForm({
  type: 'promoteHeaders',
  title: 'Use first row as headers',
  group: 'Rows',
  fields: [{ key: 'renames', label: 'New names', kind: 'renames', hint: 'Read from the first row when the step was added.' }],
  needsFirstRow: true,
  defaults: (ctx) => ({ renames: headerNames(ctx.available.map((c) => c.name), ctx.firstRow ?? {}) }),
});
