// The Columns step group: reorder, change type, split, merge, add index, duplicate, add from expression.
// Rename and remove live in basic.ts with the other foundation steps.
import { z } from 'zod';
import { ident, list, num, str } from '../sql';
import { defineStep } from './registry';

const Column = z.string().min(1, 'pick a column');
const Columns = z.array(z.string().min(1)).min(1, 'pick at least one column');
const Name = z.string().trim().min(1, 'give the new column a name');

const names = (cols: string[]) => cols.join(', ');

/** Column types a step can convert to, by the word people use for them. */
export const COLUMN_TYPES = {
  text: 'VARCHAR',
  integer: 'BIGINT',
  decimal: 'DOUBLE',
  boolean: 'BOOLEAN',
  date: 'DATE',
  timestamp: 'TIMESTAMP',
} as const;
export type ColumnTypeName = keyof typeof COLUMN_TYPES;

export const reorderColumns = defineStep({
  type: 'reorderColumns',
  params: z.object({ columns: Columns }),
  label: (p) => `Moved ${names(p.columns)} to the front`,
  compile: (p, { input }) => `SELECT ${list(p.columns.map(ident))}, * EXCLUDE (${list(p.columns.map(ident))}) FROM ${input}`,
});

export const changeType = defineStep({
  type: 'changeType',
  params: z.object({
    columns: Columns,
    to: z.enum(Object.keys(COLUMN_TYPES) as [ColumnTypeName, ...ColumnTypeName[]]),
    /** Values that don't convert become empty, or stop the flow with an error. */
    onError: z.enum(['empty', 'fail']).default('empty'),
  }),
  label: (p) => `Changed ${names(p.columns)} to ${p.to}`,
  compile: (p, { input }) => {
    const cast = p.onError === 'fail' ? 'CAST' : 'TRY_CAST';
    return `SELECT * REPLACE (${list(p.columns.map((c) => `${cast}(${ident(c)} AS ${COLUMN_TYPES[p.to]}) AS ${ident(c)}`))}) FROM ${input}`;
  },
});

/** The input's columns, without `drop` when it should go. */
const keep = (drop: string[], keepOriginal: boolean) => (keepOriginal ? '*' : `* EXCLUDE (${list(drop.map(ident))})`);

/** Delimiters offered by name, as in Power Query; "custom" uses the delimiter typed in. */
export const SPLIT_DELIMITERS = { comma: ',', semicolon: ';', colon: ':', equals: '=', space: ' ', tab: '\t', newline: '\n', custom: '' } as const;
export type DelimiterKind = keyof typeof SPLIT_DELIMITERS;

/** Where a split goes: into new columns, or into one row per part (the other columns repeated). */
const SplitTo = z.enum(['columns', 'rows']).default('columns');
const SPLIT_PARTS = z.array(z.string().trim().min(1, 'name every new column')).default([]);

/** Splits into columns need a name per part; splits into rows keep the column's name. */
const needsNames = (p: { to: 'columns' | 'rows'; into: string[] }, ctx: z.RefinementCtx) => {
  if (p.to === 'columns' && !p.into.length) ctx.addIssue({ code: 'custom', path: ['into'], message: 'name at least one new column' });
};

const text = (column: string) => `CAST(${ident(column)} AS VARCHAR)`;
/** A marker no text holds, for splitting where a pattern matched. Lambda names are prefixed so no column shadows them. */
const MARK = 'chr(31)';

/** The working column a split builds its parts in; dropped from the output. */
const WORK = ident('__puddle_split');

/**
 * The SELECT for a split. `start` is computed once per row into a working column, then `partsOf` turns it into the
 * list of parts. The parts become one new column per name (missing parts empty, extra parts dropped), or one row per
 * part in place of the column, where a row with no parts keeps one empty value.
 */
