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
