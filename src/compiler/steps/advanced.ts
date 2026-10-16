// The Advanced step group: a custom SQL query over the step's input.
import { z } from 'zod';
import { cleanCustomSql, customSqlProblem, INPUT_NAME } from '../customSql';
import { ident } from '../sql';
import { defineStep } from './registry';

/** The line before the user's query in a compiled custom SQL step; the query starts on the line after it. */
export const CUSTOM_SQL_OPENER = 'SELECT * FROM (';

/**
 * The line of the user's query a DuckDB error points at ("LINE 7: ..."), given the SQL that failed. DuckDB
 * counts lines of the whole compiled query; the user's start after the opener of the last custom SQL step in it.
 */
export function customSqlErrorLine(compiledSql: string, query: string, error: string): { line: number; text: string } | undefined {
  const at = /LINE (\d+):/.exec(error);
  if (!at || customSqlProblem(query)) return undefined;
  const cleaned = cleanCustomSql(query);
  const pos = compiledSql.lastIndexOf(`${CUSTOM_SQL_OPENER}\n${cleaned}\n)`);
  if (pos < 0) return undefined;
  const openerLine = compiledSql.slice(0, pos).split('\n').length;
  const line = Number(at[1]) - openerLine;
  const lines = cleaned.split('\n');
  if (line < 1 || line > lines.length) return undefined;
  return { line, text: lines[line - 1]!.trim() };
}

export const customSql = defineStep({
  type: 'customSql',
  params: z.object({
    query: z.string().superRefine((q, ctx) => {
      const problem = customSqlProblem(q);
      if (problem) ctx.addIssue({ code: 'custom', message: problem });
    }),
  }),
  label: () => 'Ran custom SQL',
  // input is bound as a CTE around the query, which runs as a subquery: only a query can go there.
  compile: (p, { input }) => `WITH ${ident(INPUT_NAME)} AS (SELECT * FROM ${input})\n${CUSTOM_SQL_OPENER}\n${cleanCustomSql(p.query)}\n)`,
});
