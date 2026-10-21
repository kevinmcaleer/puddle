// Seeds the shop (tests/fixtures/db/seed-firebird.sql) into a Firebird database for the tests:
//   node scripts/seed-firebird.mjs firebird://SYSDBA:masterkey@localhost:3050//var/lib/firebird/data/shop.fdb
// The database is created when it doesn't exist yet; a shop already there is dropped and made again.
import Firebird from 'node-firebird';
import { readFileSync } from 'node:fs';

const url = process.argv[2];
if (!url) {
  console.error('Usage: node scripts/seed-firebird.mjs <firebird://user:password@host:port/path.fdb>');
  process.exit(2);
}
const u = new URL(url);
const options = { host: u.hostname, port: Number(u.port) || 3050, database: u.pathname.slice(1), user: decodeURIComponent(u.username), password: decodeURIComponent(u.password), encoding: 'UTF8' };
const statements = readFileSync(new URL('../tests/fixtures/db/seed-firebird.sql', import.meta.url), 'utf8')
  .split('\n')
  .filter((l) => !l.startsWith('--'))
  .join('\n')
  .split(/;\s*\n/)
  .map((s) => s.trim())
  .filter(Boolean);

// The server may still be starting: try for a while.
let db;
for (let attempt = 0; ; attempt++) {
  try {
    db = await Firebird.attachOrCreateAsync(options);
    break;
  } catch (e) {
    if (attempt >= 30) throw e;
    await new Promise((r) => setTimeout(r, 1000));
  }
}
for (const sql of ['DROP VIEW order_totals', 'DROP TABLE orders', 'DROP TABLE customers']) await db.queryAsync(sql).catch(() => undefined);
for (const sql of statements) await db.queryAsync(sql);
const [{ N: n }] = await db.queryAsync('SELECT count(*) AS N FROM orders');
await db.detachAsync();
console.log(`Seeded ${options.database} at ${options.host}:${options.port}: ${n} orders.`);
