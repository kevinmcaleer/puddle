// Query nodes, built in the query designer: tables joined by the lines drawn between their columns, then the grid's
// fields, criteria and sorting, as one SELECT. With the Totals row on, the same SELECT groups and summarises: Where
// fields filter rows before grouping, and criteria on the other fields filter the groups.
import type { ColumnSchema, QueryCriteria, QueryCriteriaOp, QueryField, QueryJoin, QueryJoinKind, QuerySpec, QueryTotal } from '../model';
import { ident, num, str } from './sql';
import { expressionProblem } from './steps/columns';
import { describeType, typeFamily, typesFit } from './types';

/** One table of a query: a wired input, by its port. */
export interface QueryTable {
  port: number;
  /** The name of the node it comes from, as the designer shows it. */
  label: string;
  columns: ColumnSchema[];
}

export const QUERY_JOIN_TYPES: Record<QueryJoinKind, { label: string; hint: (left: string, right: string) => string }> = {
  inner: { label: 'Matching rows only', hint: () => 'Only rows where the joined fields are equal in both tables.' },
  left: { label: 'Every row of the first table', hint: (l, r) => `Every row of ${l}, and the rows of ${r} that match.` },
  right: { label: 'Every row of the second table', hint: (l, r) => `Every row of ${r}, and the rows of ${l} that match.` },
  full: { label: 'Every row of both tables', hint: () => 'Every row of both tables, matched up where they can be.' },
};

export const CRITERIA_OPS: Record<QueryCriteriaOp, { label: string; needsValue: boolean }> = {
  '=': { label: 'Equals', needsValue: true },
  '<>': { label: 'Isn’t', needsValue: true },
  '<': { label: 'Less than', needsValue: true },
  '<=': { label: 'At most', needsValue: true },
  '>': { label: 'More than', needsValue: true },
  '>=': { label: 'At least', needsValue: true },
  contains: { label: 'Contains', needsValue: true },
  starts: { label: 'Starts with', needsValue: true },
  ends: { label: 'Ends with', needsValue: true },
  empty: { label: 'Is empty', needsValue: false },
  notEmpty: { label: 'Isn’t empty', needsValue: false },
};

const COMPARE = new Set<QueryCriteriaOp>(['=', '<>', '<', '<=', '>', '>=']);

interface TotalInfo {
  label: string;
  /** Starts the name a summary gets unless renamed, as in Access: SumOfAmount. */
  prefix?: string;
  /** The summary over a column. */
  sql?: (col: string) => string;
  /** Only numbers can be summarised this way. */
  numeric?: boolean;
  /** The summary's type, when it isn't the column's own. */
  type?: string;
}

/** The Totals row's choices, in the order the grid offers them. */
export const TOTALS: Record<QueryTotal, TotalInfo> = {
  group: { label: 'Group by' },
  sum: { label: 'Sum', prefix: 'Sum', sql: (c) => `sum(${c})`, numeric: true },
  avg: { label: 'Average', prefix: 'Avg', sql: (c) => `avg(${c})`, numeric: true, type: 'DOUBLE' },
  min: { label: 'Min', prefix: 'Min', sql: (c) => `min(${c})` },
  max: { label: 'Max', prefix: 'Max', sql: (c) => `max(${c})` },
  count: { label: 'Count', prefix: 'Count', sql: (c) => `count(${c})`, type: 'BIGINT' },
  countDistinct: { label: 'Count distinct', prefix: 'CountDistinct', sql: (c) => `count(DISTINCT ${c})`, type: 'BIGINT' },
  first: { label: 'First', prefix: 'First', sql: (c) => `first(${c})` },
  last: { label: 'Last', prefix: 'Last', sql: (c) => `last(${c})` },
  stdev: { label: 'StDev', prefix: 'StDev', sql: (c) => `stddev_samp(${c})`, numeric: true, type: 'DOUBLE' },
  var: { label: 'Var', prefix: 'Var', sql: (c) => `var_samp(${c})`, numeric: true, type: 'DOUBLE' },
  expression: { label: 'Expression' },
  where: { label: 'Where' },
};

