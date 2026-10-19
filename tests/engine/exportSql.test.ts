// The DuckDB script the schema exports as, run on real DuckDB-WASM (Node build): every statement is accepted, and the
// keys and foreign keys it writes hold.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { exportSql } from '../../src/compiler/ddl/export';
import { EngineClient, tableRows } from '../../src/engine/client';
import { parseDbml } from '../../src/schema';
import { createNodeBackend } from '../helpers/nodeBackend';

const fixture = (name: string) => readFileSync(join(__dirname, `../fixtures/dbml/${name}.dbml`), 'utf8');

/** The script's statements, without its comments. */
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

describe('the DuckDB export, run on DuckDB', () => {
  it('creates the shop, and its keys refuse what they should', async () => {
    for (const s of statements(exportSql(parseDbml(fixture('shop')).schema, 'duckdb', { records: true }).sql)) await engine.query(s);
    await engine.query(`INSERT INTO customers (email, name) VALUES ('ada@example.com', 'Ada')`);
    expect(await rows('SELECT id, country FROM customers')).toEqual([{ id: 1, country: 'GB' }]);
    await expect(engine.query(`INSERT INTO customers (email, name) VALUES ('ada@example.com', 'Ada again')`)).rejects.toThrow(/unique|duplicate/i);
    await expect(engine.query(`INSERT INTO orders (customer_id, status, total, ordered_at) VALUES (99, 'paid', 1, now())`)).rejects.toThrow(/foreign key/i);
    await expect(engine.query(`INSERT INTO orders (customer_id, status, total, ordered_at) VALUES (1, 'lost', 1, now())`)).rejects.toThrow(/lost|enum|conversion/i);
  });

  it('creates other schemas, a junction table for many to many, and the records', async () => {
    const dbml = fixture('export').replace('location geometry', 'location varchar');
    for (const s of statements(exportSql(parseDbml(dbml).schema, 'duckdb', { records: true }).sql)) await engine.query(s);
    expect((await rows('SELECT name FROM authors ORDER BY id')).map((r) => r.name)).toEqual(['Ursula', 'Terry']);
    const tables = await rows(`SELECT schema_name || '.' || table_name AS t FROM duckdb_tables() WHERE table_name IN ('accounts', 'books_authors') ORDER BY t`);
    expect(tables.map((r) => r.t)).toEqual(['billing.accounts', 'main.books_authors']);
  });
});
