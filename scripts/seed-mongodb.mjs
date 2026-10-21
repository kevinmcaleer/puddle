// Seeds the shop into a MongoDB (a container, FerretDB, or Atlas) with the official client:
//   node scripts/seed-mongodb.mjs mongodb://localhost:27017/shop
//   node scripts/seed-mongodb.mjs 'mongodb://user:password@localhost:27017/shop?authSource=admin'
// The URL's path is the database. The customers and orders collections are dropped and made again with the same
// rows as shop.sqlite, with dates as dates, a nested document, an array, a null and a boolean, an index on each,
// and a view, order_totals, where the server supports views.
import { MongoClient } from 'mongodb';

const url = process.argv[2];
if (!url) {
  console.error('Usage: node scripts/seed-mongodb.mjs <mongodb://[user:password@]host:27017/database[?authSource=admin]>');
  process.exit(2);
}
const database = new URL(url).pathname.slice(1);
if (!database) throw new Error('The URL names no database.');

const client = new MongoClient(url, { serverSelectionTimeoutMS: 5000 });
// The server may still be starting: try for a while.
for (let attempt = 0; ; attempt++) {
  try {
    await client.connect();
    await client.db(database).command({ ping: 1 });
    break;
  } catch (e) {
    if (attempt >= 36 || /Authentication failed/i.test(String(e))) throw e;
    await new Promise((r) => setTimeout(r, 5000));
  }
}
const db = client.db(database);
for (const name of ['order_totals', 'orders', 'customers']) await db.collection(name).drop().catch(() => undefined);

await db.collection('customers').insertMany([
  { _id: 1, name: 'Ada Lovelace', email: 'ada@example.com', signed_up: new Date('2024-01-15T00:00:00Z'), active: true },
  { _id: 2, name: 'Grace Hopper', email: 'grace@example.com', signed_up: new Date('2024-02-20T00:00:00Z'), active: true },
  { _id: 3, name: 'Alan Turing', email: null, signed_up: new Date('2024-03-05T00:00:00Z'), active: false },
]);
await db.collection('orders').insertMany([
  { _id: 101, customer_id: 1, total: 19.99, placed_at: new Date('2024-04-01T09:30:00Z'), status: 'shipped', notes: 'Gift wrap', tags: ['gift', 'express'], shipping: { city: 'London', postcode: 'N1' } },
  { _id: 102, customer_id: 1, total: 5.5, placed_at: new Date('2024-04-02T14:00:00Z'), status: 'placed', tags: [] },
  { _id: 103, customer_id: 2, total: 120, placed_at: new Date('2024-04-03T11:15:00Z'), status: 'returned', tags: ['bulk'], shipping: { city: 'New York' } },
  { _id: 104, customer_id: 3, total: 42.25, placed_at: new Date('2024-04-04T16:45:00Z'), status: 'placed', tags: [] },
]);
await db.collection('customers').createIndex({ email: 1 }, { name: 'customers_email', unique: true, sparse: true });
await db.collection('orders').createIndex({ customer_id: 1, placed_at: -1 }, { name: 'orders_customer' });
let view = 'and the order_totals view';
try {
  await db.createCollection('order_totals', {
    viewOn: 'orders',
    pipeline: [{ $lookup: { from: 'customers', localField: 'customer_id', foreignField: '_id', as: 'customer' } }, { $unwind: '$customer' }, { $project: { _id: 1, name: '$customer.name', total: 1 } }],
  });
} catch (e) {
  view = `(no view: ${e.message})`;
}
const n = await db.collection('orders').countDocuments();
console.log(`Seeded ${database}: ${n} orders ${view}.`);
await client.close();
