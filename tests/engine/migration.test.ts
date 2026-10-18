// The DuckDB migration between two versions of a schema, run on real DuckDB-WASM (Node build): the export of the
// saved version, then the migration, leave the tables and columns of the current version.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { exportSql } from '../../src/compiler/ddl/export';
import { migrationSql } from '../../src/compiler/ddl/migration';
import { EngineClient, tableRows } from '../../src/engine/client';
import { parseDbml } from '../../src/schema';
import { createNodeBackend } from '../helpers/nodeBackend';

const fixture = (name: string) => parseDbml(readFileSync(join(__dirname, `../fixtures/dbml/${name}.dbml`), 'utf8')).schema;

/** The script's statements, without its comments (and so without what it leaves to be done by hand). */
const statements = (sql: string) =>
  sql
    .split(/;\n/)
    .map((s) => s.replace(/^--.*$/gm, '').replace(/ -- .*$/gm, '').trim())
    .filter(Boolean);

let engine: EngineClient;
const rows = async (sql: string) => tableRows((await engine.query(sql)).table);
beforeAll(async () => {
  engine = new EngineClient(await createNodeBackend());
});
afterAll(() => engine.close());

describe('the DuckDB migration, run on DuckDB', () => {
  it('takes the saved version’s tables to the current version’s', async () => {
    const older = fixture('migration-old');
    const newer = fixture('migration-new');
    for (const s of statements(exportSql(older, 'duckdb').sql)) await engine.query(s);
    const migration = migrationSql(older, newer, 'duckdb');
    for (const s of statements(migration.sql)) await engine.query(s);

    const columns = await rows(`SELECT table_name AS t, column_name AS c FROM duckdb_columns() WHERE database_name = current_database() AND schema_name = 'main' AND NOT internal ORDER BY table_name, column_index`);
    const actual: Record<string, string[]> = {};
    for (const r of columns) (actual[r.t as string] ??= []).push(r.c as string);
    expect(actual).toEqual(Object.fromEntries(newer.tables.map((t) => [t.name, t.columns.map((c) => c.name)])));

    const total = await rows(`SELECT data_type AS type, is_nullable AS nullable FROM duckdb_columns() WHERE table_name = 'orders' AND column_name = 'total'`);
    expect(total).toEqual([{ type: 'DECIMAL(12,2)', nullable: false }]);
    await engine.query(`INSERT INTO customers (email) VALUES ('ada@example.com')`);
    expect(await rows('SELECT country FROM customers')).toEqual([{ country: 'US' }]);
    await engine.query(`INSERT INTO orders (id, customer_id, status, total) VALUES (1, 1, 'paid', 10)`);
    await engine.query(`INSERT INTO refunds (order_id, amount) VALUES (1, 10)`);
    await expect(engine.query(`INSERT INTO refunds (order_id, amount) VALUES (99, 10)`)).rejects.toThrow(/foreign key/i);
    // What DuckDB can't do in place is left as notes, not statements it would refuse.
    expect(migration.warnings).toContain('DuckDB can’t add the value \'refunded\' to enum order_status: make a new type with the values and change the columns that use it.');
  });
});
