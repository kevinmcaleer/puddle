// Foundation step types. The Columns, Rows and Text step groups add theirs alongside these.
import { z } from 'zod';
import { ident, list } from '../sql';
import { defineStep } from './registry';

const Columns = z.array(z.string().min(1)).min(1, 'pick at least one column');

const names = (cols: string[]) => cols.join(', ');

/** SELECT * REPLACE (expr(col) AS col, ...) for each column. */
const replaceEach = (input: string, columns: string[], expr: (col: string) => string) =>
  `SELECT * REPLACE (${list(columns.map((c) => `${expr(ident(c))} AS ${ident(c)}`))}) FROM ${input}`;

export const trimWhitespace = defineStep({
  type: 'trimWhitespace',
  params: z.object({ columns: Columns }),
  label: (p) => `Trimmed ${names(p.columns)}`,
  compile: (p, { input }) => replaceEach(input, p.columns, (c) => `trim(${c})`),
});

const CASE_FN = { upper: 'upper', lower: 'lower' } as const;

export const changeCase = defineStep({
  type: 'changeCase',
  params: z.object({ columns: Columns, mode: z.enum(['upper', 'lower', 'title', 'sentence']) }),
  label: (p) => `Changed ${names(p.columns)} to ${p.mode} case`,
  compile: (p, { input }) =>
    replaceEach(input, p.columns, (c) => {
      switch (p.mode) {
        case 'upper':
        case 'lower':
          return `${CASE_FN[p.mode]}(${c})`;
        case 'sentence':
          return `upper(left(${c}, 1)) || lower(substr(${c}, 2))`;
        case 'title':
          // Capitalise the first letter of each word, lower-case the rest.
          return `list_aggr(list_transform(string_split(${c}, ' '), w -> upper(left(w, 1)) || lower(substr(w, 2))), 'string_agg', ' ')`;
      }
    }),
});

export const renameColumns = defineStep({
  type: 'renameColumns',
  params: z.object({ renames: z.array(z.object({ from: z.string().min(1), to: z.string().min(1) })).min(1, 'add at least one rename') }),
  label: (p) => (p.renames.length === 1 ? `Renamed ${p.renames[0]!.from} to ${p.renames[0]!.to}` : `Renamed ${p.renames.length} columns`),
  compile: (p, { input }) => `SELECT * RENAME (${list(p.renames.map((r) => `${ident(r.from)} AS ${ident(r.to)}`))}) FROM ${input}`,
});

export const removeColumns = defineStep({
  type: 'removeColumns',
  params: z.object({ columns: Columns }),
  label: (p) => `Removed ${names(p.columns)}`,
  compile: (p, { input }) => `SELECT * EXCLUDE (${list(p.columns.map(ident))}) FROM ${input}`,
});
