// A Schema table node's rows: its table in DuckDB (built from the project's DBML with its records, see ddl/duckdb.ts),
// its `[example]` records when the node shows them, and the rows wired into it, each cast to the designed type. And
// the check that a load keeps every constraint, so a bad row stops the node before anything downstream reads it.
import { enumOf, parseDbml, qualified, type Column, type DbmlSchema, type Table } from '../schema';
import type { ColumnSchema, TableSpec } from '../model';
import { defaultSql, duckdbType, foreignKey, primaryKey, recordsOf, schemaTableRef, uniqueKeys } from './ddl/duckdb';
import { CompileError } from './errors';
import { ident, num, str } from './sql';

/** The failing-rows target of a Schema table node: its loaded rows that break a constraint, with why. */
export const LOAD_FAILURES = '__puddle_load_failures';

/** The column failing rows carry, saying what each breaks. */
export const FAILURE_COLUMN = 'Why it can’t load';

let parsed: { text: string; schema: DbmlSchema } | undefined;

/** The project's DBML, parsed once per version of the text. */
export function projectSchema(dbml: string): DbmlSchema {
  if (parsed?.text !== dbml) parsed = { text: dbml, schema: parseDbml(dbml).schema };
  return parsed.schema;
}

/** The table a node is for, or why it can't be read. */
export function tableFor(schema: DbmlSchema, spec: Pick<TableSpec, 'schema' | 'table'>, nodeName: string): Table {
  if (!spec.table) throw new CompileError(`${nodeName} has no table chosen. Choose one of the schema’s tables.`);
  const t = schema.tables.find((x) => x.schema === spec.schema && x.name === spec.table);
  if (!t) throw new CompileError(`The schema has no table ${qualified(spec.schema, spec.table)} any more. Choose another table, or add it to the DBML again.`);
  return t;
}

/** How one column of the table is filled from a load: from an input column, or its default (else empty). */
export interface LoadColumn {
  column: Column;
  type: string;
  /** The input column it is read from; absent when none matches and none is mapped. */
  source?: string;
}

/**
 * Which input column fills each table column: the one mapped to it, else the one with its name (exactly, then
 * ignoring case). A mapping of '' leaves a column to its default.
 */
export function loadColumns(schema: DbmlSchema, table: Table, spec: Pick<TableSpec, 'mapping'>, input: string[]): LoadColumn[] {
  return table.columns.map((column) => {
    const type = duckdbType(column.type, schema).sql;
    const mapped = spec.mapping[column.name];
    if (mapped != null) return { column, type, source: mapped && input.includes(mapped) ? mapped : undefined };
    const exact = input.find((c) => c === column.name) ?? input.find((c) => c.toLowerCase() === column.name.toLowerCase());
    return { column, type, source: exact };
  });
}

const cast = (expr: string, type: string) => `CAST(${expr} AS ${type})`;

/** The table's own rows and, when shown, its example records, as one relation with the table's columns. */
export function heldTableRows(schema: DbmlSchema, table: Table, examples: boolean): string {
  const cols = table.columns.map((c) => ident(c.name)).join(', ');
  const parts = [`SELECT ${cols} FROM ${schemaTableRef(table.schema, table.name)}`];
  const ex = examples ? recordsOf(schema, table, true) : undefined;
  if (ex) {
    const names = ex.columns.map((_, i) => ident(`c${i}`));
    const select = table.columns.map((c) => {
      const i = ex.columns.indexOf(c.name);
      const type = duckdbType(c.type, schema).sql;
      return `${i < 0 ? (c.default && !c.increment ? cast(defaultSql(c.default), type) : cast('NULL', type)) : cast(names[i]!, type)} AS ${ident(c.name)}`;
    });
    parts.push(`SELECT ${select.join(', ')} FROM (VALUES ${ex.values.join(', ')}) AS ${ident('examples')}(${names.join(', ')})`);
  }
  return parts.join(' UNION ALL ');
}

