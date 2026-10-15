// Editor form for parse dates. Detection runs when the step is added and again in the form.
import { pickColumns } from './basic';
import { defineStepForm } from './forms';

defineStepForm({
  type: 'parseDates',
  title: 'Parse dates',
  group: 'Dates',
  fields: [
    { key: 'columns', label: 'Columns', kind: 'columns' },
    { key: 'formats', label: 'Formats', kind: 'dateFormats', hint: 'Tried in order; each value is read by the first that fits.' },
    {
      key: 'onError',
      label: 'Values no format reads',
      kind: 'select',
      options: [
        { value: 'empty', label: 'Become empty' },
        { value: 'fail', label: 'Stop with an error' },
      ],
    },
  ],
  detectsDates: true,
  // An ambiguous day and month order leaves formats empty, so the form asks.
  defaults: (ctx) => ({ columns: pickColumns(ctx).slice(0, 1), formats: ctx.dates?.best ? [ctx.dates.best] : [], onError: 'empty' }),
});
