// Editor forms for the Clean steps the quick-fix bar adds.
import { isParseLocale, PARSE_LOCALES } from '../compiler';
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

/** A locale with how it writes a number: German (1.234,56). */
const numberLocales = Object.entries(PARSE_LOCALES).map(([value, l]) => ({ value, label: `${l.label} (${l.decimal === ',' ? '1.234,56' : '1,234.56'})` }));

defineStepForm({
  type: 'parseNumbers',
  title: 'Parse numbers',
  group: 'Clean',
  fields: [
    { ...columnsOnly, hint: 'Currency symbols, spaces and thousands separators are dropped.' },
    {
      key: 'locale',
      label: 'Locale',
      kind: 'select',
      options: [{ value: '', label: 'Choose the decimal mark' }, ...numberLocales],
      hint: 'How the numbers are written. Kept with the step, so it reads the same on any computer.',
    },
    {
      key: 'decimal',
      label: 'Decimal mark',
      kind: 'select',
      options: [
        { value: '.', label: 'Point (1,234.50)' },
        { value: ',', label: 'Comma (1.234,50)' },
      ],
      when: (p) => !p.locale,
    },
  ],
  // Starts with the project's locale, when the step knows it; otherwise with no locale (''), and the decimal mark.
  defaults: (ctx) => {
    const locale = isParseLocale(ctx.locale) ? ctx.locale : '';
    return { columns: pickColumns(ctx), decimal: ctx.decimal ?? (locale ? PARSE_LOCALES[locale].decimal : '.'), locale };
  },
});
