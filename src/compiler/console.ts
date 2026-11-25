// The scratch console: a query typed against the viewed node's rows, run once, without adding a node. The rows are
// bound as `input`, the same name a lone input has in a SQL node, so a console query carries over to a node unchanged.
import type { Target } from './compile';
import { customSqlProblem, INPUT_NAME } from './customSql';
import { compileShellQuery, SHELL_ROW_LIMIT } from './shell';
import { isScript, readScriptOver } from './sqlScript';
import type { Project } from '../model';

/** How many rows a console answer shows at most; the console is for looking, a SQL node for keeping. */
export const CONSOLE_ROW_LIMIT = SHELL_ROW_LIMIT;

/**
 * Why the console query can't run, in words that say what to change, or undefined. A script (CREATE TABLE name AS a
 * query) is checked as the SQL node it becomes will read it; the console never runs one itself.
 */
export function consoleProblem(query: string): string | undefined {
  if (!isScript(query)) return customSqlProblem(query, [INPUT_NAME]);
  const read = readScriptOver(query, [INPUT_NAME], []);
  return 'problem' in read ? read.problem : undefined;
}

/** The console query over the viewed result, bound as `input`, cut to the row limit. */
export function compileConsole(project: Project, target: Target, query: string, limit = CONSOLE_ROW_LIMIT): string {
  const problem = consoleProblem(query);
  if (problem) throw new Error(`This query can’t run: ${problem}.`);
  if (isScript(query)) throw new Error('A script creates tables, so it runs in a SQL node, not in the console.');
  return compileShellQuery(project, new Map([[INPUT_NAME, target.nodeId]]), query, limit);
}
