import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseDbml, type DbmlSchema } from '../../schema';
import { DDL_DIALECTS } from '../sql';
import { migrationSql, narrows } from './migration';

const read = (text: string): DbmlSchema => {
  const { schema, errors } = parseDbml(text);
  expect(errors).toEqual([]);
  return schema;
};
const fixture = (name: string) => readFileSync(`tests/fixtures/dbml/${name}.dbml`, 'utf8');
const OLD = read(fixture('migration-old'));
const NEW = read(fixture('migration-new'));
/** The script's statements and by-hand notes, without the header and blank lines. */
const body = (sql: string) => sql.split('\n').slice(1).filter(Boolean);

describe('the migration from a saved version of the schema', () => {
  it.each(DDL_DIALECTS)('writes the fixture pair for %s', async (dialect) => {
    const out = migrationSql(OLD, NEW, dialect);
    await expect(out.sql).toMatchFileSnapshot(`__snapshots__/migration.${dialect}.sql`);
    // Every note left to be done by hand is also a warning.
    const hand = out.sql.split('\n').filter((l) => l.startsWith('-- By hand: ')).map((l) => l.slice('-- By hand: '.length));
    expect(out.warnings).toEqual(expect.arrayContaining(hand));
    expect(out.sql.match(/^-- Loses data: /gm)?.length ?? 0).toBe(out.lossy.length);
  });

  it('adds a column and a foreign key for a column and a ref added to the shop', () => {
    const shop = fixture('shop');
    const newer = shop.replace('  created_at timestamp [default: `now()`]\n', '  created_at timestamp [default: `now()`]\n  referrer_id integer\n') + '\nRef: customers.referrer_id > customers.id\n';
    const out = migrationSql(read(shop), read(newer), 'postgres');
    expect(body(out.sql)).toEqual(['ALTER TABLE "customers" ADD COLUMN "referrer_id" integer;', 'ALTER TABLE "customers" ADD FOREIGN KEY ("referrer_id") REFERENCES "customers" ("id");']);
    expect(out).toMatchObject({ warnings: [], lossy: [] });
  });

  it('names what loses data', () => {
    expect(migrationSql(OLD, NEW, 'postgres').lossy).toEqual(['Narrows products.sku from varchar(32) to varchar(16)', 'Narrows orders.note from text to varchar(500)', 'Drops column orders.legacy_code', 'Drops table audit_log']);
    expect(migrationSql(OLD, NEW, 'duckdb').lossy).toEqual(['Drops table audit_log', 'Drops column orders.legacy_code']);
  });

  it('says so when there is nothing to change', () => {
    expect(body(migrationSql(OLD, OLD, 'postgres').sql)).toEqual(['-- Nothing to change.']);
    expect(body(migrationSql(OLD, read(`${fixture('migration-old')}\nTableGroup g {\n  orders\n}`), 'mysql').sql)).toEqual(['-- Nothing to change.']);
  });

  it('renames with sp_rename in SQL Server, and drops a named foreign key in every database that can', () => {
    const was = read('Table a {\n  id int [pk]\n}\nTable b {\n  id int [pk]\n  a_id int\n}\nRef fk_b_a: b.a_id > a.id');
    const now = read('Table a {\n  id int [pk]\n}\nTable c {\n  id int [pk]\n  a_id int\n}');
    expect(body(migrationSql(was, now, 'sqlserver').sql)).toEqual(['ALTER TABLE [b] DROP CONSTRAINT [fk_b_a];', "EXEC sp_rename 'b', 'c';"]);
    expect(body(migrationSql(was, now, 'mysql').sql)).toEqual(['ALTER TABLE `b` DROP FOREIGN KEY `fk_b_a`;', 'ALTER TABLE `b` RENAME TO `c`;']);
    expect(migrationSql(was, now, 'sqlite').warnings).toEqual(['SQLite can’t drop the foreign key from b to a in place: rebuild b without it.']);
  });

  it('creates new enum types before the tables that use them, and drops the old ones last', () => {
    const was = read('Enum old {\n  x\n}\nTable t {\n  id int\n  o old\n}');
    const now = read("Enum mood {\n  happy\n  sad\n}\nTable t {\n  id int\n  m mood [default: 'happy']\n}");
    expect(body(migrationSql(was, now, 'postgres').sql)).toEqual([
      `CREATE TYPE "mood" AS ENUM ('happy', 'sad');`,
      `ALTER TABLE "t" ADD COLUMN "m" "mood" DEFAULT 'happy';`,
      '-- Loses data: drops column t.o',
      'ALTER TABLE "t" DROP COLUMN "o";',
      'DROP TYPE "old";',
    ]);
  });

  it('changes keys, unique, checks and notes, and leaves to be done by hand what has no name to drop it by', () => {
    const was = read("Table t {\n  id int\n  code varchar [unique]\n  n int\n}");
    const now = read("Table t {\n  id int [pk]\n  code varchar [note: 'Shelf code']\n  n int [check: `n > 0`]\n\n  checks {\n    `n < 100` [name: 'small']\n  }\n  Note: 'Things'\n}");
    expect(body(migrationSql(was, now, 'postgres').sql)).toEqual([
      'ALTER TABLE "t" DROP CONSTRAINT "t_code_key";',
      'ALTER TABLE "t" ADD PRIMARY KEY ("id");',
      'ALTER TABLE "t" ADD CHECK (n > 0);',
      'ALTER TABLE "t" ADD CONSTRAINT "small" CHECK (n < 100);',
      `COMMENT ON TABLE "t" IS 'Things';`,
      `COMMENT ON COLUMN "t"."code" IS 'Shelf code';`,
    ]);
    const sqlserver = migrationSql(was, now, 'sqlserver');
    expect(sqlserver.warnings).toEqual(['Look up the name SQL Server gave the unique constraint on t.code and drop it.']);
    expect(body(migrationSql(was, now, 'duckdb').sql)).toContain('ALTER TABLE "t" ADD PRIMARY KEY ("id");');
  });

  it('makes a junction table for a many-to-many ref that comes', () => {
    const tables = 'Table a {\n  id int [pk]\n}\nTable b {\n  id int [pk]\n}\n';
    const sql = migrationSql(read(tables), read(`${tables}Ref: a.id <> b.id`), 'postgres').sql;
    expect(sql).toContain('CREATE TABLE "a_b" (');
    expect(sql).toContain('ALTER TABLE "a_b" ADD FOREIGN KEY ("a_id") REFERENCES "a" ("id");');
  });

  it('says what can’t be added in SQLite and DuckDB, rather than writing SQL they refuse', () => {
    const was = read('Table t {\n  id int [pk]\n}');
    const now = read("Table t {\n  id int [pk]\n  made timestamp [not null, default: `now()`]\n  code varchar [unique, check: `code <> ''`]\n}");
    const sqlite = migrationSql(was, now, 'sqlite');
    expect(body(sqlite.sql)).toEqual([
      '-- By hand: SQLite can’t add a column with the default `now()`: t.made is added without it.',
      '-- By hand: SQLite can’t add a not null column without a default: t.made is added nullable.',
      'ALTER TABLE "t" ADD COLUMN "made" text;',
      `ALTER TABLE "t" ADD COLUMN "code" text CHECK (code <> '');`,
      'CREATE UNIQUE INDEX "t_code_key" ON "t" ("code");',
    ]);
    expect(body(migrationSql(was, now, 'duckdb').sql)).toEqual([
      'ALTER TABLE "t" ADD COLUMN "made" timestamp DEFAULT (now());',
      'ALTER TABLE "t" ALTER COLUMN "made" SET NOT NULL;',
      'ALTER TABLE "t" ADD COLUMN "code" varchar;',
      "-- By hand: DuckDB can’t add the check `code <> ''` to an existing table: rebuild t with it.",
      'CREATE UNIQUE INDEX "t_code_key" ON "t" ("code");',
    ]);
  });
});

