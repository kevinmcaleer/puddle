// The SQL node: a hand-written query over any number of inputs. Each input is readable as input1, input2... and by
// the name of the node feeding it; a lone input is also plain `input`, so a console query carries over unchanged.
import { cleanCustomSql, customSqlProblem, INPUT_NAME } from './customSql';
import { ident } from './sql';
import { CUSTOM_SQL_OPENER } from './steps/advanced';
import type { SqlSpec } from '../model';

export interface SqlInput {
  /** The numbered input the wire comes into, from 0. */
  port: number;
  /** The CTE holding that input's rows. */
  cte: string;
  /** The name of the node feeding it. */
  label: string;
}

/** The names one input may be read by: "input1", then its node's name when that is different. */
export function sqlInputNames(input: Pick<SqlInput, 'port' | 'label'>, inputCount: number): string[] {
  const numbered = `input${input.port + 1}`;
  const names = [numbered];
  if (inputCount === 1) names.push(INPUT_NAME);
  const lower = input.label.toLowerCase();
  if (lower && !names.includes(lower) && !/^input\d*$/.test(lower)) names.push(input.label);
  return names;
}

/** Every table name a SQL node's query may read, in input order. */
export const sqlTableNames = (inputs: Pick<SqlInput, 'port' | 'label'>[]): string[] => inputs.flatMap((i) => sqlInputNames(i, inputs.length));

/** Why the query can't run, in words that say what to change, or undefined. */
export function sqlNodeProblem(spec: SqlSpec, inputs: Pick<SqlInput, 'port' | 'label'>[]): string | undefined {
  return customSqlProblem(spec.query, sqlTableNames(inputs));
}

/** The node's SELECT: the inputs bound by their names as CTEs around the query, which runs as a subquery. */
export function compileSqlNode(spec: SqlSpec, inputs: SqlInput[]): string {
  const ctes = inputs.flatMap((i) => sqlInputNames(i, inputs.length).map((name) => `${ident(name)} AS (SELECT * FROM ${i.cte})`));
  return `WITH ${ctes.join(', ')}\n${CUSTOM_SQL_OPENER}\n${cleanCustomSql(spec.query)}\n)`;
}
