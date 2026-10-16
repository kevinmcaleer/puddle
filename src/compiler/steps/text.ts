// The Text step group: find and replace, extract, pad, length.
import { z } from 'zod';
import { ident, list, num, str } from '../sql';
import { defineStep } from './registry';

const Column = z.string().min(1, 'pick a column');
const Columns = z.array(z.string().min(1)).min(1, 'pick at least one column');
const Name = z.string().trim().min(1, 'give the new column a name');
const names = (cols: string[]) => cols.join(', ');

/** An unclosed ( or [, a stray ), or a trailing \ in a pattern, said as how to fix it; undefined if there is none. */
function unclosedIn(pattern: string): string | undefined {
  let depth = 0;
  let inClass = false;
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === '\\') {
      if (i === pattern.length - 1) return 'escape a trailing \\ as \\\\';
      i++;
    } else if (inClass) {
      if (c === ']') inClass = false;
    } else if (c === '[') inClass = true;
    else if (c === '(') depth++;
    else if (c === ')' && --depth < 0) return 'close every ( with a )';
  }
  if (inClass) return 'close every [ with a ]';
  if (depth > 0) return 'close every ( with a )';
  return undefined;
}

/**
 * Why a pattern won't work in DuckDB (RE2), in words that say how to fix it, or undefined if it's fine.
 * JavaScript's parser catches syntax errors; RE2 also refuses look-arounds and back-references.
 */
export function regexProblem(pattern: string): string | undefined {
  try {
    new RegExp(pattern);
  } catch (e) {
    // Each browser words its errors differently, so the common mistakes are found by reading the pattern.
    const unclosed = unclosedIn(pattern);
    if (unclosed) return unclosed;
    const why = (e as Error).message.replace(/^Invalid regular expression: \/.*\/u?: /, '');
    if (/nothing to repeat/i.test(why)) return 'put something before * + ? or {, or escape it with \\';
    return `fix the pattern (${why.charAt(0).toLowerCase() + why.slice(1)})`;
  }
  if (/\(\?<?[=!]/.test(pattern)) return 'look-aheads and look-behinds are not supported; match the text and use a group instead';
  if (/\\[1-9]/.test(pattern)) return 'back-references like \\1 are not supported in the pattern';
  return undefined;
}

const Pattern = z
  .string()
  .min(1, 'give a pattern')
  .superRefine((p, ctx) => {
    const problem = regexProblem(p);
    if (problem) ctx.addIssue({ code: 'custom', message: problem });
  });

/** Escape text so a regular expression matches it literally. */
export const escapeRegex = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const text = (c: string) => `CAST(${ident(c)} AS VARCHAR)`;

export const findReplace = defineStep({
  type: 'findReplace',
  params: z
    .object({
      columns: Columns,
      find: z.string().min(1, 'give the text to find'),
      replace: z.string().default(''),
      regex: z.boolean().default(false),
      matchCase: z.boolean().default(true),
    })
    .superRefine((p, ctx) => {
      const problem = p.regex ? regexProblem(p.find) : undefined;
      if (problem) ctx.addIssue({ code: 'custom', path: ['find'], message: problem });
    }),
  label: (p) => `Replaced ${JSON.stringify(p.find)} with ${JSON.stringify(p.replace)} in ${names(p.columns)}`,
  compile: (p, { input }) => {
    const expr = (c: string) => {
      if (!p.regex && p.matchCase) return `replace(${text(c)}, ${str(p.find)}, ${str(p.replace)})`;
      // Plain text without case: match it literally, and keep \ in the replacement literal too.
      const pattern = p.regex ? p.find : escapeRegex(p.find);
      const replacement = p.regex ? p.replace : p.replace.replace(/\\/g, '\\\\');
      return `regexp_replace(${text(c)}, ${str(pattern)}, ${str(replacement)}, ${str(p.matchCase ? 'g' : 'gi')})`;
    };
    return `SELECT * REPLACE (${list(p.columns.map((c) => `${expr(c)} AS ${ident(c)}`))}) FROM ${input}`;
  },
});

const Extract = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('prefix'), length: z.number().int().positive('take at least one character') }),
  z.object({ mode: z.literal('suffix'), length: z.number().int().positive('take at least one character') }),
  z.object({ mode: z.literal('between'), start: z.string().min(1, 'give the text before'), end: z.string().min(1, 'give the text after') }),
  z.object({ mode: z.literal('regex'), pattern: Pattern, group: z.number().int().min(0).default(1) }),
]);

export const extractText = defineStep({
  type: 'extractText',
  params: z.intersection(z.object({ column: Column, into: Name }), Extract),
  label: (p) => {
    const what = p.mode === 'prefix' ? `the first ${p.length}` : p.mode === 'suffix' ? `the last ${p.length}` : p.mode === 'between' ? `text between ${p.start} and ${p.end}` : 'a match';
    return `Extracted ${what} from ${p.column} into ${p.into}`;
  },
  compile: (p, { input }) => {
    const c = text(p.column);
    // A miss gives an empty value, not ''.
    const expr =
      p.mode === 'prefix'
        ? `left(${c}, ${num(p.length)})`
        : p.mode === 'suffix'
          ? `right(${c}, ${num(p.length)})`
          : p.mode === 'between'
            ? `nullif(regexp_extract(${c}, ${str(`${escapeRegex(p.start)}(.*?)${escapeRegex(p.end)}`)}, 1), '')`
            : `nullif(regexp_extract(${c}, ${str(p.pattern)}, ${num(p.group)}), '')`;
    return `SELECT *, ${expr} AS ${ident(p.into)} FROM ${input}`;
  },
});

export const padText = defineStep({
  type: 'padText',
  params: z.object({
    columns: Columns,
    length: z.number().int().positive('give the length to pad to'),
    character: z.string().length(1, 'use one character'),
    side: z.enum(['start', 'end']).default('start'),
  }),
  label: (p) => `Padded ${names(p.columns)} to ${p.length}`,
  // Longer values are left as they are; lpad and rpad would cut them.
  compile: (p, { input }) =>
    `SELECT * REPLACE (${list(
      p.columns.map((c) => `CASE WHEN length(${text(c)}) >= ${num(p.length)} THEN ${text(c)} ELSE ${p.side === 'start' ? 'lpad' : 'rpad'}(${text(c)}, ${num(p.length)}, ${str(p.character)}) END AS ${ident(c)}`),
    )}) FROM ${input}`,
});

export const textLength = defineStep({
  type: 'textLength',
  params: z.object({ column: Column, into: Name }),
  label: (p) => `Added the length of ${p.column} as ${p.into}`,
  compile: (p, { input }) => `SELECT *, length(${text(p.column)}) AS ${ident(p.into)} FROM ${input}`,
});