/** A field's Total: Group by unless chosen, and none while the Totals row is off. */
export const fieldTotal = (spec: Pick<QuerySpec, 'totals'>, f: Pick<QueryField, 'total'>): QueryTotal | undefined => (spec.totals ? (f.total ?? 'group') : undefined);

/**
 * Where a field's criteria go: WHERE filters rows, before any grouping; HAVING filters the groups, so it takes the
 * criteria on grouped and summarised fields. Without the Totals row everything is WHERE.
 */
export const criteriaPlace = (spec: Pick<QuerySpec, 'totals'>, f: Pick<QueryField, 'total'>): 'where' | 'having' => {
  const total = fieldTotal(spec, f);
  return !total || total === 'where' ? 'where' : 'having';
};

/** Whether the field is in the result: shown, and not a Where field (which only filters). */
const inResult = (spec: QuerySpec, f: QueryField) => f.show && fieldTotal(spec, f) !== 'where';

/**
 * The names fields get unless renamed, by field id: the column's own, or Access's for a summary (SumOfAmount) and
 * for an expression (Expr1, Expr2 in grid order).
 */
export function defaultNames(spec: QuerySpec): Map<string, string> {
  const names = new Map<string, string>();
  let expr = 0;
  for (const f of spec.fields) {
    const total = fieldTotal(spec, f);
    const prefix = total && TOTALS[total].prefix;
    names.set(f.id, total === 'expression' ? `Expr${++expr}` : prefix && f.column !== '*' ? `${prefix}Of${f.column}` : f.column);
  }
  return names;
}

export interface QueryProblem {
  message: string;
  /** The grid field it's about. */
  field?: string;
  /** The join line it's about. */
  join?: string;
  /** The input whose table it's about, so the canvas can mark that wire. */
  port?: number;
}

/** The table alias inside the query's SQL: "t1" for input 1. */
export const tableAlias = (port: number) => ident(`t${port + 1}`);

const fold = (name: string) => name.toLowerCase();
const isNumber = (value: string) => value.trim() !== '' && Number.isFinite(Number(value.trim()));

export interface QueryColumn {
  name: string;
  type: string;
  /** The grid field it comes from. */
  field: string;
  /** The select-list item that produces it. */
  sql: string;
}

/**
 * The query's output columns, in grid order: every shown field, with "*" opening out into all of its table's columns.
 * A field is named by its alias, or by its column; a name already used (DuckDB ignores case) is numbered: id, id_2.
 */
export function queryColumns(spec: QuerySpec, tables: QueryTable[]): QueryColumn[] {
  const taken = new Set<string>();
  const out: QueryColumn[] = [];
  const name = (wanted: string) => {
    let n = wanted;
    for (let k = 2; taken.has(fold(n)); k++) n = `${wanted}_${k}`;
    taken.add(fold(n));
    return n;
  };
  const defaults = defaultNames(spec);
  for (const f of spec.fields) {
    const table = tables.find((t) => t.port === f.port);
    if (!inResult(spec, f) || !table) continue;
    const cols = f.column === '*' ? table.columns : table.columns.filter((c) => c.name === f.column);
    for (const c of cols) {
      const as = name(f.column !== '*' && f.alias?.trim() ? f.alias.trim() : f.column === '*' ? c.name : defaults.get(f.id)!);
      const raw = `${tableAlias(f.port)}.${ident(c.name)}`;
      const sql = f.column === '*' ? raw : fieldTerm(spec, f);
      out.push({ name: as, type: resultType(spec, f, c.type), field: f.id, sql: as === c.name && sql === raw ? sql : `${sql} AS ${ident(as)}` });
    }
  }
  return out;
}

/** How one table joins the ones before it in the FROM clause. */
export interface QueryJoinStep {
  port: number;
  /** CROSS when no line joins this table to the ones before it: every row pairs with every row. */
  kind: 'INNER' | 'LEFT' | 'RIGHT' | 'FULL' | 'CROSS';
  lines: QueryJoin[];
}

/**
 * The order tables are joined in: the first table, then repeatedly the first table (by input) that a line joins to
 * those already in, with every line between them. A table no line reaches is cross joined, as Access does.
 */
