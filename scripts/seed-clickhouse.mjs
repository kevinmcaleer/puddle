// Seeds the shop (tests/fixtures/db/seed-clickhouse.sql) into a ClickHouse database over its HTTP interface:
//   node scripts/seed-clickhouse.mjs http://default:puddle@localhost:8123/shop
// The database is created when it doesn't exist yet; a shop already there is dropped and made again.
import { readFileSync } from 'node:fs';

const url = process.argv[2];
if (!url) {
  console.error('Usage: node scripts/seed-clickhouse.mjs <http://user:password@host:port/database>');
  process.exit(2);
}
const u = new URL(url);
const database = u.pathname.slice(1) || 'default';
const statements = readFileSync(new URL('../tests/fixtures/db/seed-clickhouse.sql', import.meta.url), 'utf8')
  .split('\n')
  .filter((l) => !l.startsWith('--'))
  .join('\n')
  .split(/;\s*\n/)
  .map((s) => s.trim())
  .filter(Boolean);

async function run(sql, db) {
  const target = new URL(`${u.origin}/`);
  target.searchParams.set('user', decodeURIComponent(u.username) || 'default');
  target.searchParams.set('password', decodeURIComponent(u.password));
  if (db) target.searchParams.set('database', db);
  const res = await fetch(target, { method: 'POST', body: sql });
  const text = await res.text();
  if (!res.ok) throw new Error(`${sql.slice(0, 60)}: ${text.trim()}`);
  return text;
}

// The server may still be starting: try for a while.
for (let attempt = 0; ; attempt++) {
  try {
    await run('SELECT 1');
    break;
  } catch (e) {
    if (attempt >= 30 || /Authentication failed/.test(String(e))) throw e;
    await new Promise((r) => setTimeout(r, 1000));
  }
}
await run(`CREATE DATABASE IF NOT EXISTS "${database.replaceAll('"', '""')}"`);
for (const s of statements) await run(s, database);
const n = (await run('SELECT count() FROM orders', database)).trim();
console.log(`Seeded ${database} at ${u.host}: ${n} orders.`);
