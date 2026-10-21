// Seeds the shop (tests/fixtures/db/seed-surrealdb.surql) into a SurrealDB server over its HTTP interface:
//   node scripts/seed-surrealdb.mjs http://root:root@localhost:8000/shop/shop
// The path is the namespace and the database, made when they don't exist yet; a shop already there is replaced.
import { readFileSync } from 'node:fs';

const url = process.argv[2];
if (!url) {
  console.error('Usage: node scripts/seed-surrealdb.mjs <http://user:password@host:port/namespace/database>');
  process.exit(2);
}
const u = new URL(url);
const [namespace = 'shop', database = 'shop'] = u.pathname.split('/').slice(1);
const text = readFileSync(new URL('../tests/fixtures/db/seed-surrealdb.surql', import.meta.url), 'utf8')
  .split('\n')
  .filter((l) => l.trim() && !l.startsWith('--'))
  .join('\n');

async function sql(statements) {
  const res = await fetch(`${u.origin}/sql`, { method: 'POST', headers: { Accept: 'application/json', Authorization: `Basic ${Buffer.from(`${decodeURIComponent(u.username)}:${decodeURIComponent(u.password)}`).toString('base64')}`, 'surreal-ns': namespace, 'surreal-db': database }, body: statements });
  const body = await res.text();
  if (!res.ok) throw new Error(`${res.status}: ${body}`);
  const results = JSON.parse(body);
  for (const r of results) if (r.status !== 'OK') throw new Error(String(r.result));
  return results;
}

// The server may still be starting: try for a while.
for (let attempt = 0; ; attempt++) {
  try {
    await sql('INFO FOR DB');
    break;
  } catch (e) {
    if (attempt >= 30 || /401/.test(String(e))) throw e;
    await new Promise((r) => setTimeout(r, 1000));
  }
}
await sql(text);
const [count] = await sql('SELECT count() FROM orders GROUP ALL');
console.log(`Seeded ${namespace}/${database} at ${u.host}: ${count.result[0].count} orders.`);
