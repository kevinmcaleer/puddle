// Query nodes, built in the query designer: tables joined by the lines drawn between their columns, then the grid's
// fields, criteria and sorting, as one SELECT.
import type { ColumnSchema, QueryCriteria, QueryCriteriaOp, QueryField, QueryJoin, QueryJoinKind, QuerySpec } from '../model';
import { ident, num, str } from './sql';
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
  for (const f of spec.fields) {
    const table = tables.find((t) => t.port === f.port);
    if (!f.show || !table) continue;
    const cols = f.column === '*' ? table.columns : table.columns.filter((c) => c.name === f.column);
    for (const c of cols) {
      const as = name(f.column !== '*' && f.alias?.trim() ? f.alias.trim() : c.name);
      const sql = `${tableAlias(f.port)}.${ident(c.name)}`;
      out.push({ name: as, type: c.type, field: f.id, sql: as === c.name ? sql : `${sql} AS ${ident(as)}` });
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
 * read, two fields given the same name. Empty when it's ready to run.
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
      continue;
    }
    const col = t.columns.find((c) => c.name === f.column);
    if (!col) {
      problems.push({ field: f.id, port: f.port, message: `${f.column} isn’t in ${t.label} any more.` });
      continue;
    }
    const c = f.criteria;
    if (c && CRITERIA_OPS[c.op].needsValue) {
      if (!c.value.trim()) problems.push({ field: f.id, message: `Give ${f.column} a value to compare with.` });
      else if (COMPARE.has(c.op) && typeFamily(col.type) === 'number' && !isNumber(c.value)) problems.push({ field: f.id, message: `${f.column} is a number, so compare it with a number, not “${c.value}”.` });
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
  for (const f of spec.fields) {
    const t = table(f.port);
    if (!f.show || !t) continue;
    const names = f.column === '*' ? t.columns.map((c) => c.name) : [f.alias?.trim() || f.column];
    if (f.column !== '*' && f.alias?.trim() && seen.has(fold(f.alias.trim()))) problems.push({ field: f.id, message: `Two fields are called ${f.alias.trim()}. Give one of them another name.` });
    names.forEach((n) => seen.add(fold(n)));
  }

  if (spec.distinct && spec.fields.some((f) => !f.show && f.sort !== 'none'))
    problems.push({ message: 'A hidden field can’t sort unique values. Show it, or turn off Unique values.' });
  return problems;
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
      const literal = typeFamily(type) === 'number' && isNumber(v) ? num(Number(v)) : str(v);
      return `${col} ${c.op} ${literal}`;
    }
  }
}

const fieldSql = (f: Pick<QueryField, 'port' | 'column'>) => `${tableAlias(f.port)}.${ident(f.column)}`;

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
  const type = (f: QueryField) => tables.find((t) => t.port === f.port)!.columns.find((c) => c.name === f.column)!.type;
  const where = spec.fields.filter((f) => f.criteria && f.column !== '*').map((f) => criterionSql(fieldSql(f), type(f), f.criteria!));
  const order = spec.fields.filter((f) => f.sort !== 'none' && f.column !== '*').map((f) => `${fieldSql(f)} ${f.sort === 'asc' ? 'ASC' : 'DESC'}`);
  const columns = queryColumns(spec, tables).map((c) => c.sql);
  return [
    `SELECT ${spec.distinct ? 'DISTINCT ' : ''}${columns.join(', ')}`,
    `FROM ${from.join(' ')}`,
    ...(where.length ? [`WHERE ${where.join(' AND ')}`] : []),
    ...(order.length ? [`ORDER BY ${order.join(', ')}`] : []),
  ].join(' ');
}
