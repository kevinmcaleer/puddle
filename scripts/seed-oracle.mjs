// Seeds the shop (tests/fixtures/db/seed-oracle.sql) into an Oracle schema for the tests:
//   node scripts/seed-oracle.mjs oracle://shop:puddle@localhost:1521/FREEPDB1
// The user's own schema is used; a shop already there is dropped and made again.
import { readFileSync } from 'node:fs';
import oracledb from 'oracledb';

const url = process.argv[2];
if (!url) {
  console.error('Usage: node scripts/seed-oracle.mjs <oracle://user:password@host:port/service>');
  process.exit(2);
}
const u = new URL(url);
const statements = readFileSync(new URL('../tests/fixtures/db/seed-oracle.sql', import.meta.url), 'utf8')
  .split('\n')
  .filter((l) => !l.startsWith('--'))
  .join('\n')
  .split(/;\s*\n/)
  .map((s) => s.trim())
  .filter(Boolean);

// The database may still be starting: try for a while.
let conn;
for (let attempt = 0; ; attempt++) {
  try {
    conn = await oracledb.getConnection({ user: decodeURIComponent(u.username), password: decodeURIComponent(u.password), connectString: `${u.hostname}:${Number(u.port) || 1521}/${u.pathname.slice(1)}` });
    break;
  } catch (e) {
    if (attempt >= 90) throw e;
    await new Promise((r) => setTimeout(r, 2000));
  }
}
for (const sql of ['DROP VIEW order_totals', 'DROP TABLE orders', 'DROP TABLE customers']) await conn.execute(sql).catch(() => undefined);
for (const sql of statements) await conn.execute(sql);
await conn.commit();
const { rows } = await conn.execute('SELECT count(*) FROM orders');
await conn.close();
console.log(`Seeded ${u.pathname.slice(1)} at ${u.host}: ${rows[0][0]} orders.`);
