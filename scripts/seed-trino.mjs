// Seeds the shop (tests/fixtures/db/seed-trino.sql) into a Trino cluster's memory connector over the REST protocol:
//   node scripts/seed-trino.mjs http://puddle@localhost:8080/memory/shop
// A shop already there is dropped and made again.
import { readFileSync } from 'node:fs';

const url = process.argv[2];
if (!url) {
  console.error('Usage: node scripts/seed-trino.mjs <http://user[:password]@host:port/catalog/schema>');
  process.exit(2);
}
const u = new URL(url);
const user = decodeURIComponent(u.username) || 'puddle';
const headers = { 'X-Trino-User': user, 'X-Trino-Source': 'puddle-seed', ...(u.password ? { Authorization: `Basic ${Buffer.from(`${user}:${decodeURIComponent(u.password)}`).toString('base64')}` } : {}) };
const statements = readFileSync(new URL('../tests/fixtures/db/seed-trino.sql', import.meta.url), 'utf8')
  .split('\n')
  .filter((l) => !l.startsWith('--'))
  .join('\n')
  .split(/;\s*\n/)
  .map((s) => s.trim())
  .filter(Boolean);

async function run(sql) {
  let res = await fetch(`${u.origin}/v1/statement`, { method: 'POST', headers, body: sql });
  let page = await res.json();
  const rows = [];
  for (;;) {
    if (page.error) throw new Error(`${sql.slice(0, 60)}: ${page.error.message}`);
    if (page.data) rows.push(...page.data);
    if (!page.nextUri) return rows;
    res = await fetch(page.nextUri, { headers });
    page = await res.json();
  }
}

// The cluster may still be starting (it answers 503 until it does): try for a while.
for (let attempt = 0; ; attempt++) {
  try {
    await run('SELECT 1');
    break;
  } catch (e) {
    if (attempt >= 90) throw e;
    await new Promise((r) => setTimeout(r, 2000));
  }
}
for (const s of statements) await run(s);
const [[n]] = await run('SELECT count(*) FROM memory.shop.orders');
console.log(`Seeded memory.shop at ${u.host}: ${n} orders.`);
