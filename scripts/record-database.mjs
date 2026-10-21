// Records what a server driver asks a real database and what it answers, as the unit tests replay it:
//   node scripts/record-database.mjs postgres postgres://postgres:puddle@localhost:5432/shop
//   node scripts/record-database.mjs mysql mysql://puddle:puddle@localhost:3306/shop
//   node scripts/record-database.mjs firebird firebird://SYSDBA:masterkey@localhost:3050//var/lib/firebird/data/shop.fdb
//   node scripts/record-database.mjs sqlserver sqlserver://sa:password@localhost:1433/shop
//   node scripts/record-database.mjs oracle oracle://shop:password@localhost:1521/FREEPDB1
// after seeding it with the matching scripts/seed-<family>.mjs. Writes
// tests/fixtures/db/<family>/{queries,catalog}.json. Bytes in a recording are kept as base64 under {bytes}.
import { build } from 'esbuild';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const [family, url] = process.argv.slice(2);
// Each family: the driver module, how a connector is made with a stand-in connect, the settings its URL gives, and
// whether unquoted names are upper case there (Firebird, Oracle), so the shop's tables are asked for as such.
const FAMILIES = {
  postgres: { module: 'postgres', connect: 'pgConnect', make: (mod, connect) => mod.postgresConnector('postgres', connect), port: 5432, settings: (u) => ({ database: u.pathname.slice(1) }) },
  mysql: { module: 'mysql', connect: 'mysqlConnect', make: (mod, connect) => mod.mysqlConnector('mysql', connect), port: 3306, settings: (u) => ({ database: u.pathname.slice(1) }) },
  firebird: { module: 'firebird', connect: 'firebirdConnect', make: (mod, connect) => mod.firebirdConnector(connect), port: 3050, upper: true, settings: (u) => ({ database: u.pathname.slice(1) }) },
  sqlserver: { module: 'sqlserver', connect: 'sqlserverConnect', make: (mod, connect) => mod.sqlserverConnector(connect), port: 1433, settings: (u) => ({ database: u.pathname.slice(1), encrypt: true, sslVerify: false }) },
  oracle: { module: 'oracle', connect: 'oracleConnect', make: (mod, connect) => mod.oracleConnector(connect), port: 1521, upper: true, settings: (u) => ({ service: u.pathname.slice(1) }) },
};
const f = FAMILIES[family];
if (!f || !url) {
  console.error('Usage: node scripts/record-database.mjs <postgres|mysql|firebird|sqlserver|oracle> <url>');
  process.exit(2);
}
// Bundled under node_modules so the bundle finds the client next to it.
const out = fileURLToPath(new URL('../node_modules/.puddle-record', import.meta.url));
mkdirSync(out, { recursive: true });
await build({ entryPoints: [fileURLToPath(new URL(`../src/connect/drivers/${f.module}.ts`, import.meta.url))], bundle: true, platform: 'node', format: 'esm', external: ['pg', 'mysql2', 'node-firebird', 'tedious', 'oracledb'], outfile: join(out, `${f.module}.mjs`), logLevel: 'warning' });
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
        fields: r.fields.map((x) => Object.fromEntries(Object.entries(x).filter(([k]) => ['name', 'dataTypeID', 'dataTypeModifier', 'columnType', 'columnLength', 'flags', 'decimals', 'characterSet', 'alias', 'type', 'subType', 'scale', 'length', 'field', 'relation', 'typeName', 'dataLength', 'precision', 'dbTypeName'].includes(k)))),
      });
      return r;
    },
    end: () => inner.end(),
  };
};
const u = new URL(url);
const connector = f.make(mod, recording);
const ctx = { connection: { id: 'c', name: 'shop', driver: family, via: 'local', settings: { host: u.hostname, port: Number(u.port) || f.port, user: decodeURIComponent(u.username), ...f.settings(u) }, auth: 'password' }, secret: decodeURIComponent(u.password) };
const test = await connector.test(ctx);
const catalog = await connector.catalog(ctx);
const detail = await connector.document(ctx);
await connector.read(ctx, { table: { name: f.upper ? 'ORDERS' : 'orders' }, limit: 10 });
await connector.read(ctx, { query: 'SELECT c.name, o.total, o.placed_at, o.status, c.signed_up, c.active FROM orders o JOIN customers c ON c.id = o.customer_id ORDER BY o.id', limit: 2 });
const dir = new URL(`../tests/fixtures/db/${family}/`, import.meta.url);
mkdirSync(dir, { recursive: true });
writeFileSync(new URL('queries.json', dir), JSON.stringify(queries, null, 2) + '\n');
writeFileSync(new URL('catalog.json', dir), JSON.stringify({ test, catalog, detail }, null, 2) + '\n');
console.log(`Recorded ${queries.length} queries from ${test.server}.`);
