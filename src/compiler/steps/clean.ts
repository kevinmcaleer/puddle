// More Clean steps, mostly reached from the quick-fix bar: spaces, non-printing characters, empty text, numbers.
import { z } from 'zod';
import { PARSE_LOCALE_IDS, parseLocale } from '../locales';
import { ident, list, str } from '../sql';
import { defineStep } from './registry';

const Columns = z.array(z.string().min(1)).min(1, 'pick at least one column');
const names = (cols: string[]) => cols.join(', ');
const text = (c: string) => `CAST(${ident(c)} AS VARCHAR)`;

/** SELECT * REPLACE (expr(col) AS col, ...) for each column. */
const replaceEach = (input: string, columns: string[], expr: (col: string) => string) =>
  `SELECT * REPLACE (${list(columns.map((c) => `${expr(c)} AS ${ident(c)}`))}) FROM ${input}`;

export const collapseSpaces = defineStep({
  type: 'collapseSpaces',
  params: z.object({ columns: Columns }),
  label: (p) => `Collapsed spaces in ${names(p.columns)}`,
  compile: (p, { input }) => replaceEach(input, p.columns, (c) => `regexp_replace(${text(c)}, '\\s{2,}', ' ', 'g')`),
});

// Control characters, zero-width spaces and joiners, word joiner and byte-order mark.
const NON_PRINTING = '[\\x00-\\x1F\\x7F\\x{200B}-\\x{200D}\\x{2060}\\x{FEFF}]';

export const removeNonPrinting = defineStep({
  type: 'removeNonPrinting',
  params: z.object({ columns: Columns }),
  label: (p) => `Removed non-printing characters from ${names(p.columns)}`,
  compile: (p, { input }) => replaceEach(input, p.columns, (c) => `regexp_replace(${text(c)}, ${str(NON_PRINTING)}, '', 'g')`),
});

export const emptyToNull = defineStep({
  type: 'emptyToNull',
  params: z.object({ columns: Columns }),
  label: (p) => `Made empty text in ${names(p.columns)} empty values`,
  // Text that's only spaces counts as empty; the column keeps its type.
  compile: (p, { input }) => replaceEach(input, p.columns, (c) => `CASE WHEN trim(${text(c)}) = '' THEN NULL ELSE ${ident(c)} END`),
});

export const parseNumbers = defineStep({
  type: 'parseNumbers',
  params: z.object({
    columns: Columns,
    /** The decimal mark; the other of . and , is read as a thousands separator. */
    decimal: z.enum(['.', ',']).default('.'),
    /**
     * How the numbers are written, which sets the decimal mark in place of `decimal`. Kept with the step so it reads
     * the same on any machine; steps from before it existed have none and use `decimal`.
     */
    locale: z.preprocess((v) => (v === '' ? undefined : v), z.enum(PARSE_LOCALE_IDS, 'pick a locale Puddle knows').optional()),
  }),
  label: (p) => `Parsed numbers in ${names(p.columns)}${p.locale ? ` (${parseLocale(p.locale)!.label})` : ''}`,
  // Keep digits, the decimal mark and a minus sign; (12.00) is negative, as accountants write it.
  compile: (p, { input }) =>
    replaceEach(input, p.columns, (c) => {
      const decimal = parseLocale(p.locale)?.decimal ?? p.decimal;
      const kept = `regexp_replace(${text(c)}, ${str(decimal === '.' ? '[^0-9.\\-]' : '[^0-9,\\-]')}, '', 'g')`;
      const n = `TRY_CAST(${decimal === ',' ? `replace(${kept}, ',', '.')` : kept} AS DOUBLE)`;
      return `CASE WHEN regexp_matches(trim(${text(c)}), '^\\(.*\\)$') THEN -${n} ELSE ${n} END`;
    }),
});
