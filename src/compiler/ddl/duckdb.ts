// A DBML schema as DuckDB DDL: one statement per schema, enum type, sequence, table, index and records block, in an
// order DuckDB accepts (parents before the tables whose foreign keys point at them). Each DBML schema becomes a DuckDB
// schema with a prefix (`public` is `dbml_public`), so the tables can be dropped and rebuilt without touching anything
// else and never clash with Puddle's own tables. (An attached database would be tidier, but DuckDB refuses foreign
// keys outside the default one.) What DuckDB can't do is left out, with a warning naming the table.
import { enumOf, qualified, type Column, type DbmlSchema, type Default, type Ref, type RecordValue, type Table } from '../../schema';
import { ident, str } from '../sql';

/** The DuckDB schema a DBML schema's tables are created in. */
export const duckdbSchema = (schema: string) => `dbml_${schema}`;

/** A table's name in DuckDB: schema and table, quoted. */
export const schemaTableRef = (schema: string, table: string) => `${ident(duckdbSchema(schema))}.${ident(table)}`;

/** Drop a DBML schema's DuckDB schema and everything in it. */
export const dropDuckdbSchema = (schema: string) => `DROP SCHEMA IF EXISTS ${ident(duckdbSchema(schema))} CASCADE`;

/** Something DuckDB couldn't be given as written, and what was done instead. */
export interface DdlWarning {
  /** `schema.table`, or the enum's name. */
  element: string;
  message: string;
}

export interface DuckdbType {
  sql: string;
  /** Set when the type isn't one DuckDB knows: it is created as VARCHAR. */
  unknown?: boolean;
}

const SIMPLE: Record<string, string> = {
  varchar: 'VARCHAR', 'character varying': 'VARCHAR', char: 'VARCHAR', character: 'VARCHAR', nchar: 'VARCHAR', nvarchar: 'VARCHAR', text: 'VARCHAR', string: 'VARCHAR', citext: 'VARCHAR', tinytext: 'VARCHAR', mediumtext: 'VARCHAR', longtext: 'VARCHAR', ntext: 'VARCHAR', clob: 'VARCHAR', enum: 'VARCHAR',
  // DuckDB-WASM has no json extension built in, so JSON is kept as text.
  json: 'VARCHAR', jsonb: 'VARCHAR', xml: 'VARCHAR',
  tinyint: 'TINYINT', int1: 'TINYINT', smallint: 'SMALLINT', int2: 'SMALLINT', smallserial: 'SMALLINT', serial2: 'SMALLINT',
  int: 'INTEGER', integer: 'INTEGER', int4: 'INTEGER', mediumint: 'INTEGER', serial: 'INTEGER', serial4: 'INTEGER',
  bigint: 'BIGINT', int8: 'BIGINT', bigserial: 'BIGINT', serial8: 'BIGINT', long: 'BIGINT', hugeint: 'HUGEINT',
  utinyint: 'UTINYINT', usmallint: 'USMALLINT', uinteger: 'UINTEGER', ubigint: 'UBIGINT',
  float: 'FLOAT', float4: 'FLOAT', real: 'FLOAT', double: 'DOUBLE', float8: 'DOUBLE', 'double precision': 'DOUBLE',
  money: 'DECIMAL(19,4)', smallmoney: 'DECIMAL(10,4)',
  bool: 'BOOLEAN', boolean: 'BOOLEAN', bit: 'BOOLEAN', logical: 'BOOLEAN',
  date: 'DATE', time: 'TIME', 'time without time zone': 'TIME', timetz: 'TIMETZ', 'time with time zone': 'TIMETZ',
  timestamp: 'TIMESTAMP', datetime: 'TIMESTAMP', datetime2: 'TIMESTAMP', smalldatetime: 'TIMESTAMP', 'timestamp without time zone': 'TIMESTAMP',
  timestamptz: 'TIMESTAMPTZ', 'timestamp with time zone': 'TIMESTAMPTZ', datetimeoffset: 'TIMESTAMPTZ',
  interval: 'INTERVAL', uuid: 'UUID', uniqueidentifier: 'UUID',
  blob: 'BLOB', bytea: 'BLOB', binary: 'BLOB', varbinary: 'BLOB', longblob: 'BLOB', mediumblob: 'BLOB', tinyblob: 'BLOB', image: 'BLOB',
};

const DECIMAL = new Set(['decimal', 'numeric', 'number', 'dec']);
const TIMESTAMPS = new Set(['timestamp', 'datetime', 'datetime2', 'time', 'timestamptz', 'timetz']);