describe('type changes that lose data', () => {
  const col = (type: string) => ({ name: 'c', type, pk: false, unique: false, increment: false, checks: [], properties: {} });
  const empty = read('');
  it.each([
    ['varchar(100)', 'varchar(50)', true],
    ['varchar(50)', 'varchar(100)', false],
    ['text', 'varchar(20)', true],
    ['varchar(20)', 'text', false],
    ['decimal(10,2)', 'decimal(8,2)', true],
    ['decimal(10,2)', 'decimal(10,1)', true],
    ['decimal(10,2)', 'decimal(12,2)', false],
    ['bigint', 'int', true],
    ['int', 'bigint', false],
    ['int', 'decimal(12,2)', false],
    ['int', 'text', false],
    ['text', 'int', true],
    ['date', 'timestamp', false],
    ['timestamp', 'date', true],
    ['geometry', 'geography', true],
  ])('%s to %s: %s', (a, b, lossy) => expect(narrows(empty, empty, col(a), col(b))).toBe(lossy));

  it('an enum that loses a value', () => {
    const a = read('Enum e {\n  x\n  y\n}');
    const b = read('Enum e {\n  x\n}');
    expect(narrows(a, b, col('e'), col('e'))).toBe(true);
    expect(narrows(b, a, col('e'), col('e'))).toBe(false);
  });
});
