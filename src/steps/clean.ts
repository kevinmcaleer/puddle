// Editor forms for the Clean steps the quick-fix bar adds.
import { isParseLocale, PARSE_LOCALES, REPLACE_MATCHES } from '../compiler';
import type { ColumnSchema } from '../model';
import { columnKind } from '../ui/columnKind';
import { pickColumns } from './basic';
import { defineStepForm } from './forms';

const columnsOnly = { key: 'columns', label: 'Columns', kind: 'columns' } as const;

defineStepForm({ type: 'collapseSpaces', title: 'Collapse spaces', group: 'Clean', fields: [columnsOnly], defaults: (ctx) => ({ columns: pickColumns(ctx) }) });

defineStepForm({ type: 'removeNonPrinting', title: 'Remove non-printing characters', group: 'Clean', fields: [columnsOnly], defaults: (ctx) => ({ columns: pickColumns(ctx) }) });

defineStepForm({
  type: 'fixMojibake',
  title: 'Fix mangled characters',
  group: 'Clean',
  fields: [{ ...columnsOnly, hint: 'Text saved in the wrong encoding, such as Ã© for é and â€™ for ’, is put back.' }],
  defaults: (ctx) => ({ columns: pickColumns(ctx) }),
});

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
  group: 'Change type',
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

/** Whether a column of this type can hold the replacement as it is: text takes anything, numbers take numbers. */
export function holdsReplacement(type: string, replacement: string): boolean {
  const kind = columnKind(type);
  if (kind === 'text' || kind === 'json') return true;
  if (kind === 'integer') return /^\s*-?\d+\s*$/.test(replacement);
  if (kind === 'decimal') return /^\s*-?(\d+\.?\d*|\.\d+)(e-?\d+)?\s*$/i.test(replacement);
  if (kind === 'boolean') return /^\s*(true|false)\s*$/i.test(replacement);
  return false;
}

/** The picked columns that can't hold the replacement, unless the step turns them into text. */
export function replacementProblem(p: Record<string, unknown>, columns: ColumnSchema[]): string | undefined {
  if (p.toText || p.replaceWithNull) return undefined;
  const picked = new Set((p.columns as string[] | undefined) ?? []);
  const cant = columns.filter((c) => picked.has(c.name) && !holdsReplacement(c.type, String(p.replace ?? '')));
  if (!cant.length) return undefined;
  return `${cant.map((c) => c.name).join(', ')} can’t hold ${JSON.stringify(p.replace ?? '')}. Turn on Change to text, or replace with a value of the column’s type.`;
}

defineStepForm({
  type: 'replaceValues',
  title: 'Replace values',
  group: 'Clean',
  fields: [
    { ...columnsOnly, hint: 'Whole values are replaced. To change text inside values, use Find and replace.' },
    { key: 'match', label: 'Find', kind: 'select', options: Object.entries(REPLACE_MATCHES).map(([value, label]) => ({ value, label })) },
    { key: 'find', label: 'Value to find', kind: 'text', mono: true, when: (p) => p.match === 'value' },
    { key: 'matchCase', label: 'Match case', kind: 'switch', when: (p) => p.match === 'value' },
    { key: 'replaceWithNull', label: 'Replace with an empty value (null)', kind: 'switch' },
    { key: 'replace', label: 'Replace with', kind: 'text', mono: true, when: (p) => !p.replaceWithNull, problem: replacementProblem },
    { key: 'toText', label: 'Change to text', kind: 'switch', hint: 'Lets a number or date column take a word such as “empty”.', when: (p) => !p.replaceWithNull },
  ],
  defaults: (ctx) => {
    const columns = pickColumns(ctx);
    // A number or date column picked: turn it into text, so the usual replacement (a word) fits.
    const toText = ctx.available.some((c) => columns.includes(c.name) && !holdsReplacement(c.type, 'empty'));
    return { columns, match: 'null', find: '', replace: 'empty', replaceWithNull: false, matchCase: true, toText };
  },
});