/** A loaded row's value for each table column: the input's, cast to the designed type, or the column's default. */
function loadedSelect(columns: LoadColumn[], held: string): string[] {
  return columns.map(({ column, type, source }) => {
    let value: string;
    if (source != null) value = `TRY_CAST(${ident(source)} AS ${type})`;
    else if (column.increment) value = `(SELECT coalesce(max(${ident(column.name)}), 0) FROM (${held})) + row_number() OVER ()`;
    else if (column.default) value = cast(defaultSql(column.default), type);
    else value = cast('NULL', type);
    return `${value} AS ${ident(column.name)}`;
  });
}

export interface TableInput {
  /** The CTE of the node wired in. */
  cte: string;
  columns: ColumnSchema[];
}

/** The rows of a Schema table node, with or without a load. */
export function compileSchemaTable(schema: DbmlSchema, table: Table, spec: TableSpec, input?: TableInput): string {
  const held = heldTableRows(schema, table, spec.examples);
  if (!input) return held;
  const columns = loadColumns(schema, table, spec, input.columns.map((c) => c.name));
  return `${held} UNION ALL SELECT ${loadedSelect(columns, held).join(', ')} FROM ${input.cte}`;
}

/** One thing a load is checked for. */
export interface LoadCheck {
  kind: 'type' | 'missing' | 'unique' | 'check' | 'ref';
  /** True for a row that breaks it, over the checked rows. */
  predicate: string;
  /** "have a total that isn’t decimal(10,2)": what failing rows do, after "3 rows". */
  says: string;
}

/** Where the rows a foreign key points at are: the parent's own table node(s), or its table in DuckDB. */
export type ParentRows = (parent: Table) => string;

export interface LoadQuery {
  /** The CTEs after the input's: `__puddle_flagged` holds each loaded row with its raw input values. */
  ctes: string[];
  checks: LoadCheck[];
}

const RAW = (i: number) => ident(`__puddle_raw${i}`);
const ROW = ident('__puddle_row');
const INPUT = ident('__puddle_input');
const INPUT_ROW = ident('__puddle_i');

