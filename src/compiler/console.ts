// The scratch console: a query typed against the viewed node's rows, run once, without adding a node. The rows are
// bound as `input`, the same name a lone input has in a SQL node, so a console query carries over to a node unchanged.
import { compile, type Target } from './compile';
import { cleanCustomSql, customSqlProblem, INPUT_NAME } from './customSql';
import { ident } from './sql';
import { CUSTOM_SQL_OPENER } from './steps/advanced';
import type { Project } from '../model';

/** How many rows a console answer shows at most; the console is for looking, a SQL node for keeping. */
export const CONSOLE_ROW_LIMIT = 200;

/** Why the console query can't run, in words that say what to change, or undefined. */
export const consoleProblem = (query: string): string | undefined => customSqlProblem(query, [INPUT_NAME]);

/** The console query over the viewed result, bound as `input`, cut to the row limit. */
export function compileConsole(project: Project, target: Target, query: string, limit = CONSOLE_ROW_LIMIT): string {
  const problem = consoleProblem(query);
  if (problem) throw new Error(`This query can’t run: ${problem}.`);
  const viewed = compile(project, target).sql;
  return `WITH ${ident(INPUT_NAME)} AS (\n${viewed}\n)\n${CUSTOM_SQL_OPENER}\n${cleanCustomSql(query)}\n) LIMIT ${limit}`;
}
