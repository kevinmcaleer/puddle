// Seeds the shop (tests/fixtures/db/seed-mysql.sql) into a MySQL-family database for the tests:
//   node scripts/seed-mysql.mjs mysql://puddle:puddle@localhost:3306/shop
// The database is created when it doesn't exist yet and the user may.
import { readFileSync } from 'node:fs';
import mysql from 'mysql2/promise';

const url = process.argv[2];
if (!url) {
  console.error('Usage: node scripts/seed-mysql.mjs <mysql://user:password@host:port/database>');
  process.exit(2);
}
const target = new URL(url);
const database = target.pathname.slice(1);
const sql = readFileSync(new URL('../tests/fixtures/db/seed-mysql.sql', import.meta.url), 'utf8');
const config = { host: target.hostname, port: Number(target.port) || 3306, user: decodeURIComponent(target.username), password: decodeURIComponent(target.password), multipleStatements: true };

// The database may still be starting: try for a while.
let conn;
for (let attempt = 0; ; attempt++) {
  try {
    conn = await mysql.createConnection(config);
    break;
  } catch (e) {
    if (attempt >= 30) throw e;
    await new Promise((r) => setTimeout(r, 1000));
  }
}
await conn.query(`CREATE DATABASE IF NOT EXISTS \`${database.replaceAll('`', '``')}\``);
await conn.changeUser({ database });
await conn.query(sql);
const [rows] = await conn.query('SELECT count(*) AS n FROM orders');
await conn.end();
console.log(`Seeded ${database} at ${target.host}: ${rows[0].n} orders.`);
