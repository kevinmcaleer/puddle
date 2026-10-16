// Append nodes: the columns they produce, type clashes found before anything runs, and the SQL that stacks the rows.
import type { AppendSpec, ColumnSchema } from '../model';
import { ident, str } from './sql';
import { describeType, typesFit } from './types';

/** One wired input of an Append, in input order. */
export interface AppendInput {
  /** The name of the node it comes from: shown in messages and written in the source column. */
  label: string;
  columns: ColumnSchema[];
}

export interface AppendColumn {
  name: string;
  /** The type from the first input that has it; DuckDB widens it where the inputs differ but fit. */
  type: string;
  /** Which inputs (0-based, in input order) have this column. The others leave it empty. */
  from: number[];
}

// DuckDB matches names without regard to case when stacking by name, and so do the column lists here.
const fold = (name: string) => name.toLowerCase();

/** The stacked columns in order, without the source column. By name: every name, first seen first. By position: names from the first input with that position. */
function stackedColumns(spec: AppendSpec, inputs: AppendInput[]): AppendColumn[] {
  if (spec.match === 'position') {
    const width = Math.max(0, ...inputs.map((i) => i.columns.length));
    return Array.from({ length: width }, (_, k) => {
      const first = inputs.find((i) => i.columns[k])!.columns[k]!;
      return { name: first.name, type: first.type, from: inputs.flatMap((i, n) => (i.columns[k] ? [n] : [])) };
    });
  }
  const out = new Map<string, AppendColumn>();
  inputs.forEach((input, n) => {
    for (const c of input.columns) {
      const hit = out.get(fold(c.name));
      if (hit) hit.from.push(n);
      else out.set(fold(c.name), { name: c.name, type: c.type, from: [n] });
    }
  });
  return [...out.values()];
}

/** The Append's output columns, with the source column last when it's on. */
export function appendColumns(spec: AppendSpec, inputs: AppendInput[]): AppendColumn[] {
  const stacked = stackedColumns(spec, inputs);
  return spec.tagRows ? [...stacked, { name: spec.tagColumn.trim(), type: 'VARCHAR', from: inputs.map((_, n) => n) }] : stacked;
}

export interface AppendProblem {
  message: string;
  /** The input (0-based, in input order) it's about, so the canvas can mark that wire. */
  input?: number;
  field?: 'tagColumn';
}

/** What stops these inputs stacking: a column whose types can't meet, or a source column name that's empty or taken. */
export function appendProblems(spec: AppendSpec, inputs: AppendInput[]): AppendProblem[] {
  const problems: AppendProblem[] = [];
  const at = (input: AppendInput, c: AppendColumn, k: number) => (spec.match === 'position' ? input.columns[k] : input.columns.find((x) => fold(x.name) === fold(c.name)));
  stackedColumns(spec, inputs).forEach((c, k) => {
    const [first, ...rest] = c.from;
    const base = at(inputs[first!]!, c, k)!;
    for (const n of rest) {
      const other = at(inputs[n]!, c, k)!;
      if (typesFit(base.type, other.type)) continue;
      const name = spec.match === 'position' && fold(other.name) !== fold(base.name) ? `Column ${k + 1} (${base.name}, ${other.name})` : base.name;
      problems.push({ input: n, message: `${name} is ${describeType(base.type)} in ${inputs[first!]!.label} and ${describeType(other.type)} in ${inputs[n]!.label}; change one with Change type.` });
      break;
    }
  });
  if (spec.tagRows) {
    const tag = spec.tagColumn.trim();
    if (!tag) problems.push({ field: 'tagColumn', message: 'Name the column that says which input each row came from.' });
    else if (stackedColumns(spec, inputs).some((c) => fold(c.name) === fold(tag))) problems.push({ field: 'tagColumn', message: `There’s already a column called ${tag}. Pick another name for the source column.` });
  }
  return problems;
}

/** The rows of every input stacked in input order, as one SELECT over their CTEs. Assumes appendProblems found nothing. */
export function compileAppend(spec: AppendSpec, inputs: Array<AppendInput & { cte: string }>): string {
  const tag = (input: AppendInput) => (spec.tagRows ? `, ${str(input.label)} AS ${ident(spec.tagColumn.trim())}` : '');
  if (spec.match === 'position') {
    const names = stackedColumns(spec, inputs).map((c) => ident(c.name));
    const parts = inputs.map((input) => {
      const cols = names.map((name, k) => (input.columns[k] ? `${ident(input.columns[k]!.name)} AS ${name}` : `NULL AS ${name}`));
      return `SELECT ${cols.join(', ')}${tag(input)} FROM ${input.cte}`;
    });
    return parts.join(' UNION ALL ');
  }
  const stacked = inputs.map((input) => `SELECT *${tag(input)} FROM ${input.cte}`).join(' UNION ALL BY NAME ');
  // By name, a column first seen in a later input would land after the source column: put that column last.
  return spec.tagRows ? `SELECT * EXCLUDE (${ident(spec.tagColumn.trim())}), ${ident(spec.tagColumn.trim())} FROM (${stacked})` : stacked;
}