export function joinPlan(spec: QuerySpec, ports: number[]): { first: number; steps: QueryJoinStep[] } | undefined {
  if (!ports.length) return undefined;
  const sorted = [...ports].sort((a, b) => a - b);
  const placed = new Set([sorted[0]!]);
  const rest = sorted.slice(1);
  const steps: QueryJoinStep[] = [];
  const valid = spec.joins.filter((j) => ports.includes(j.left.port) && ports.includes(j.right.port) && j.left.port !== j.right.port);
  while (rest.length) {
    const linesTo = (p: number) => valid.filter((j) => (j.left.port === p && placed.has(j.right.port)) || (j.right.port === p && placed.has(j.left.port)));
    const i = rest.findIndex((p) => linesTo(p).length);
    const port = rest.splice(i < 0 ? 0 : i, 1)[0]!;
    const lines = linesTo(port);
    let kind: QueryJoinStep['kind'] = 'CROSS';
    if (lines.length) {
      const first = lines[0]!;
      // Seen from the tables already joined: "every row of the left table" keeps their rows when they're the left end.
      const k = first.left.port === port ? (first.kind === 'left' ? 'right' : first.kind === 'right' ? 'left' : first.kind) : first.kind;
      kind = k === 'inner' ? 'INNER' : k === 'left' ? 'LEFT' : k === 'right' ? 'RIGHT' : 'FULL';
    }
    steps.push({ port, kind, lines });
    placed.add(port);
  }
  return { first: sorted[0]!, steps };
}

/** Tables no join line reaches, which pair every row with every row of the others. */
export const crossJoinedTables = (spec: QuerySpec, ports: number[]) => joinPlan(spec, ports)?.steps.filter((s) => s.kind === 'CROSS').map((s) => s.port) ?? [];

/**
 * What's wrong with a query given its tables (the wired inputs, with their columns): nothing in the grid, a field or
 * join line on a table or column that's gone, join lines whose types can't be compared, criteria that can't be
 * read, two fields given the same name, and with the Totals row on, totals that can't work (see totalsProblem).
 * Empty when it's ready to run.
 */
export function queryProblems(spec: QuerySpec, tables: QueryTable[]): QueryProblem[] {
  const problems: QueryProblem[] = [];
  const table = (port: number) => tables.find((t) => t.port === port);
  if (!spec.fields.length) problems.push({ message: 'Drag fields from the tables into the grid, or double-click them.' });
  else if (!spec.fields.some((f) => f.show)) problems.push({ message: 'Show at least one field: tick Show in the grid.' });

  for (const f of spec.fields) {
    const t = table(f.port);
    const label = f.column === '*' ? `${f.column} (input ${f.port + 1})` : f.column;
    if (!t) {
      problems.push({ field: f.id, message: `${label} comes from input ${f.port + 1}, which has no table now. Remove it from the grid.` });
      continue;
    }
    if (f.column === '*') {
      if (f.sort !== 'none' || f.criteria) problems.push({ field: f.id, port: f.port, message: `Sort and filter on a single field of ${t.label}, not *.` });
      else if (spec.totals) problems.push({ field: f.id, message: starTotals(t.label) });
      continue;
    }
    const col = t.columns.find((c) => c.name === f.column);
    if (!col) {
      problems.push({ field: f.id, port: f.port, message: `${f.column} isn’t in ${t.label} any more.` });
      continue;
    }
    const totalProblem = totalsProblem(spec, f, col);
    if (totalProblem) {
      problems.push({ field: f.id, message: totalProblem });
      continue;
    }
    const c = f.criteria;
    if (c && CRITERIA_OPS[c.op].needsValue) {
      const type = resultType(spec, f, col.type);
      const what = fieldTotal(spec, f) === 'expression' ? `the expression for ${f.column}` : f.column;
      // A summary is called by its name in the result: SumOftotal, or what it was renamed.
      const called = (spec.totals && f.alias?.trim()) || defaultNames(spec).get(f.id)!;
      if (!c.value.trim()) problems.push({ field: f.id, message: `Give ${what} a value to compare with.` });
      else if (COMPARE.has(c.op) && typeFamily(type) === 'number' && !isNumber(c.value)) problems.push({ field: f.id, message: `${called} is a number, so compare it with a number, not “${c.value}”.` });
    }
  }

  for (const j of spec.joins) {
    const [l, r] = [table(j.left.port), table(j.right.port)];
    if (!l || !r) {
      problems.push({ join: j.id, message: `A join line runs to input ${(l ? j.right : j.left).port + 1}, which has no table now. Remove the line.` });
      continue;
    }
    const lc = l.columns.find((c) => c.name === j.left.column);
    const rc = r.columns.find((c) => c.name === j.right.column);
    if (!lc) problems.push({ join: j.id, port: l.port, message: `${j.left.column} isn’t in ${l.label} any more. Remove the join line.` });
    if (!rc) problems.push({ join: j.id, port: r.port, message: `${j.right.column} isn’t in ${r.label} any more. Remove the join line.` });
    if (lc && rc && !typesFit(lc.type, rc.type))
      problems.push({ join: j.id, port: r.port, message: `${j.left.column} in ${l.label} is ${describeType(lc.type)} and ${j.right.column} in ${r.label} is ${describeType(rc.type)}; change one with Change type.` });
  }

  // An alias someone typed must be free; other names are numbered instead.
  const seen = new Set<string>();
  const defaults = defaultNames(spec);
  for (const f of spec.fields) {
    const t = table(f.port);
    if (!inResult(spec, f) || !t) continue;
    const names = f.column === '*' ? t.columns.map((c) => c.name) : [f.alias?.trim() || defaults.get(f.id)!];
    if (f.column !== '*' && f.alias?.trim() && seen.has(fold(f.alias.trim()))) problems.push({ field: f.id, message: `Two fields are called ${f.alias.trim()}. Give one of them another name.` });
    names.forEach((n) => seen.add(fold(n)));
  }

  if (spec.distinct && spec.fields.some((f) => !f.show && f.sort !== 'none'))
    problems.push({ message: 'A hidden field can’t sort unique values. Show it, or turn off Unique values.' });
  return problems;
}

