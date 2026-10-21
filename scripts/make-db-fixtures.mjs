#!/usr/bin/env node
// Write tests/fixtures/db/shop.sqlite and shop.duckdb: a small shop with customers, orders (a foreign key to
// customers) and a view, the same rows in both, for the database-file connectors and their tests.
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import initSqlJs from 'sql.js';
import { DuckDBInstance } from '@duckdb/node-api';

const out = process.argv[2] ?? 'tests/fixtures/db';
mkdirSync(out, { recursive: true });

const customers = [
  [1, 'Ada Lovelace', 'ada@example.com', '2024-01-15', 1],
  [2, 'Grace Hopper', 'grace@example.com', '2024-02-20', 1],
  [3, 'Alan Turing', null, '2024-03-05', 0],
];
const orders = [
  [101, 1, 19.99, '2024-04-01 09:30:00'],
  [102, 1, 5.5, '2024-04-02 14:00:00'],
  [103, 2, 120, '2024-04-03 11:15:00'],
  [104, 3, 42.25, '2024-04-04 16:45:00'],
];

const SQL = await initSqlJs();
const db = new SQL.Database();
db.run('CREATE TABLE customers (id INTEGER PRIMARY KEY, name TEXT NOT NULL, email TEXT, signed_up DATE, active BOOLEAN)');
db.run('CREATE TABLE orders (id INTEGER PRIMARY KEY, customer_id INTEGER NOT NULL REFERENCES customers(id), total REAL, placed_at DATETIME)');
db.run('CREATE VIEW order_totals AS SELECT c.name, count(o.id) AS orders, sum(o.total) AS total FROM customers c LEFT JOIN orders o ON o.customer_id = c.id GROUP BY c.name');
for (const r of customers) db.run('INSERT INTO customers VALUES (?, ?, ?, ?, ?)', r);
for (const r of orders) db.run('INSERT INTO orders VALUES (?, ?, ?, ?)', r);
writeFileSync(join(out, 'shop.sqlite'), db.export());
db.close();

const path = join(out, 'shop.duckdb');
rmSync(path, { force: true });
const instance = await DuckDBInstance.create(path);
const conn = await instance.connect();
await conn.run('CREATE TABLE customers (id INTEGER PRIMARY KEY, name VARCHAR NOT NULL, email VARCHAR, signed_up DATE, active BOOLEAN)');
await conn.run('CREATE TABLE orders (id INTEGER PRIMARY KEY, customer_id INTEGER NOT NULL REFERENCES customers(id), total DECIMAL(10,2), placed_at TIMESTAMP)');
await conn.run('CREATE VIEW order_totals AS SELECT c.name, count(o.id) AS orders, sum(o.total) AS total FROM customers c LEFT JOIN orders o ON o.customer_id = c.id GROUP BY c.name');
const q = (v) => (v === null ? 'NULL' : typeof v === 'string' ? `'${v}'` : String(v));
for (const r of customers) await conn.run(`INSERT INTO customers VALUES (${q(r[0])}, ${q(r[1])}, ${q(r[2])}, ${q(r[3])}, ${r[4] ? 'true' : 'false'})`);
for (const r of orders) await conn.run(`INSERT INTO orders VALUES (${r.map(q).join(', ')})`);
await conn.run('CHECKPOINT');
conn.closeSync();
instance.closeSync();
console.log(`Wrote ${out}/shop.sqlite and ${out}/shop.duckdb`);
