import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseDbml } from '../../schema';
import { DDL_DIALECTS } from '../sql';
import { exportSql } from './export';
import { typeKind } from './types';

const fixture = (name: string) => parseDbml(readFileSync(`tests/fixtures/dbml/${name}.dbml`, 'utf8')).schema;

describe('the schema exported as SQL', () => {
  it.each(DDL_DIALECTS)('writes the shop for %s', async (dialect) => {
    const out = exportSql(fixture('shop'), dialect, { records: true });
    await expect(out.sql).toMatchFileSnapshot(`__snapshots__/shop.${dialect}.sql`);
    expect(out.unmapped).toEqual([]);
  });

  it.each(DDL_DIALECTS)('writes other schemas, many to many, records, notes and unmapped types for %s', async (dialect) => {
    const out = exportSql(fixture('export'), dialect, { records: true });
    await expect(out.sql).toMatchFileSnapshot(`__snapshots__/export.${dialect}.sql`);
  });

  it('writes a cascading delete as ON DELETE CASCADE in every dialect that has it, and says so where it hasn’t', () => {
    for (const d of DDL_DIALECTS.filter((x) => x !== 'duckdb')) expect(exportSql(fixture('shop'), d).sql).toContain('ON DELETE CASCADE');
    const duck = exportSql(fixture('shop'), 'duckdb');
    expect(duck.sql).toContain('ON DELETE NO ACTION');
    expect(duck.warnings).toEqual(['DuckDB has no ON DELETE CASCADE: the ref from order_items uses NO ACTION.']);
  });

  it('leaves out a ref that closes a loop where foreign keys must point at a table already made', () => {
    const loop = parseDbml('Table a {\n  id int [pk]\n  b_id int [ref: > b.id]\n}\nTable b {\n  id int [pk]\n  a_id int [ref: > a.id]\n}').schema;
    const duck = exportSql(loop, 'duckdb');
    expect(duck.sql.match(/FOREIGN KEY/g)).toHaveLength(1);
    expect(duck.warnings).toEqual(['The ref from b to a isn’t a foreign key in DuckDB: it closes a loop of tables that refer to each other.']);
    expect(exportSql(loop, 'sqlite').sql.match(/FOREIGN KEY/g)).toHaveLength(2);
    expect(exportSql(loop, 'postgres').sql.match(/FOREIGN KEY/g)).toHaveLength(2);
  });

  it('keeps composite keys, enums and comments in PostgreSQL', () => {
    const { sql } = exportSql(fixture('shop'), 'postgres');
    expect(sql).toContain('PRIMARY KEY ("order_id", "product_id")');
    expect(sql).toContain(`CREATE TYPE "order_status" AS ENUM ('pending', 'paid', 'shipped', 'cancelled');`);
    expect(sql).toContain(`COMMENT ON TABLE "customers" IS 'Everyone who has signed up';`);
  });

  it('lists the types a database has no word for, and writes them as given', () => {
    const out = exportSql(fixture('export'), 'mysql');
    expect(out.unmapped).toEqual(['billing.accounts.location (geometry)']);
    expect(out.sql).toContain('`location` geometry');
    expect(exportSql(fixture('export'), 'postgres').unmapped).toEqual(['billing.accounts.location (geometry)']);
    expect(exportSql(fixture('export'), 'sqlite').unmapped).toEqual([]);
  });

  it('says what a database can’t do as written', () => {
    expect(exportSql(fixture('export'), 'sqlserver').warnings).toEqual(['SQL Server has no ON UPDATE RESTRICT: the ref from authors uses NO ACTION.']);
    expect(exportSql(fixture('export'), 'sqlite').warnings).toContain('SQLite has no schemas: the tables in billing are created without theirs.');
  });

  it('leaves example records out', () => {
    const { sql } = exportSql(fixture('export'), 'postgres', { records: true });
    expect(sql).toContain(`INSERT INTO "authors" ("id", "name") VALUES\n  (1, 'Ursula'),\n  (2, 'Terry');`);
    expect(sql).not.toContain('A sample');
    expect(exportSql(fixture('export'), 'postgres').sql).not.toContain('INSERT');
  });
});

describe('DBML types read into kinds', () => {
  it.each([
    ['varchar(255)', { kind: 'varchar', length: 255 }],
    ['character varying', { kind: 'varchar', length: undefined }],
    ['decimal(10,2)', { kind: 'decimal', precision: 10, scale: 2 }],
    ['timestamp with time zone', { kind: 'timestamptz' }],
    ['float(53)', { kind: 'double' }],
    ['int[]', undefined],
    ['geometry', undefined],
  ])('%s', (type, kind) => expect(typeKind(type)).toEqual(kind));
});
