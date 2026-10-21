// Seeds the shop into a Cassandra or ScyllaDB (a container, or a cluster) with the DataStax driver:
//   node scripts/seed-cassandra.mjs 'cassandra://localhost:9042/shop?datacenter=datacenter1'
//   node scripts/seed-cassandra.mjs 'cassandra://cassandra:cassandra@localhost:9042/shop'
// It runs tests/fixtures/db/seed-cassandra.cql statement by statement; the materialized view is skipped with a
// note where the server has them turned off (Cassandra's default), so the rest of the seed still lands.
import cassandra from 'cassandra-driver';
import { readFileSync } from 'node:fs';

const url = process.argv[2];
if (!url) {
  console.error('Usage: node scripts/seed-cassandra.mjs <cassandra://[user:password@]host:9042/keyspace[?datacenter=datacenter1]>');
  process.exit(2);
}
const u = new URL(url);
const user = decodeURIComponent(u.username);
const client = new cassandra.Client({
  contactPoints: [`${u.hostname}:${u.port || 9042}`],
  localDataCenter: u.searchParams.get('datacenter') ?? 'datacenter1',
  ...(user ? { credentials: { username: user, password: decodeURIComponent(u.password) } } : {}),
  socketOptions: { connectTimeout: 5000 },
});
// The server may still be starting (a Cassandra takes a minute or two): try for a while.
for (let attempt = 0; ; attempt++) {
  try {
    await client.connect();
    break;
  } catch (e) {
    if (attempt >= 60 || /Authentication|credentials/i.test(String(e))) throw e;
    await new Promise((r) => setTimeout(r, 5000));
  }
}
const statements = readFileSync(new URL('../tests/fixtures/db/seed-cassandra.cql', import.meta.url), 'utf8')
  .split('\n')
  .filter((line) => !line.startsWith('--'))
  .join('\n')
  .split(/;\s*\n/)
  .map((s) => s.trim())
  .filter(Boolean);
let view = 'and the orders_by_status view';
for (const cql of statements) {
  try {
    await client.execute(cql);
  } catch (e) {
    if (/MATERIALIZED VIEW/i.test(cql)) view = `(no materialized view: ${e.message})`;
    else throw e;
  }
}
const { rows } = await client.execute('SELECT COUNT(*) AS n FROM shop.orders');
console.log(`Seeded shop at ${u.host}: ${rows[0].n} orders ${view}.`);
await client.shutdown();
