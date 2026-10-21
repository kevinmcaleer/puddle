// Records what a server driver asks a real database and what it answers, as the unit tests replay it:
//   node scripts/record-database.mjs postgres postgres://postgres:puddle@localhost:5432/shop
//   node scripts/record-database.mjs mysql mysql://puddle:puddle@localhost:3306/shop
//   node scripts/record-database.mjs firebird firebird://SYSDBA:masterkey@localhost:3050//var/lib/firebird/data/shop.fdb
//   node scripts/record-database.mjs sqlserver sqlserver://sa:password@localhost:1433/shop
//   node scripts/record-database.mjs oracle oracle://shop:password@localhost:1521/FREEPDB1
//   node scripts/record-database.mjs clickhouse http://default:password@localhost:8123/shop
//   node scripts/record-database.mjs trino http://puddle@localhost:8080/memory/shop
//   node scripts/record-database.mjs bigquery 'bigquery://puddle-test/shop?key=/path/key.json&endpoint=http://127.0.0.1:18090'
//   node scripts/record-database.mjs snowflake 'snowflake://PUDDLE@xy12345/SHOP/PUBLIC?key=/path/key.p8&warehouse=COMPUTE_WH&url=http://127.0.0.1:18091'
//   node scripts/record-database.mjs libsql http://:token@localhost:18081
//   node scripts/record-database.mjs surrealdb http://root:root@localhost:8000/shop/shop
//   node scripts/record-database.mjs hana hana://SHOP:password@localhost:39015/HXE
//   node scripts/record-database.mjs dynamodb 'dynamodb://AKIDEXAMPLE:secretexample@eu-west-2?endpoint=http://127.0.0.1:18092'
//   node scripts/record-database.mjs mongodb mongodb://localhost:27017/shop
//   node scripts/record-database.mjs redis redis://:password@localhost:6379/0
//   node scripts/record-database.mjs upstash http://:token@localhost:18079
//   node scripts/record-database.mjs cassandra 'cassandra://localhost:9042/shop?datacenter=datacenter1'
// The two that sign in with a key read it from the file `key` names (a throwaway from scripts/make-test-key.mjs for the
// stand-ins); `endpoint` and `url` point at a stand-in or a private endpoint and are left out for the real service.
// after seeding it with the matching scripts/seed-<family>.mjs. Writes
// tests/fixtures/db/<family>/{queries,catalog}.json; the HTTP families (ClickHouse, Trino) record each request and
// its answer to exchanges.json instead, with the secrets taken out, and the families whose client isn't SQL
// (MongoDB, Redis, Cassandra) record each call on the client, its arguments and its answer, to calls.json. Bytes in
// a recording are kept as base64 under {bytes}, dates as ISO text under {date}.
import { build } from 'esbuild';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
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
  hana: { module: 'hana', connect: 'hanaConnect', make: (mod, connect) => mod.hanaConnector(connect), port: 39015, upper: true, settings: (u) => ({ database: u.pathname.slice(1), ssl: u.searchParams.get('ssl') === 'true' }) },
  oracle: { module: 'oracle', connect: 'oracleConnect', make: (mod, connect) => mod.oracleConnector(connect), port: 1521, upper: true, settings: (u) => ({ service: u.pathname.slice(1) }) },
  // The HTTP families: the connector takes a fetch, and the URL's path names the database (Trino: catalog/schema).
  clickhouse: { module: 'clickhouse', http: true, make: (mod, fetchImpl) => mod.clickhouseConnector(fetchImpl), settings: (u) => ({ url: u.origin, database: u.pathname.slice(1) || 'default' }) },
  trino: { module: 'trino', http: true, make: (mod, fetchImpl) => mod.trinoConnector(fetchImpl), settings: (u) => ({ url: u.origin, catalog: u.pathname.split('/')[1] ?? '', schema: u.pathname.split('/')[2] ?? '' }) },
  bigquery: { module: 'bigquery', http: true, auth: 'key', key: true, make: (mod, fetchImpl) => mod.bigqueryConnector(fetchImpl), settings: (u) => ({ project: u.hostname, dataset: u.pathname.slice(1), ...(u.searchParams.get('endpoint') ? { endpoint: u.searchParams.get('endpoint') } : {}) }) },
  snowflake: { module: 'snowflake', http: true, auth: 'keypair', key: true, upper: true, make: (mod, fetchImpl) => mod.snowflakeConnector(fetchImpl), settings: (u) => ({ account: u.hostname, database: u.pathname.split('/')[1] ?? '', schema: u.pathname.split('/')[2] ?? '', ...Object.fromEntries(['warehouse', 'role', 'url'].filter((k) => u.searchParams.get(k)).map((k) => [k, u.searchParams.get(k)])) }) },
  // LibSQL over Hrana: the URL's password is the token (none for a sqld with no auth).
  // SurrealDB speaks SurrealQL, so its query joins through the record link rather than with JOIN.
  surrealdb: { module: 'surrealdb', http: true, query: 'SELECT customer.name AS name, total, placed_at, status, customer.signed_up AS signed_up, customer.active AS active, id FROM orders ORDER BY id', make: (mod, fetchImpl) => mod.surrealConnector(fetchImpl), settings: (u) => ({ url: u.origin, namespace: u.pathname.split('/')[1] ?? '', database: u.pathname.split('/')[2] ?? '', level: u.searchParams.get('level') ?? 'root' }) },
  // DynamoDB: the URL's user and password are the access key id and secret access key; PartiQL reads one table.
  dynamodb: { module: 'dynamodb', http: true, auth: 'aws', query: 'SELECT * FROM "orders" WHERE customer_id = 1 ORDER BY id', make: (mod, fetchImpl) => mod.dynamoConnector(fetchImpl), settings: (u) => ({ region: u.hostname, accessKeyId: decodeURIComponent(u.username), ...(u.searchParams.get('endpoint') ? { endpoint: u.searchParams.get('endpoint') } : {}) }) },
  libsql: { module: 'hrana', http: true, auth: 'token', make: (mod, fetchImpl) => mod.hranaConnector('libsql', fetchImpl), settings: (u) => ({ url: u.origin }) },
  // The families whose client is called rather than queried: every call is recorded. MongoDB's query is a shell
  // call; Redis reads key patterns (its table is one too); Cassandra has no joins, so its query reads one table.
  mongodb: {
    module: 'mongodb',
    connect: 'mongoConnect',
    calls: true,
    make: (mod, connect) => mod.mongoConnector(connect),
    settings: (u) => ({ url: `${u.protocol}//${u.host}`, database: u.pathname.slice(1), ...(u.searchParams.get('authSource') ? { authSource: u.searchParams.get('authSource') } : {}) }),
    query: 'db.orders.find({ customer_id: 1 }, { _id: 1, total: 1, status: 1 })',
    extra: [
      { table: { name: 'orders' }, filter: '{ "status": "placed" }', limit: 10 },
      { query: 'db.orders.aggregate([{ $group: { _id: "$status", n: { $sum: 1 } } }, { $sort: { _id: 1 } }])', limit: 10 },
    ],
  },
  redis: { module: 'redis', connect: 'redisConnect', connectModule: 'redisSocket', calls: true, make: (mod, connect) => mod.redisConnector(connect), settings: (u) => ({ host: u.hostname, port: Number(u.port) || 6379, db: Number(u.pathname.slice(1)) || 0 }), table: 'user:*', query: 'order:*', extra: [{ query: '*', limit: 5 }] },
  upstash: { module: 'redis', http: true, auth: 'token', via: 'browser', make: (mod, fetchImpl) => mod.redisConnector(undefined, fetchImpl), settings: (u) => ({ rest: u.origin }), table: 'user:*', query: 'order:*' },
  cassandra: {
    module: 'cassandra',
    connect: 'cassandraConnect',
    calls: true,
    make: (mod, connect) => mod.cassandraConnector('cassandra', connect),
    settings: (u) => ({ host: u.hostname, port: Number(u.port) || 9042, keyspace: u.pathname.slice(1), datacenter: u.searchParams.get('datacenter') ?? 'datacenter1' }),
    table: { schema: 'shop', name: 'orders' },
    query: 'SELECT name, signed_up, active, tags FROM shop.customers',
    extra: [
      { table: { schema: 'shop', name: 'orders' }, filter: "status = 'placed'", limit: 10 },
      { table: { schema: 'shop', name: 'orders' }, filter: 'total > 10', allowFiltering: true, limit: 10 },
      // Reads without a collection column, for the engine tests (a JSON column needs DuckDB's json extension).
      { query: 'SELECT id, name, email, signed_up, active FROM shop.customers', limit: 10 },
      { query: 'SELECT id, total, placed_at FROM shop.orders', limit: 10 },
    ],
  },
};
const f = FAMILIES[family];
if (!f || !url) {
  console.error(`Usage: node scripts/record-database.mjs <${Object.keys(FAMILIES).join('|')}> <url>`);
  process.exit(2);
}
// Bundled under node_modules so the bundle finds the client next to it.
const out = fileURLToPath(new URL('../node_modules/.puddle-record', import.meta.url));
mkdirSync(out, { recursive: true });
await build({ entryPoints: [fileURLToPath(new URL(`../src/connect/drivers/${f.module}.ts`, import.meta.url))], bundle: true, platform: 'node', format: 'esm', external: ['pg', 'mysql2', 'node-firebird', 'tedious', 'oracledb', 'hdb', 'mongodb', 'redis', 'cassandra-driver'], outfile: join(out, `${f.module}.mjs`), logLevel: 'warning' });
const mod = await import(pathToFileURL(join(out, `${f.module}.mjs`)).href);
let connectMod = mod;
if (f.connectModule) {
  await build({ entryPoints: [fileURLToPath(new URL(`../src/connect/drivers/${f.connectModule}.ts`, import.meta.url))], bundle: true, platform: 'node', format: 'esm', external: ['redis'], outfile: join(out, `${f.connectModule}.mjs`), logLevel: 'warning' });
  connectMod = await import(pathToFileURL(join(out, `${f.connectModule}.mjs`)).href);
}
await build({ entryPoints: [fileURLToPath(new URL('../src/connect/drivers/http.ts', import.meta.url))], bundle: true, platform: 'node', format: 'esm', outfile: join(out, 'http.mjs'), logLevel: 'warning' });
const { redact } = await import(pathToFileURL(join(out, 'http.mjs')).href);