function splitInto(p: { column: string; to: 'columns' | 'rows'; into: string[]; keepOriginal: boolean }, start: string, partsOf: (work: string) => string, input: string): string {
  const staged = `(SELECT * REPLACE (${partsOf(WORK)} AS ${WORK}) FROM (SELECT *, ${start} AS ${WORK} FROM ${input}))`;
  if (p.to === 'rows') return `SELECT * EXCLUDE (${WORK}) REPLACE (unnest(CASE WHEN coalesce(len(${WORK}), 0) = 0 THEN [NULL::VARCHAR] ELSE ${WORK} END) AS ${ident(p.column)}) FROM ${staged}`;
  const drop = p.keepOriginal ? [WORK] : [ident(p.column), WORK];
  return `SELECT * EXCLUDE (${list(drop)}), ${list(p.into.map((n, i) => `${WORK}[${num(i + 1)}] AS ${ident(n)}`))} FROM ${staged}`;
}

const delimiterWords: Record<Exclude<DelimiterKind, 'custom'>, string> = { comma: 'comma', semicolon: 'semicolon', colon: 'colon', equals: 'equals sign', space: 'space', tab: 'tab', newline: 'line break' };

export const splitByDelimiter = defineStep({
  type: 'splitByDelimiter',
  params: z
    .object({
      column: Column,
      /** A named delimiter, or "custom" for the one typed in `delimiter`. Saved before this option existed: custom. */
      delimiterKind: z.enum(Object.keys(SPLIT_DELIMITERS) as [DelimiterKind, ...DelimiterKind[]]).default('custom'),
      delimiter: z.string().default(''),
      /** Split at each occurrence, or once at the left-most or right-most one, into two parts. */
      at: z.enum(['each', 'left', 'right']).default('each'),
      to: SplitTo,
      /** With '"', delimiters inside double quotes don't split, and the quotes are taken off ("" reads as "). */
      quote: z.enum(['', '"']).default(''),
      into: SPLIT_PARTS,
      keepOriginal: z.boolean().default(false),
    })
    .superRefine((p, ctx) => {
      if (p.delimiterKind === 'custom' && !p.delimiter) ctx.addIssue({ code: 'custom', path: ['delimiter'], message: 'give the delimiter' });
      needsNames(p, ctx);
    }),
  label: (p) => {
    const d = p.delimiterKind === 'custom' ? JSON.stringify(p.delimiter) : delimiterWords[p.delimiterKind];
    const where = p.at === 'left' ? `at the first ${d}` : p.at === 'right' ? `at the last ${d}` : `on ${d}`;
    return `Split ${p.column} ${where}${p.to === 'rows' ? ' into rows' : ''}`;
  },
  compile: (p, { input }) => {
    const delimiter = p.delimiterKind === 'custom' ? p.delimiter : SPLIT_DELIMITERS[p.delimiterKind];
    const s = text(p.column);
    const d = str(delimiter);
    // Quoted: mark the delimiters outside quotes (the odd pieces between quote characters), then split on the mark.
    const fields = p.quote
      ? `string_split(array_to_string(list_transform(string_split(${s}, '"'), (__piece, __i) -> CASE WHEN __i % 2 = 1 THEN replace(__piece, ${d}, ${MARK}) ELSE __piece END), '"'), ${MARK})`
      : `string_split(${s}, ${d})`;
    const unquote = (f: string) => (p.quote ? `CASE WHEN length(${f}) >= 2 AND starts_with(${f}, '"') AND ends_with(${f}, '"') THEN replace(${f}[2:-2], '""', '"') ELSE ${f} END` : f);
    const partsOf = (f: string) =>
      p.at === 'left'
        ? `CASE WHEN len(${f}) < 2 THEN [${unquote(`${f}[1]`)}] ELSE [${unquote(`${f}[1]`)}, array_to_string(${f}[2:], ${d})] END`
        : p.at === 'right'
          ? `CASE WHEN len(${f}) < 2 THEN [${unquote(`${f}[1]`)}] ELSE [array_to_string(${f}[1:-2], ${d}), ${unquote(`${f}[-1]`)}] END`
          : p.quote
            ? `list_transform(${f}, __field -> ${unquote('__field')})`
            : f;
    return splitInto(p, fields, partsOf, input);
  },
});

