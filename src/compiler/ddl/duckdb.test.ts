import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseDbml } from '../../schema';
import { defaultSql, duckdbType, recordValueSql, schemaDdl } from './duckdb';

const fixture = (name: string) => parseDbml(readFileSync(`tests/fixtures/dbml/${name}.dbml`, 'utf8')).schema;

describe('DBML types in DuckDB', () => {
  it.each([
    ['varchar(255)', 'VARCHAR'],
    ['character varying(20)', 'VARCHAR'],
    ['text', 'VARCHAR'],
    ['int', 'INTEGER'],
    ['bigint', 'BIGINT'],
    ['int unsigned', 'UINTEGER'],
    ['decimal(10,2)', 'DECIMAL(10,2)'],
    ['numeric', 'DECIMAL(18,3)'],
    ['float', 'FLOAT'],
    ['float(53)', 'DOUBLE'],
    ['double precision', 'DOUBLE'],
    ['boolean', 'BOOLEAN'],
    ['date', 'DATE'],
    ['time', 'TIME'],
    ['timestamp', 'TIMESTAMP'],
    ['timestamp with time zone', 'TIMESTAMPTZ'],
    ['timestamptz', 'TIMESTAMPTZ'],
    ['uuid', 'UUID'],
    ['json', 'VARCHAR'],
    ['bytea', 'BLOB'],
    ['int[]', 'INTEGER[]'],
    ['text[][]', 'VARCHAR[][]'],
  ])('%s is %s', (type, sql) => expect(duckdbType(type)).toEqual({ sql }));

  it('creates an unknown type as text, and says so', () => {
    expect(duckdbType('geography')).toEqual({ sql: 'VARCHAR', unknown: true });
  });

  it('names an enum of the schema as its DuckDB type', () => {
    const schema = fixture('enums');
    expect(duckdbType('job_status', schema).sql).toBe('"dbml_public"."job_status"');
  });

  it('writes defaults and record values as SQL literals', () => {
    expect(defaultSql({ kind: 'string', value: "it's" })).toBe("'it''s'");
    expect(defaultSql({ kind: 'expression', value: 'now()' })).toBe('(now())');
    expect(defaultSql({ kind: 'boolean', value: 'TRUE' })).toBe('true');
    expect(recordValueSql({ kind: 'enum', value: 'status.active' })).toBe("'active'");
    expect(recordValueSql({ kind: 'empty', value: '' })).toBe('NULL');
  });
});

describe('the DDL for a schema', () => {
  it('creates the shop’s enum, tables, keys, foreign keys, indexes and records, parents first', () => {
    const ddl = schemaDdl(fixture('shop'));
    expect(ddl.statements).toMatchSnapshot();
    expect(ddl.tables.map((t) => t.name)).toEqual(['customers', 'orders', 'products', 'order_items']);
    expect(ddl.warnings).toEqual([]);
  });

  it('creates the tables of the schema table fixture', () => {
    expect(schemaDdl(fixture('tables')).statements).toMatchSnapshot();
  });

  it('keeps a table’s expression defaults and checks out of its plain version', () => {
    const t = schemaDdl(fixture('tables')).tables.find((x) => x.name === 'orders')!;
    expect(t.create).toContain('CHECK (total >= 0)');
    expect(t.plain).toBeDefined();
    expect(t.plain).not.toContain('CHECK');
  });

  it('leaves out foreign keys DuckDB can’t take, saying why', () => {
    const refs = schemaDdl(fixture('refs'));
    expect(refs.warnings.map((w) => w.message)).toContain('The ref from posts to users.id isn’t created as a foreign key: those columns aren’t the key of users or unique.');
    const schemas = schemaDdl(fixture('schemas'));
    expect(schemas.warnings.some((w) => /between schemas/.test(w.message))).toBe(true);
    const loop = schemaDdl(parseDbml('Table a {\n  id int [pk]\n  b_id int [ref: > b.id]\n}\nTable b {\n  id int [pk]\n  a_id int [ref: > a.id]\n}').schema);
    expect(loop.warnings.map((w) => w.message)).toEqual(['The ref from b to a isn’t created as a foreign key: the tables refer to each other in a loop.']);
  });

  it('puts example records nowhere in the DDL', () => {
    expect(schemaDdl(fixture('records')).statements.join('\n')).not.toContain("'Alice'), (2, 'Bob')");
    expect(schemaDdl(fixture('tables')).statements.join('\n')).not.toContain('900');
  });
});
