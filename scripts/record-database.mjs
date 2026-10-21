// Records what a server driver asks a real database and what it answers, as the unit tests replay it:
//   node scripts/record-database.mjs postgres postgres://postgres:puddle@localhost:5432/shop
//   node scripts/record-database.mjs mysql mysql://puddle:puddle@localhost:3306/shop
// after seeding it with scripts/seed-postgres.mjs or scripts/seed-mysql.mjs. Writes
// tests/fixtures/db/<family>/{queries,catalog}.json. Bytes in a recording are kept as base64 under {bytes}.
import { build } from 'esbuild';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const [family, url] = process.argv.slice(2);
const FAMILIES = {
  postgres: { module: 'postgres', connect: 'pgConnect', connector: 'postgresConnector', port: 5432 },
  mysql: { module: 'mysql', connect: 'mysqlConnect', connector: 'mysqlConnector', port: 3306 },
};
const f = FAMILIES[family];
if (!f || !url) {
  console.error('Usage: node scripts/record-database.mjs <postgres|mysql> <url>');
  process.exit(2);
}
// Bundled under node_modules so the bundle finds the client next to it.
const out = fileURLToPath(new URL('../node_modules/.puddle-record', import.meta.url));
mkdirSync(out, { recursive: true });
await build({ entryPoints: [fileURLToPath(new URL(`../src/connect/drivers/${f.module}.ts`, import.meta.url))], bundle: true, platform: 'node', format: 'esm', external: ['pg', 'mysql2'], outfile: join(out, `${f.module}.mjs`), logLevel: 'warning' });
const mod = await import(pathToFileURL(join(out, `${f.module}.mjs`)).href);

const plain = (v) => (v instanceof Uint8Array ? { bytes: Buffer.from(v).toString('base64') } : v);
const queries = [];
const recording = async (config) => {
  const inner = await mod[f.connect](config);
  return {
    query: async (text, mode) => {
      const r = await inner.query(text, mode);
      queries.push({
        text,
        ...(mode !== undefined ? { rowMode: mode } : {}),
        rows: r.rows.map((row) => (Array.isArray(row) ? row.map(plain) : Object.fromEntries(Object.entries(row).map(([k, v]) => [k, plain(v)])))),
        fields: r.fields.map((x) => Object.fromEntries(Object.entries(x).filter(([k]) => ['name', 'dataTypeID', 'dataTypeModifier', 'columnType', 'columnLength', 'flags', 'decimals', 'characterSet'].includes(k)))),
      });
      return r;
    },
    end: () => inner.end(),
  };
};
const u = new URL(url);
const connector = mod[f.connector](family, recording);
const ctx = { connection: { id: 'c', name: 'shop', driver: family, via: 'local', settings: { host: u.hostname, port: Number(u.port) || f.port, database: u.pathname.slice(1), user: decodeURIComponent(u.username) }, auth: 'password' }, secret: decodeURIComponent(u.password) };
const test = await connector.test(ctx);
const catalog = await connector.catalog(ctx);
const detail = await connector.document(ctx);
await connector.read(ctx, { table: { name: 'orders' }, limit: 10 });
await connector.read(ctx, { query: 'SELECT c.name, o.total, o.placed_at, o.status, c.signed_up, c.active FROM orders o JOIN customers c ON c.id = o.customer_id ORDER BY o.id', limit: 2 });
const dir = new URL(`../tests/fixtures/db/${family}/`, import.meta.url);
mkdirSync(dir, { recursive: true });
writeFileSync(new URL('queries.json', dir), JSON.stringify(queries, null, 2) + '\n');
writeFileSync(new URL('catalog.json', dir), JSON.stringify({ test, catalog, detail }, null, 2) + '\n');
console.log(`Recorded ${queries.length} queries from ${test.server}.`);
