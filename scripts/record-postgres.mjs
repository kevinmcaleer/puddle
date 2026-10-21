// Records what the PostgreSQL driver asks a real server and what it answers, as the unit tests replay it:
//   node scripts/record-postgres.mjs postgres://postgres:puddle@localhost:5432/shop
// after `node scripts/seed-postgres.mjs <same url>`. Writes tests/fixtures/db/postgres/{queries,catalog}.json.
import { build } from 'esbuild';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const url = process.argv[2];
if (!url) {
  console.error('Usage: node scripts/record-postgres.mjs <postgres://user:password@host:port/database>');
  process.exit(2);
}
// Bundled under node_modules so the bundle finds pg next to it.
const out = fileURLToPath(new URL('../node_modules/.puddle-record', import.meta.url));
mkdirSync(out, { recursive: true });
await build({ entryPoints: [fileURLToPath(new URL('../src/connect/drivers/postgres.ts', import.meta.url))], bundle: true, platform: 'node', format: 'esm', external: ['pg'], outfile: join(out, 'postgres.mjs'), logLevel: 'warning' });
const { pgConnect, postgresConnector } = await import(pathToFileURL(join(out, 'postgres.mjs')).href);

const queries = [];
const recording = async (config) => {
  const inner = await pgConnect(config);
  return {
    query: async (text, rowMode) => {
      const r = await inner.query(text, rowMode);
      queries.push({ text, ...(rowMode ? { rowMode } : {}), rows: r.rows, fields: r.fields.map((f) => ({ name: f.name, dataTypeID: f.dataTypeID, dataTypeModifier: f.dataTypeModifier })) });
      return r;
    },
    end: () => inner.end(),
  };
};
const u = new URL(url);
const connector = postgresConnector('postgres', recording);
const ctx = { connection: { id: 'c', name: 'shop', driver: 'postgres', via: 'local', settings: { host: u.hostname, port: Number(u.port) || 5432, database: u.pathname.slice(1), user: decodeURIComponent(u.username) }, auth: 'password' }, secret: decodeURIComponent(u.password) };
const test = await connector.test(ctx);
const catalog = await connector.catalog(ctx);
const detail = await connector.document(ctx);
await connector.read(ctx, { table: { name: 'orders' }, limit: 10 });
await connector.read(ctx, { query: 'SELECT c.name, o.total, o.placed_at, o.status, c.signed_up, c.active FROM orders o JOIN customers c ON c.id = o.customer_id ORDER BY o.id', limit: 2 });
const dir = new URL('../tests/fixtures/db/postgres/', import.meta.url);
writeFileSync(new URL('queries.json', dir), JSON.stringify(queries, null, 2) + '\n');
writeFileSync(new URL('catalog.json', dir), JSON.stringify({ test, catalog, detail }, null, 2) + '\n');
console.log(`Recorded ${queries.length} queries from ${test.server}.`);
