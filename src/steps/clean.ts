// Editor forms for the Clean steps the quick-fix bar adds.
import { pickColumns } from './basic';
import { defineStepForm } from './forms';

const columnsOnly = { key: 'columns', label: 'Columns', kind: 'columns' } as const;

defineStepForm({ type: 'collapseSpaces', title: 'Collapse spaces', group: 'Clean', fields: [columnsOnly], defaults: (ctx) => ({ columns: pickColumns(ctx) }) });

defineStepForm({ type: 'removeNonPrinting', title: 'Remove non-printing characters', group: 'Clean', fields: [columnsOnly], defaults: (ctx) => ({ columns: pickColumns(ctx) }) });

defineStepForm({
  type: 'emptyToNull',
  title: 'Empty text to empty value',
  group: 'Clean',
  fields: [{ ...columnsOnly, hint: 'Text that is empty or only spaces becomes an empty value.' }],
  defaults: (ctx) => ({ columns: pickColumns(ctx) }),
});

defineStepForm({
  type: 'parseNumbers',
  title: 'Parse numbers',
  group: 'Clean',
  fields: [
    { ...columnsOnly, hint: 'Currency symbols, spaces and thousands separators are dropped.' },
    {
      key: 'decimal',
      label: 'Decimal mark',
      kind: 'select',
      options: [
        { value: '.', label: 'Point (1,234.50)' },
        { value: ',', label: 'Comma (1.234,50)' },
      ],
    },
  ],
  defaults: (ctx) => ({ columns: pickColumns(ctx), decimal: ctx.decimal ?? '.' }),
});
