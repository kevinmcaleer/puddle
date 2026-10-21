// Seeds the shop into a Redis (a container, Dragonfly, or any Redis-compatible server) with node-redis:
//   node scripts/seed-redis.mjs redis://:password@localhost:6379/0
// The keys the seed owns (user:*, order:*, orders:recent, leaderboard, visits, events) are deleted and written
// again: the customers as hashes, the orders as hashes with their tags as sets, a list of recent orders, a sorted
// set, a string counter and a stream, so every type the driver reads is there.
import { createClient } from 'redis';

const url = process.argv[2];
if (!url) {
  console.error('Usage: node scripts/seed-redis.mjs <redis://[user]:[password]@host:6379/db>');
  process.exit(2);
}
const client = createClient({ url, socket: { connectTimeout: 5000, reconnectStrategy: false } });
client.on('error', () => undefined);
// The server may still be starting: try for a while.
for (let attempt = 0; ; attempt++) {
  try {
    await client.connect();
    break;
  } catch (e) {
    if (attempt >= 36 || /WRONGPASS|NOAUTH|invalid password/i.test(String(e))) throw e;
    await new Promise((r) => setTimeout(r, 5000));
  }
}
const send = (...args) => client.sendCommand(args.map(String));

for (const pattern of ['user:*', 'order:*', 'orders:*', 'leaderboard', 'visits', 'events']) {
  let cursor = '0';
  do {
    const [next, keys] = await send('SCAN', cursor, 'MATCH', pattern, 'COUNT', '500');
    cursor = String(next);
    if (keys.length) await send('DEL', ...keys);
  } while (cursor !== '0');
}

const customers = [
  { id: 1, name: 'Ada Lovelace', email: 'ada@example.com', signed_up: '2024-01-15', active: '1' },
  { id: 2, name: 'Grace Hopper', email: 'grace@example.com', signed_up: '2024-02-20', active: '1' },
  { id: 3, name: 'Alan Turing', signed_up: '2024-03-05', active: '0' },
];
const orders = [
  { id: 101, customer_id: 1, total: '19.99', placed_at: '2024-04-01T09:30:00Z', status: 'shipped', notes: 'Gift wrap', tags: ['gift', 'express'] },
  { id: 102, customer_id: 1, total: '5.5', placed_at: '2024-04-02T14:00:00Z', status: 'placed', tags: [] },
  { id: 103, customer_id: 2, total: '120', placed_at: '2024-04-03T11:15:00Z', status: 'returned', tags: ['bulk'] },
  { id: 104, customer_id: 3, total: '42.25', placed_at: '2024-04-04T16:45:00Z', status: 'placed', tags: [] },
];
for (const { id, ...fields } of customers) await send('HSET', `user:${id}`, ...Object.entries(fields).flat());
for (const { id, tags, ...fields } of orders) {
  await send('HSET', `order:${id}`, ...Object.entries(fields).flat());
  if (tags.length) await send('SADD', `order:${id}:tags`, ...tags);
}
await send('RPUSH', 'orders:recent', '104', '103', '102', '101');
await send('ZADD', 'leaderboard', '145.49', 'user:1', '120', 'user:2', '42.25', 'user:3');
await send('SET', 'visits', '42');
await send('XADD', 'events', '1712000000000-0', 'kind', 'signup', 'user', '1');
await send('XADD', 'events', '1712000001000-0', 'kind', 'order', 'order', '101');
const n = await send('DBSIZE');
console.log(`Seeded ${new URL(url).host}: ${n} keys.`);
await client.close();