/** Everything a load is checked for, over a CTE of the loaded rows marked against the rows already held. */
export function loadChecks(schema: DbmlSchema, table: Table, spec: TableSpec, input: TableInput, parentRows: ParentRows): LoadQuery {
  const columns = loadColumns(schema, table, spec, input.columns.map((c) => c.name));
  const held = heldTableRows(schema, table, spec.examples);
  const cols = table.columns.map((c) => ident(c.name));
  const keys = uniqueKeys(table);
  const pk = primaryKey(table);
  const loaded = ident('__puddle_loaded');
  const all = ident('__puddle_all');
  const flagged = ident('__puddle_flagged');
  const raws = columns.map((c, i) => (c.source != null ? `${INPUT_ROW}.${ident(c.source)} AS ${RAW(i)}` : `NULL AS ${RAW(i)}`));
  const ctes = [
    // Materialised, so each row keeps one number however often it is read; the input row rides along, whole.
    `${loaded} AS MATERIALIZED (SELECT ${loadedSelect(columns, held).join(', ')}, ${raws.join(', ')}, row_number() OVER () AS ${ROW}, ${INPUT_ROW} AS ${INPUT} FROM ${input.cte} ${INPUT_ROW})`,
    `${all} AS (SELECT ${cols.join(', ')}, NULL::BIGINT AS ${ROW} FROM (${held}) UNION ALL SELECT ${cols.join(', ')}, ${ROW} FROM ${loaded})`,
    `${flagged} AS (SELECT l.*, ${keys.length ? keys.map((_, i) => `d.${ident(`__puddle_dup${i}`)}`).join(', ') : '1 AS __puddle_none'} FROM ${loaded} l JOIN (SELECT ${ROW}${keys.map((k, i) => `, count(*) OVER (PARTITION BY ${k.map(ident).join(', ')}) AS ${ident(`__puddle_dup${i}`)}`).join('')} FROM ${all}) d USING (${ROW}))`,
  ];
  const checks: LoadCheck[] = [];
  columns.forEach((c, i) => {
    if (c.source == null) return;
    const e = enumOf(schema, c.column);
    checks.push({ kind: 'type', predicate: `${RAW(i)} IS NOT NULL AND ${ident(c.column.name)} IS NULL`, says: e ? `a ${c.column.name} that isn’t one of ${e.name}’s values` : `a ${c.column.name} that isn’t ${c.column.type}` });
  });
  columns.forEach((c, i) => {
    if (!(c.column.notNull || pk.includes(c.column.name))) return;
    checks.push({ kind: 'missing', predicate: `${ident(c.column.name)} IS NULL AND ${RAW(i)} IS NULL`, says: `no ${c.column.name}` });
  });
  keys.forEach((k, i) => {
    const label = k.length === 1 ? k[0]! : `(${k.join(', ')})`;
    checks.push({ kind: 'unique', predicate: `${k.map((c) => `${ident(c)} IS NOT NULL`).join(' AND ')} AND ${ident(`__puddle_dup${i}`)} > 1`, says: `a ${label} that is already in the table or repeated` });
  });
  for (const c of table.columns) for (const expr of c.checks) checks.push({ kind: 'check', predicate: `NOT coalesce((${expr}), true)`, says: `a ${c.name} that breaks the check ${expr}` });
  for (const ck of table.checks) checks.push({ kind: 'check', predicate: `NOT coalesce((${ck.expression}), true)`, says: `values that break the check ${ck.name ?? ck.expression}` });
  for (const ref of schema.refs) {
    const fk = foreignKey(ref);
    if (!fk || fk.child.schema !== table.schema || fk.child.table !== table.name) continue;
    const parent = schema.tables.find((t) => t.schema === fk.parent.schema && t.name === fk.parent.table);
    if (!parent) continue;
    const rows = parent === table ? `(SELECT ${cols.join(', ')} FROM ${all})` : parentRows(parent);
    const match = fk.child.columns.map((c, i) => `p.${ident(fk.parent.columns[i] ?? c)} = f.${ident(c)}`).join(' AND ');
    const label = fk.child.columns.length === 1 ? fk.child.columns[0]! : `(${fk.child.columns.join(', ')})`;
    checks.push({
      kind: 'ref',
      predicate: `${fk.child.columns.map((c) => `f.${ident(c)} IS NOT NULL`).join(' AND ')} AND NOT EXISTS (SELECT 1 FROM ${rows} p WHERE ${match})`,
      says: `a ${label} that isn’t in ${qualified(parent.schema, parent.name)}`,
    });
  }
  return { ctes, checks };
}

/** One row: `f<i>` loaded rows failing the i-th check. */
export function failureCounts(checks: LoadCheck[]): string {
  if (!checks.length) return `SELECT 0 AS ${ident('__puddle_none')}`;
  return `SELECT ${checks.map((c, i) => `count(*) FILTER (WHERE ${c.predicate}) AS ${ident(`f${i}`)}`).join(', ')} FROM ${ident('__puddle_flagged')} f`;
}

/** The loaded rows that fail, as they arrived, each with everything it breaks. */
export function failingRows(checks: LoadCheck[]): string {
  const why = ident('__puddle_why');
  const whys = checks.map((c) => `CASE WHEN ${c.predicate} THEN ${str(c.says)} END`);
  const reasons = whys.length ? `concat_ws('; ', ${whys.join(', ')})` : `''`;
  return `SELECT ${why} AS ${ident(FAILURE_COLUMN)}, unnest(${INPUT}) FROM (SELECT ${ROW}, ${INPUT}, ${reasons} AS ${why} FROM ${ident('__puddle_flagged')} f) WHERE ${why} <> '' ORDER BY ${ROW}`;
}

/** "3 rows have no email". */
export function describeFailure(check: Pick<LoadCheck, 'says'>, n: number): string {
  return `${num(n)} ${n === 1 ? 'row has' : 'rows have'} ${check.says}`;
}
