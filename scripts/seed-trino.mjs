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

// The cluster may still be starting: it answers 503 until the coordinator is up, and for a while after that the
// coordinator accepts statements but has no worker to run them on ("No nodes available to run query"). Wait for
// /v1/info to say it has started, then try each statement for a while.
const NOT_READY = /No nodes available|Coordinator is still starting|Expected response code/;
async function ready() {
  const res = await fetch(`${u.origin}/v1/info`, { headers });
  if (!res.ok) throw new Error(`${res.status} from /v1/info`);
  const info = await res.json();
  if (info.starting) throw new Error('Trino is still starting');
}
async function runWhenReady(sql) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await run(sql);
    } catch (e) {
      if (attempt >= 90 || !NOT_READY.test(String(e))) throw e;
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
}
for (let attempt = 0; ; attempt++) {
  try {
    await ready();
    await runWhenReady('SELECT 1');
    break;
  } catch (e) {
    if (attempt >= 90) throw e;
    await new Promise((r) => setTimeout(r, 2000));
  }
}
for (const s of statements) await runWhenReady(s);
const [[n]] = await runWhenReady('SELECT count(*) FROM memory.shop.orders');
console.log(`Seeded memory.shop at ${u.host}: ${n} orders.`);