const starTotals = (label: string) => `Totals work on single fields, not ${label}.*. Take it out of the grid, or drag in the fields to group or summarise.`;

/**
 * The problems queryProblems finds with the Totals row, for the designer to explain beside the grid. Fields on a
 * table or column it can't see are left to queryProblems.
 */
export function totalsProblems(spec: QuerySpec, tables: QueryTable[]): QueryProblem[] {
  if (!spec.totals) return [];
  return spec.fields.flatMap((f) => {
    const t = tables.find((x) => x.port === f.port);
    if (!t) return [];
    if (f.column === '*') return f.sort === 'none' && !f.criteria ? [{ field: f.id, message: starTotals(t.label) }] : [];
    const col = t.columns.find((c) => c.name === f.column);
    const message = col && totalsProblem(spec, f, col);
    return message ? [{ field: f.id, message }] : [];
  });
}

/**
 * What's wrong with a field's Total, when the grid has its Totals row: a sum or average of something that isn't a
 * number, an expression that's missing or can't be read, or a Where field that shows, sorts or has no criteria.
 */
function totalsProblem(spec: QuerySpec, f: QueryField, col: ColumnSchema): string | undefined {
  const total = fieldTotal(spec, f);
  if (!total) return undefined;
  const info = TOTALS[total];
  if (info.numeric && !['number', 'null'].includes(typeFamily(col.type)))
    return `${info.label} needs numbers, and ${f.column} is ${describeType(col.type)}. Pick Count, Min or Max for it, or change its type with Change type.`;
  if (total === 'expression') {
    const expr = f.expression?.trim() ?? '';
    if (!expr) return `Write the expression for ${f.column}, such as sum(${f.column}), or pick another Total.`;
    const problem = expressionProblem(expr);
    if (problem) return `The expression for ${f.column} can’t be read: ${problem}.`;
  }
  if (total === 'where') {
    if (f.show) return `${f.column} is a Where field: it filters rows before they’re grouped, so it can’t show. Turn off its Show, or pick another Total.`;
    if (!f.criteria) return `${f.column} is a Where field, so give it criteria to filter on, or pick another Total.`;
    if (f.sort !== 'none') return `${f.column} is a Where field, so the grouped result has no ${f.column} to sort on. Turn off its sort.`;
  }
  return undefined;
}

