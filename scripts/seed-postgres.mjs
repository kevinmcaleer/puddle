// Seeds the shop (tests/fixtures/db/seed.sql) into a PostgreSQL-family database for the tests:
//   node scripts/seed-postgres.mjs postgres://postgres:puddle@localhost:5432/shop
// The database is created when it doesn't exist yet (CockroachDB starts with defaultdb, PostgreSQL with postgres).
import { readFileSync } from 'node:fs';
import pg from 'pg';

const url = process.argv[2];
if (!url) {
  console.error('Usage: node scripts/seed-postgres.mjs <postgres://user:password@host:port/database>');
  process.exit(2);
}
const target = new URL(url);
const database = target.pathname.slice(1);
const sql = readFileSync(new URL('../tests/fixtures/db/seed.sql', import.meta.url), 'utf8');

async function connect(db) {
  const u = new URL(url);
  u.pathname = `/${db}`;
  const client = new pg.Client({ connectionString: u.toString() });
  await client.connect();
  return client;
}

// The database may still be starting: try for a while.
let client;
for (let attempt = 0; ; attempt++) {
  try {
    client = await connect(database);
    break;
  } catch (e) {
    if (e.code === '3D000') {
      for (const admin of ['postgres', 'defaultdb']) {
        try {
          const c = await connect(admin);
          await c.query(`CREATE DATABASE "${database.replaceAll('"', '""')}"`);
          await c.end();
          break;
        } catch (inner) {
          if (inner.code !== '3D000') throw inner;
        }
      }
      continue;
    }
    if (attempt >= 30) throw e;
    await new Promise((r) => setTimeout(r, 1000));
  }
}
await client.query(sql);
const { rows } = await client.query('SELECT count(*)::text AS n FROM orders');
await client.end();
console.log(`Seeded ${database} at ${target.host}: ${rows[0].n} orders.`);