/** A DBML column type as a DuckDB type: sizes dropped where DuckDB has none, decimals kept, arrays kept, enums named. */
export function duckdbType(type: string, schema?: DbmlSchema): DuckdbType {
  const t = type.trim();
  const array = /^(.*?)((?:\[\d*\])+)$/.exec(t);
  if (array) {
    const inner = duckdbType(array[1]!, schema);
    return { sql: inner.sql + array[2]!.replace(/\d+/g, ''), unknown: inner.unknown };
  }
  if (schema) {
    const e = enumOf(schema, { type: t });
    if (e) return { sql: `${ident(duckdbSchema(e.schema))}.${ident(e.name)}` };
  }
  const m = /^([a-z_][a-z0-9_ ]*?)\s*(?:\(\s*([^)]*)\))?(?:\s+(with(?:out)? time zone))?$/i.exec(t);
  if (!m) return { sql: 'VARCHAR', unknown: true };
  let base = m[1]!.toLowerCase().replace(/\s+/g, ' ');
  // MySQL's `int unsigned` and friends.
  const unsigned = / unsigned$/.test(base);
  if (unsigned) base = base.slice(0, -' unsigned'.length);
  const u = { tinyint: 'UTINYINT', smallint: 'USMALLINT', int: 'UINTEGER', integer: 'UINTEGER', mediumint: 'UINTEGER', bigint: 'UBIGINT' }[base];
  if (unsigned && u) return { sql: u };
  const args = m[2]?.split(',').map((a) => a.trim());
  const zone = m[3]?.toLowerCase();
  if (zone && TIMESTAMPS.has(base)) return { sql: SIMPLE[`${base === 'timestamptz' || base === 'timetz' ? base.slice(0, -2) : base} ${zone}`] ?? 'TIMESTAMP' };
  if (DECIMAL.has(base)) {
    const [p, s] = (args ?? []).map(Number);
    if (p != null && Number.isInteger(p) && p >= 1 && p <= 38) return { sql: `DECIMAL(${p},${s != null && Number.isInteger(s) && s >= 0 && s <= p ? s : 0})` };
    return { sql: 'DECIMAL(18,3)' };
  }
  if (base === 'float' && args?.[0] && Number(args[0]) > 24) return { sql: 'DOUBLE' };
  const simple = SIMPLE[base];
  return simple ? { sql: simple } : { sql: 'VARCHAR', unknown: true };
}

/** A default as SQL: literals quoted, backtick expressions as written. */
export function defaultSql(d: Default): string {
  switch (d.kind) {
    case 'string':
      return str(d.value);
    case 'expression':
      return `(${d.value})`;
    case 'null':
      return 'NULL';
    case 'boolean':
      return d.value.toLowerCase() === 'true' ? 'true' : 'false';
    case 'number':
      return /^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i.test(d.value) ? d.value : str(d.value);
  }
}

/** A value in a records row as SQL. Enum values (`status.active`) are their last part, as text. */
export function recordValueSql(v: RecordValue): string {
  switch (v.kind) {
    case 'string':
      return str(v.value);
    case 'number':
      return /^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i.test(v.value) ? v.value : str(v.value);
    case 'boolean':
      return v.value.toLowerCase() === 'true' ? 'true' : 'false';
    case 'null':
    case 'empty':
      return 'NULL';
    case 'expression':
      return `(${v.value})`;
    case 'enum':
      return str(v.value.split('.').pop()!);
  }
}

const name = (t: { schema: string; name: string }) => qualified(t.schema, t.name);
const sequenceName = (t: Table, c: Column) => `${t.name}_${c.name}_seq`;

/** The columns of a table's primary key: from its columns' `pk`, or an `indexes { (a, b) [pk] }`. */
export function primaryKey(t: Table): string[] {
  const own = t.columns.filter((c) => c.pk).map((c) => c.name);
  if (own.length) return own;
  const ix = t.indexes.find((i) => i.pk && i.parts.every((p) => p.kind === 'column'));
  return ix ? ix.parts.map((p) => p.value) : [];
}

/** Column sets the table keeps unique: its key, unique columns and unique column indexes. */
export function uniqueKeys(t: Table): string[][] {
  const keys: string[][] = [];
  const pk = primaryKey(t);
  if (pk.length) keys.push(pk);
  for (const c of t.columns) if (c.unique && !(pk.length === 1 && pk[0] === c.name)) keys.push([c.name]);
  for (const ix of t.indexes) if (ix.unique && !ix.pk && ix.parts.every((p) => p.kind === 'column')) keys.push(ix.parts.map((p) => p.value));
  return keys;
}

const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every((x) => b.includes(x));

