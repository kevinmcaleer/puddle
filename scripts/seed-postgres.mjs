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

// Creates the database when it is missing, from whichever administrative database the server has. CockroachDB
// accepts a connection to a database that doesn't exist and only complains at the first query that needs it, so
// the catalogue is asked rather than trusting the connection.
async function ensureDatabase() {
  for (const admin of ['postgres', 'defaultdb']) {
    const c = await connect(admin);
    try {
      const { rows } = await c.query('SELECT 1 FROM pg_database WHERE datname = $1', [database]);
      if (rows.length === 0) await c.query(`CREATE DATABASE "${database.replaceAll('"', '""')}"`);
      return;
    } catch (e) {
      if (e.code !== '3D000') throw e;
    } finally {
      await c.end().catch(() => {});
    }
  }
  throw new Error(`No administrative database found at ${target.host} to create ${database} from.`);
}

// The database may still be starting: try for a while.
for (let attempt = 0; ; attempt++) {
  try {
    await ensureDatabase();
    break;
  } catch (e) {
    if (attempt >= 30 || e.code === '3D000' || e.code === '28000' || e.code === '28P01') throw e;
    await new Promise((r) => setTimeout(r, 1000));
  }
}
const client = await connect(database);
await client.query(sql);
const { rows } = await client.query('SELECT count(*)::text AS n FROM orders');
await client.end();
console.log(`Seeded ${database} at ${target.host}: ${rows[0].n} orders.`);
