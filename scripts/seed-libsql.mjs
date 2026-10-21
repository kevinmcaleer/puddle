// Seeds the shop (tests/fixtures/db/seed-libsql.sql) into a LibSQL server over Hrana's HTTP pipeline:
//   node scripts/seed-libsql.mjs http://localhost:8080            (sqld with no auth)
//   node scripts/seed-libsql.mjs 'http://localhost:18081?token=…'   (a bearer token)
import { readFileSync } from 'node:fs';

const url = process.argv[2];
if (!url) {
  console.error('Usage: node scripts/seed-libsql.mjs <http://host:port[?token=…]>');
  process.exit(2);
}
const u = new URL(url.replace(/^libsql:\/\//, 'https://'));
const token = u.searchParams.get('token');
const base = u.origin;
const statements = readFileSync(new URL('../tests/fixtures/db/seed-libsql.sql', import.meta.url), 'utf8')
  .split('\n')
  .filter((l) => l.trim() && !l.startsWith('--'))
  .map((l) => l.replace(/;\s*$/, ''));

async function pipeline(sqls) {
  const res = await fetch(`${base}/v2/pipeline`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify({ requests: [...sqls.map((sql) => ({ type: 'execute', stmt: { sql } })), { type: 'close' }] }) });
  const text = await res.text();
  if (!res.ok) throw new Error(`${res.status}: ${text}`);
  const { results } = JSON.parse(text);
  for (const r of results) if (r.type === 'error') throw new Error(r.error.message);
  return results;
}

// The server may still be starting: try for a while.
for (let attempt = 0; ; attempt++) {
  try {
    await pipeline(['SELECT 1']);
    break;
  } catch (e) {
    if (attempt >= 30 || /401|403/.test(String(e))) throw e;
    await new Promise((r) => setTimeout(r, 1000));
  }
}
await pipeline(statements);
const [count] = await pipeline(['SELECT count(*) FROM orders']);
console.log(`Seeded ${u.host}: ${count.response.result.rows[0][0].value} orders.`);