export const splitByCharacters = defineStep({
  type: 'splitByCharacters',
  params: z
    .object({
      column: Column,
      count: z.number().int().positive('split every 1 or more characters'),
      /** Repeatedly every `count` characters, or once: the first `count` characters (left) or the last (right). */
      at: z.enum(['repeat', 'left', 'right']).default('repeat'),
      to: SplitTo,
      into: SPLIT_PARTS,
      keepOriginal: z.boolean().default(false),
    })
    .superRefine(needsNames),
  label: (p) =>
    `Split ${p.column} ${p.at === 'repeat' ? `every ${p.count} characters` : `after the ${p.at === 'left' ? 'first' : 'last'} ${p.count} characters`}`.replace(/ 1 characters$/, ' character') +
    (p.to === 'rows' ? ' into rows' : ''),
  compile: (p, { input }) => {
    const n = num(p.count);
    const partsOf = (s: string) =>
      p.at === 'left'
        ? `CASE WHEN length(${s}) > ${n} THEN [left(${s}, ${n}), substr(${s}, ${n} + 1)] ELSE [${s}] END`
        : p.at === 'right'
          ? `CASE WHEN length(${s}) > ${n} THEN [left(${s}, length(${s}) - ${n}), right(${s}, ${n})] ELSE [NULL, ${s}] END`
          : `list_transform(range(0, length(${s}), ${n}), __i -> substr(${s}, __i + 1, ${n}))`;
    return splitInto(p, text(p.column), partsOf, input);
  },
});

/** Character transitions to split at, as Power Query offers them, with the pair each one matches. */
export const SPLIT_TRANSITIONS = {
  lowerUpper: { label: 'lowercase to uppercase', pattern: '([a-z])([A-Z])' },
  upperLower: { label: 'uppercase to lowercase', pattern: '([A-Z])([a-z])' },
  digitNonDigit: { label: 'digit to non-digit', pattern: '([0-9])([^0-9])' },
  nonDigitDigit: { label: 'non-digit to digit', pattern: '([^0-9])([0-9])' },
} as const;
export type Transition = keyof typeof SPLIT_TRANSITIONS;

export const splitByTransition = defineStep({
  type: 'splitByTransition',
  params: z
    .object({
      column: Column,
      transition: z.enum(Object.keys(SPLIT_TRANSITIONS) as [Transition, ...Transition[]]),
      to: SplitTo,
      into: SPLIT_PARTS,
      keepOriginal: z.boolean().default(false),
    })
    .superRefine(needsNames),
  label: (p) => `Split ${p.column} from ${SPLIT_TRANSITIONS[p.transition].label}${p.to === 'rows' ? ' into rows' : ''}`,
  compile: (p, { input }) => {
    // The pairs never overlap (each ends in a character its own pattern can't start with), so one pass marks them all.
    const marked = `regexp_replace(${text(p.column)}, ${str(SPLIT_TRANSITIONS[p.transition].pattern)}, '\\1' || ${MARK} || '\\2', 'g')`;
    return splitInto(p, `string_split(${marked}, ${MARK})`, (f) => f, input);
  },
});