/** A criterion as a SQL condition on a column of a known type. */
function criterionSql(col: string, type: string, c: QueryCriteria): string {
  const v = c.value.trim();
  const text = `lower(CAST(${col} AS VARCHAR))`;
  switch (c.op) {
    case 'contains':
      return `contains(${text}, lower(${str(v)}))`;
    case 'starts':
      return `starts_with(${text}, lower(${str(v)}))`;
    case 'ends':
      return `suffix(${text}, lower(${str(v)}))`;
    case 'empty':
      return `(${col} IS NULL OR trim(CAST(${col} AS VARCHAR)) = '')`;
    case 'notEmpty':
      return `(${col} IS NOT NULL AND trim(CAST(${col} AS VARCHAR)) <> '')`;
    default: {
      // An expression's type isn't known: a number is compared as one.
      const literal = (typeFamily(type) === 'number' || type === '') && isNumber(v) ? num(Number(v)) : str(v);
      return `${col} ${c.op} ${literal}`;
    }
  }
}

const fieldSql = (f: Pick<QueryField, 'port' | 'column'>) => `${tableAlias(f.port)}.${ident(f.column)}`;

/**
 * What a field stands for in the SELECT, its criteria and its sort: its column, the summary of it, or its expression.
 */
export function fieldTerm(spec: Pick<QuerySpec, 'totals'>, f: QueryField): string {
  const total = fieldTotal(spec, f);
  if (total === 'expression') return `(${f.expression?.trim() ?? ''})`;
  const summary = total && TOTALS[total].sql;
  return summary ? summary(fieldSql(f)) : fieldSql(f);
}

/** The type of what a field stands for, given its column's type; empty for an expression, whose type isn't known. */
export function resultType(spec: Pick<QuerySpec, 'totals'>, f: Pick<QueryField, 'total'>, columnType: string): string {
  const total = fieldTotal(spec, f);
  if (total === 'expression') return '';
  return (total && TOTALS[total].type) ?? columnType;
}

/** The query as one SELECT over its tables' CTEs. Assumes queryProblems found nothing. */
export function compileQuery(spec: QuerySpec, tables: Array<QueryTable & { cte: string }>): string {
  const plan = joinPlan(spec, tables.map((t) => t.port))!;
  const cte = (port: number) => tables.find((t) => t.port === port)!.cte;
  const from = [`${cte(plan.first)} AS ${tableAlias(plan.first)}`];
  for (const s of plan.steps) {
    const rel = `${cte(s.port)} AS ${tableAlias(s.port)}`;
    if (s.kind === 'CROSS') from.push(`CROSS JOIN ${rel}`);
    else from.push(`${s.kind} JOIN ${rel} ON ${s.lines.map((j) => `${fieldSql(j.left)} = ${fieldSql(j.right)}`).join(' AND ')}`);
  }
  const type = (f: QueryField) => resultType(spec, f, tables.find((t) => t.port === f.port)!.columns.find((c) => c.name === f.column)!.type);
  const single = spec.fields.filter((f) => f.column !== '*');
  const criteria = (place: 'where' | 'having') => single.filter((f) => f.criteria && criteriaPlace(spec, f) === place).map((f) => criterionSql(fieldTerm(spec, f), type(f), f.criteria!));
  const [where, having] = [criteria('where'), criteria('having')];
  // Every Group by field groups, shown or not, as in Access.
  const group = [...new Set(single.filter((f) => fieldTotal(spec, f) === 'group').map(fieldSql))];
  // The sort applies to the grouped result, so it's on what each field stands for there.
  const order = single.filter((f) => f.sort !== 'none').map((f) => `${fieldTerm(spec, f)} ${f.sort === 'asc' ? 'ASC' : 'DESC'}`);
  const columns = queryColumns(spec, tables).map((c) => c.sql);
  return [
    `SELECT ${spec.distinct ? 'DISTINCT ' : ''}${columns.join(', ')}`,
    `FROM ${from.join(' ')}`,
    ...(where.length ? [`WHERE ${where.join(' AND ')}`] : []),
    ...(group.length ? [`GROUP BY ${group.join(', ')}`] : []),
    ...(having.length ? [`HAVING ${having.join(' AND ')}`] : []),
    ...(order.length ? [`ORDER BY ${order.join(', ')}`] : []),
  ].join(' ');
}
