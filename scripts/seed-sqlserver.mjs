// Seeds the shop (tests/fixtures/db/seed-sqlserver.sql) into a SQL Server database for the tests:
//   node scripts/seed-sqlserver.mjs sqlserver://sa:Puddle%21Test1@localhost:1433/shop
// The database is created when it doesn't exist yet. The server's certificate is trusted (a container's is self-signed).
import { readFileSync } from 'node:fs';
import { Connection, Request } from 'tedious';

const url = process.argv[2];
if (!url) {
  console.error('Usage: node scripts/seed-sqlserver.mjs <sqlserver://user:password@host:port/database>');
  process.exit(2);
}
const u = new URL(url);
const database = u.pathname.slice(1);
const batches = readFileSync(new URL('../tests/fixtures/db/seed-sqlserver.sql', import.meta.url), 'utf8')
  .split(/^GO\s*$/m)
  .map((b) => b.split('\n').filter((l) => !l.startsWith('--')).join('\n').trim())
  .filter(Boolean);

function connect(db) {
  return new Promise((resolve, reject) => {
    const conn = new Connection({
      server: u.hostname,
      authentication: { type: 'default', options: { userName: decodeURIComponent(u.username), password: decodeURIComponent(u.password) } },
      options: { port: Number(u.port) || 1433, database: db, encrypt: true, trustServerCertificate: true, connectTimeout: 10_000 },
    });
    conn.connect((err) => (err ? reject(err) : resolve(conn)));
  });
}
const run = (conn, sql) =>
  new Promise((resolve, reject) => {
    const rows = [];
    const request = new Request(sql, (err) => (err ? reject(err) : resolve(rows)));
    request.on('row', (columns) => rows.push(columns.map((c) => c.value)));
    conn.execSql(request);
  });

// The server may still be starting: try for a while.
let master;
for (let attempt = 0; ; attempt++) {
  try {
    master = await connect('master');
    break;
  } catch (e) {
    if (attempt >= 60) throw e;
    await new Promise((r) => setTimeout(r, 2000));
  }
}
await run(master, `IF DB_ID(N'${database.replaceAll("'", "''")}') IS NULL CREATE DATABASE [${database.replaceAll(']', ']]')}]`);
master.close();
const conn = await connect(database);
for (const sql of batches) await run(conn, sql);
const [[n]] = await run(conn, 'SELECT count(*) FROM orders');
conn.close();
console.log(`Seeded ${database} at ${u.host}: ${n} orders.`);