export const splitByPosition = defineStep({
  type: 'splitByPosition',
  params: z
    .object({
      column: Column,
      /** Split after these character counts, e.g. [3] makes "ABC123" into "ABC" and "123". */
      positions: z.array(z.number().int().positive('positions count from 1')).min(1, 'give at least one position'),
      to: SplitTo,
      into: SPLIT_PARTS,
      keepOriginal: z.boolean().default(false),
    })
    .refine((p) => p.positions.every((x, i) => i === 0 || x > p.positions[i - 1]!), { path: ['positions'], message: 'list positions from smallest to largest' })
    .refine((p) => p.to === 'rows' || p.into.length === p.positions.length + 1, { path: ['into'], message: 'name one more column than there are positions' }),
  label: (p) => `Split ${p.column} at ${p.positions.join(', ')}${p.to === 'rows' ? ' into rows' : ''}`,
  compile: (p, { input }) => {
    const pieces = (col: string) =>
      [...p.positions, null].map((end, i) => {
        const start = i === 0 ? 1 : p.positions[i - 1]! + 1;
        return end == null ? `substr(${col}, ${num(start)})` : `substr(${col}, ${num(start)}, ${num(end - start + 1)})`;
      });
    if (p.to === 'rows') return splitInto(p, text(p.column), (s) => `[${list(pieces(s))}]`, input);
    // Into columns as before rows were offered, so saved flows compile to the same SQL.
    const parts = pieces(text(p.column));
    return `SELECT ${keep([p.column], p.keepOriginal)}, ${list(p.into.map((n, i) => `${parts[i]} AS ${ident(n)}`))} FROM ${input}`;
  },
});

export const mergeColumns = defineStep({
  type: 'mergeColumns',
  params: z.object({
    columns: z.array(z.string().min(1)).min(2, 'pick at least two columns'),
    separator: z.string().default(' '),
    into: Name,
    keepOriginals: z.boolean().default(false),
  }),
  label: (p) => `Merged ${names(p.columns)} into ${p.into}`,
  // concat_ws skips empty values, so "Ada" and nothing merge to "Ada", not "Ada ".
  compile: (p, { input }) =>
    `SELECT ${keep(p.columns, p.keepOriginals)}, concat_ws(${str(p.separator)}, ${list(p.columns.map((c) => `CAST(${ident(c)} AS VARCHAR)`))}) AS ${ident(p.into)} FROM ${input}`,
});

export const addIndex = defineStep({
  type: 'addIndex',
  params: z.object({ name: Name, start: z.number().int().default(1) }),
  label: (p) => `Added index ${p.name}`,
  compile: (p, { input }) => {
    const offset = p.start - 1;
    const n = offset === 0 ? 'row_number() OVER ()' : `row_number() OVER () ${offset > 0 ? '+' : '-'} ${num(Math.abs(offset))}`;
    return `SELECT ${n} AS ${ident(p.name)}, * FROM ${input}`;
  },
});

export const duplicateColumn = defineStep({
  type: 'duplicateColumn',
  params: z.object({ column: Column, into: Name }),
  label: (p) => `Duplicated ${p.column} as ${p.into}`,
  compile: (p, { input }) => `SELECT *, ${ident(p.column)} AS ${ident(p.into)} FROM ${input}`,
});

/**
 * Refuse what could end the expression early: a statement separator, or a comment that would hide the rest
 * of the query. Strings and quoted names are skipped, so ';' inside 'a;b' is fine.
 */
export function expressionProblem(expr: string): string | undefined {
  const outside = expr.replace(/'(?:[^']|'')*'|"(?:[^"]|"")*"/g, '');
  if (/'|"/.test(outside)) return 'close the quote';
  if (outside.includes(';')) return 'use one expression, without ;';
  if (outside.includes('--') || outside.includes('/*')) return 'leave out comments';
  return undefined;
}

export const addColumn = defineStep({
  type: 'addColumn',
  params: z.object({
    name: Name,
    expression: z
      .string()
      .trim()
      .min(1, 'write an expression')
      .superRefine((e, ctx) => {
        const problem = expressionProblem(e);
        if (problem) ctx.addIssue({ code: 'custom', message: problem });
      }),
  }),
  label: (p) => `Added ${p.name}`,
  compile: (p, { input }) => `SELECT *, (${p.expression}) AS ${ident(p.name)} FROM ${input}`,
});
