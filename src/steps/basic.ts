// Editor forms for the foundation steps.
import { defineStepForm, type DefaultsContext } from './forms';

/** Selected columns, else the first text column, else nothing (the form then asks for one). */
export const pickColumns = ({ selected, available }: DefaultsContext) =>
  selected.length ? selected : available.filter((c) => /CHAR|TEXT|STRING/i.test(c.type)).slice(0, 1).map((c) => c.name);

export const allSelected = ({ selected }: DefaultsContext) => selected;

defineStepForm({
  type: 'trimWhitespace',
  title: 'Trim whitespace',
  group: 'Clean',
  fields: [{ key: 'columns', label: 'Columns', kind: 'columns' }],
  defaults: (ctx) => ({ columns: pickColumns(ctx) }),
});

defineStepForm({
  type: 'changeCase',
  title: 'Change case',
  group: 'Text',
  fields: [
    { key: 'columns', label: 'Columns', kind: 'columns' },
    {
      key: 'mode',
      label: 'Case',
      kind: 'select',
      options: [
        { value: 'upper', label: 'UPPER CASE' },
        { value: 'lower', label: 'lower case' },
        { value: 'title', label: 'Title Case' },
        { value: 'sentence', label: 'Sentence case' },
      ],
    },
  ],
  defaults: (ctx) => ({ columns: pickColumns(ctx), mode: 'title' }),
});

defineStepForm({
  type: 'renameColumns',
  title: 'Rename columns',
  group: 'Columns',
  fields: [{ key: 'renames', label: 'Renames', kind: 'renames' }],
  defaults: ({ selected, available }) => ({ renames: (selected.length ? selected : available.slice(0, 1).map((c) => c.name)).map((from) => ({ from, to: from })) }),
});

defineStepForm({
  type: 'removeColumns',
  title: 'Remove columns',
  group: 'Columns',
  fields: [{ key: 'columns', label: 'Columns', kind: 'columns' }],
  defaults: (ctx) => ({ columns: allSelected(ctx) }),
});