/** A ref as a foreign key: the child (the many side, or `from` of a one-to-one) and the parent it points at. */
export function foreignKey(ref: Ref): { child: Ref['from']; parent: Ref['to'] } | null {
  if (ref.inactive || ref.op === '<>') return null;
  if (ref.op === '<') return { child: ref.to, parent: ref.from };
  return { child: ref.from, parent: ref.to };
}

/** What creating one table takes. */
export interface TableDdl {
  /** `schema.table`, or the name alone in the public schema. */
  name: string;
  schema: string;
  table: string;
  /** Sequences its increment columns draw from, created first. */
  sequences: string[];
  create: string;
  /**
   * The same table without the defaults and checks written as expressions, for when DuckDB refuses one of those
   * (they are written for the database the schema was designed for). Absent when the table has none.
   */
  plain?: string;
  indexes: string[];
  /** Its records, unless they are only examples. */
  insert?: string;
}

export interface SchemaDdl {
  /** The DuckDB schemas, then the enum types. */
  setup: string[];
  /** Each table, parents before the tables that refer to them. */
  tables: TableDdl[];
  warnings: DdlWarning[];
  /** Everything, in order: setup, each table with its sequences and indexes, then every table's records. */
  statements: string[];
}

/** The statements that create a schema's enums, tables, keys, indexes and records in DuckDB. */
export function schemaDdl(schema: DbmlSchema): SchemaDdl {
  const warnings: DdlWarning[] = [];
  const setup: string[] = [];
  const tableKey = (s: string, t: string) => `${s}.${t}`;
  const byKey = new Map(schema.tables.map((t) => [tableKey(t.schema, t.name), t]));
  // Foreign keys DuckDB will take: the parent's columns must be its key or unique, and it must be another table.
  const fks = new Map<string, { columns: string[]; parent: Table; parentColumns: string[] }[]>();
  for (const ref of schema.refs) {
    const fk = foreignKey(ref);
    if (!fk) continue;
    const child = byKey.get(tableKey(fk.child.schema, fk.child.table));
    const parent = byKey.get(tableKey(fk.parent.schema, fk.parent.table));
    if (!child || !parent) continue;
    if (child === parent) {
      warnings.push({ element: name(child), message: `The ref from ${name(child)} to itself isn’t created as a foreign key: DuckDB can’t check a table against itself. It is still checked when rows are loaded.` });
      continue;
    }
    if (child.schema !== parent.schema) {
      warnings.push({ element: name(child), message: `The ref from ${name(child)} to ${name(parent)} isn’t created as a foreign key: DuckDB can’t have one between schemas. It is still checked when rows are loaded.` });
      continue;
    }
    if (!uniqueKeys(parent).some((k) => sameSet(k, fk.parent.columns))) {
      warnings.push({ element: name(child), message: `The ref from ${name(child)} to ${name(parent)}.${fk.parent.columns.join(', ')} isn’t created as a foreign key: those columns aren’t the key of ${name(parent)} or unique.` });
      continue;
    }
    const list = fks.get(tableKey(child.schema, child.name)) ?? [];
    if (list.some((x) => x.parent === parent && sameSet(x.columns, fk.child.columns))) continue;
    list.push({ columns: fk.child.columns, parent, parentColumns: fk.parent.columns });
    fks.set(tableKey(child.schema, child.name), list);
  }

  // Parents first; a foreign key that would close a loop is left out.
  const order: Table[] = [];
  const state = new Map<Table, 'visiting' | 'done'>();
  const visit = (t: Table) => {
    if (state.get(t) === 'done') return;
    state.set(t, 'visiting');
    const own = fks.get(tableKey(t.schema, t.name)) ?? [];
    for (const fk of [...own]) {
      if (state.get(fk.parent) === 'visiting') {
        own.splice(own.indexOf(fk), 1);
        warnings.push({ element: name(t), message: `The ref from ${name(t)} to ${name(fk.parent)} isn’t created as a foreign key: the tables refer to each other in a loop.` });
        continue;
      }
      visit(fk.parent);
    }
    state.set(t, 'done');
    order.push(t);
  };
  schema.tables.forEach(visit);

  for (const s of new Set([...schema.tables.map((t) => t.schema), ...schema.enums.map((e) => e.schema)])) setup.push(`CREATE SCHEMA IF NOT EXISTS ${ident(duckdbSchema(s))}`);
  for (const e of schema.enums) setup.push(`CREATE TYPE ${ident(duckdbSchema(e.schema))}.${ident(e.name)} AS ENUM (${e.values.map((v) => str(v.name)).join(', ')})`);

  const tables: TableDdl[] = order.map((t) => {
    const pk = primaryKey(t);
    const sequences: string[] = [];
    const columns = (plain: boolean) =>
      t.columns.map((c) => {
        const type = duckdbType(c.type, schema);
        const parts = [ident(c.name), type.sql];
        if (c.increment) {
          const seq = `${ident(duckdbSchema(t.schema))}.${ident(sequenceName(t, c))}`;
          if (!plain) sequences.push(`CREATE SEQUENCE IF NOT EXISTS ${seq}`);
          parts.push(`DEFAULT nextval(${str(seq)})`);
        } else if (c.default && !(plain && c.default.kind === 'expression')) parts.push(`DEFAULT ${defaultSql(c.default)}`);
        if (c.notNull && !pk.includes(c.name)) parts.push('NOT NULL');
        if (!plain) for (const check of c.checks) parts.push(`CHECK (${check})`);
        return parts.join(' ');
      });
    const constraints = (plain: boolean) => {
      const lines: string[] = [];
      if (pk.length) lines.push(`PRIMARY KEY (${pk.map(ident).join(', ')})`);
      // The first unique key is the primary key, when there is one.
      for (const key of uniqueKeys(t).slice(pk.length ? 1 : 0)) lines.push(`UNIQUE (${key.map(ident).join(', ')})`);
      if (!plain) for (const check of t.checks) lines.push(`${check.name ? `CONSTRAINT ${ident(check.name)} ` : ''}CHECK (${check.expression})`);
      for (const fk of fks.get(tableKey(t.schema, t.name)) ?? []) lines.push(`FOREIGN KEY (${fk.columns.map(ident).join(', ')}) REFERENCES ${schemaTableRef(fk.parent.schema, fk.parent.name)} (${fk.parentColumns.map(ident).join(', ')})`);
      return lines;
    };
    const create = (plain: boolean) => `CREATE TABLE ${schemaTableRef(t.schema, t.name)} (\n  ${[...columns(plain), ...constraints(plain)].join(',\n  ')}\n)`;
    for (const c of t.columns) if (duckdbType(c.type, schema).unknown) warnings.push({ element: name(t), message: `${name(t)}.${c.name} has the type ${c.type}, which DuckDB doesn’t know, so it is created as text.` });
    const hasExpressions = t.checks.length > 0 || t.columns.some((c) => c.checks.length > 0 || (!c.increment && c.default?.kind === 'expression'));
    const indexes: string[] = [];
    t.indexes.forEach((ix, i) => {
      if (ix.pk || ix.unique) return;
      if (ix.parts.some((p) => p.kind === 'expression')) {
        warnings.push({ element: name(t), message: `An index on an expression in ${name(t)} isn’t created in DuckDB.` });
        return;
      }
      indexes.push(`CREATE INDEX ${ident(ix.name ?? `${t.name}_index_${i + 1}`)} ON ${schemaTableRef(t.schema, t.name)} (${ix.parts.map((p) => ident(p.value)).join(', ')})`);
    });
    const rows = recordsOf(schema, t, false);
    const insert = rows && `INSERT INTO ${schemaTableRef(t.schema, t.name)} (${rows.columns.map(ident).join(', ')}) VALUES\n  ${rows.values.join(',\n  ')}`;
    return { name: name(t), schema: t.schema, table: t.name, sequences, create: create(false), plain: hasExpressions ? create(true) : undefined, indexes, insert };
  });

  const seen = new Set<string>();
  return {
    setup,
    tables,
    warnings: warnings.filter((w) => !seen.has(w.message) && seen.add(w.message)),
    statements: [...setup, ...tables.flatMap((t) => [...t.sequences, t.create, ...t.indexes]), ...tables.flatMap((t) => (t.insert ? [t.insert] : []))],
  };
}

/** A table's records as SQL rows: the real ones, or only the `[example]` ones. Undefined when there are none. */
export function recordsOf(schema: DbmlSchema, t: Table, examples: boolean): { columns: string[]; values: string[] } | undefined {
  const blocks = schema.records.filter((r) => r.schema === t.schema && r.table === t.name && r.example === examples && r.rows.length);
  if (!blocks.length) return undefined;
  // Blocks may name different columns: every row gets every named column, NULL where its block has none.
  const columns = [...new Set(blocks.flatMap((b) => b.columns))].filter((c) => t.columns.some((x) => x.name === c));
  const values = blocks.flatMap((b) =>
    b.rows.map((row) => `(${columns.map((c) => {
      const i = b.columns.indexOf(c);
      const v = i < 0 ? undefined : row[i];
      return v ? recordValueSql(v) : 'NULL';
    }).join(', ')})`),
  );
  return { columns, values };
}