const plain = (v) => (v instanceof Uint8Array ? { bytes: Buffer.from(v).toString('base64') } : v);
/** A call's arguments or answer as JSON keeps them: bytes as base64, dates as ISO text, anything with a toJSON (an ObjectId) as that. */
const plainDeep = (v) => {
  if (v === null || v === undefined) return null;
  if (v instanceof Uint8Array) return plain(v);
  if (v instanceof Date) return { date: v.toISOString() };
  if (Array.isArray(v)) return v.map(plainDeep);
  if (typeof v === 'object') return typeof v.toJSON === 'function' ? plainDeep(v.toJSON()) : Object.fromEntries(Object.entries(v).map(([k, x]) => [k, plainDeep(x)]));
  return v;
};
const queries = [];
const exchanges = [];
const calls = [];
// For the families whose client is called: each method's arguments and answer, in order.
const recordingCalls = async (config) => {
  const inner = await connectMod[f.connect](config);
  const out = {};
  for (const [name, fn] of Object.entries(inner)) {
    if (name === 'end') out.end = () => inner.end();
    else
      out[name] = async (...args) => {
        const result = await fn(...args);
        calls.push({ method: name, args: plainDeep(args), result: plainDeep(result) });
        return result;
      };
  }
  return out;
};
// For the HTTP families: a fetch that keeps each request and its answer, without the secrets (http.ts `redact`).
const recordingFetch = async (input, init = {}) => {
  const res = await fetch(input, init);
  const text = await res.text();
  const { url: ru, body } = redact(String(input), typeof init.body === 'string' ? init.body : undefined);
  exchanges.push({ method: init.method ?? 'GET', url: ru, ...(body !== undefined ? { body } : {}), status: res.status, response: text });
  return new Response(text, { status: res.status, headers: { 'Content-Type': res.headers.get('Content-Type') ?? 'text/plain' } });
};
const recording = async (config) => {
  const inner = await mod[f.connect](config);
  return {
    query: async (text, mode) => {
      const r = await inner.query(text, mode);
      queries.push({
        text,
        ...(mode !== undefined ? { rowMode: mode } : {}),
        rows: r.rows.map((row) => (Array.isArray(row) ? row.map(plain) : Object.fromEntries(Object.entries(row).map(([k, v]) => [k, plain(v)])))),
        fields: r.fields.map((x) => Object.fromEntries(Object.entries(x).filter(([k]) => ['name', 'dataTypeID', 'dataTypeModifier', 'columnType', 'columnLength', 'flags', 'decimals', 'characterSet', 'alias', 'type', 'subType', 'scale', 'length', 'field', 'relation', 'typeName', 'dataLength', 'precision', 'dbTypeName', 'dataType', 'fraction'].includes(k)))),
      });
      return r;
    },
    end: () => inner.end(),
  };
};
const u = new URL(url);
const connector = f.make(mod, f.http ? recordingFetch : f.calls ? recordingCalls : recording);
const user = decodeURIComponent(u.username);
const settings = f.http || f.calls ? { ...(user && !['token', 'aws'].includes(f.auth) ? { user } : {}), ...f.settings(u) } : { host: u.hostname, port: Number(u.port) || f.port, user, ...f.settings(u) };
const secret = f.key ? readFileSync(u.searchParams.get('key'), 'utf8') : decodeURIComponent(u.password);
const driver = family === 'upstash' ? 'redis' : family;
const ctx = { connection: { id: 'c', name: 'shop', driver, via: f.via ?? 'local', settings, auth: f.auth ?? 'password' }, secret };
const test = await connector.test(ctx);
const catalog = await connector.catalog(ctx);
const detail = await connector.document(ctx);
await connector.read(ctx, { table: typeof f.table === 'object' ? f.table : { name: f.table ?? (f.upper ? 'ORDERS' : 'orders') }, limit: 10 });
await connector.read(ctx, { query: f.query ?? 'SELECT c.name, o.total, o.placed_at, o.status, c.signed_up, c.active FROM orders o JOIN customers c ON c.id = o.customer_id ORDER BY o.id', limit: 2 });
for (const req of f.extra ?? []) await connector.read(ctx, req).catch((e) => console.error(`(${e.message})`));
const dir = new URL(`../tests/fixtures/db/${family}/`, import.meta.url);
mkdirSync(dir, { recursive: true });
const recorded = f.http ? exchanges : f.calls ? calls : queries;
const file = f.http ? 'exchanges.json' : f.calls ? 'calls.json' : 'queries.json';
writeFileSync(new URL(file, dir), JSON.stringify(recorded, null, 2) + '\n');
writeFileSync(new URL('catalog.json', dir), JSON.stringify({ test, catalog, detail }, null, 2) + '\n');
console.log(`Recorded ${recorded.length} ${file.replace('.json', '')} from ${test.server}.`);
