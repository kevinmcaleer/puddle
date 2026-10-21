// Seeds the shop into a DynamoDB (DynamoDB Local, the stand-in, or a real region) over its JSON API, signing each
// request with Signature V4:
//   node scripts/seed-dynamodb.mjs 'dynamodb://AKIDEXAMPLE:secretexample@eu-west-2?endpoint=http://127.0.0.1:18092'
// The access key id and secret access key are the URL's user and password; the endpoint is left out for the real
// service. Tables already there are dropped and made again: customers (id), orders (customer_id, id) with an index
// on the status, holding the same rows as shop.sqlite with a map, a list, a null and a boolean.
import { createHash, createHmac } from 'node:crypto';

const url = process.argv[2];
if (!url) {
  console.error('Usage: node scripts/seed-dynamodb.mjs <dynamodb://accessKeyId:secretAccessKey@region[?endpoint=…]>');
  process.exit(2);
}
const u = new URL(url);
const region = u.hostname;
const endpoint = (u.searchParams.get('endpoint') ?? `https://dynamodb.${region}.amazonaws.com`).replace(/\/+$/, '');
const accessKeyId = decodeURIComponent(u.username);
const secretAccessKey = decodeURIComponent(u.password);

const sha256 = (s) => createHash('sha256').update(s).digest('hex');
const hmac = (key, s) => createHmac('sha256', key).update(s).digest();

async function call(target, body) {
  const text = JSON.stringify(body);
  const date = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const day = date.slice(0, 8);
  const host = new URL(endpoint).host;
  const headers = { 'content-type': 'application/x-amz-json-1.0', host, 'x-amz-content-sha256': sha256(text), 'x-amz-date': date, 'x-amz-target': `DynamoDB_20120810.${target}` };
  const names = Object.keys(headers).sort();
  const canonical = ['POST', '/', '', ...names.map((n) => `${n}:${headers[n]}`), '', names.join(';'), sha256(text)].join('\n');
  const scope = `${day}/${region}/dynamodb/aws4_request`;
  let key = `AWS4${secretAccessKey}`;
  for (const part of [day, region, 'dynamodb', 'aws4_request']) key = hmac(key, part);
  const signature = createHmac('sha256', key).update(['AWS4-HMAC-SHA256', date, scope, sha256(canonical)].join('\n')).digest('hex');
  const { host: _h, ...sent } = headers;
  void _h;
  const res = await fetch(`${endpoint}/`, { method: 'POST', headers: { ...sent, Authorization: `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${scope}, SignedHeaders=${names.join(';')}, Signature=${signature}` }, body: text });
  const answer = await res.json();
  if (!res.ok) throw Object.assign(new Error(`${target}: ${answer.__type ?? ''} ${answer.message ?? answer.Message ?? ''}`), { type: String(answer.__type ?? '').replace(/^.*#/, '') });
  return answer;
}

// The server may still be starting: try for a while.
for (let attempt = 0; ; attempt++) {
  try {
    await call('ListTables', {});
    break;
  } catch (e) {
    if (attempt >= 30 || /Signature|Unrecognized/.test(String(e))) throw e;
    await new Promise((r) => setTimeout(r, 1000));
  }
}
for (const name of ['customers', 'orders']) {
  try {
    await call('DeleteTable', { TableName: name });
  } catch (e) {
    if (e.type !== 'ResourceNotFoundException') throw e;
  }
}
const waitActive = async (name) => {
  for (let i = 0; i < 60; i++) {
    const { Table } = await call('DescribeTable', { TableName: name });
    if (Table.TableStatus === 'ACTIVE') return;
    await new Promise((r) => setTimeout(r, 1000));
  }
};
await call('CreateTable', { TableName: 'customers', KeySchema: [{ AttributeName: 'id', KeyType: 'HASH' }], AttributeDefinitions: [{ AttributeName: 'id', AttributeType: 'N' }], BillingMode: 'PAY_PER_REQUEST' });
await call('CreateTable', {
  TableName: 'orders',
  KeySchema: [{ AttributeName: 'customer_id', KeyType: 'HASH' }, { AttributeName: 'id', KeyType: 'RANGE' }],
  AttributeDefinitions: [{ AttributeName: 'customer_id', AttributeType: 'N' }, { AttributeName: 'id', AttributeType: 'N' }, { AttributeName: 'status', AttributeType: 'S' }],
  GlobalSecondaryIndexes: [{ IndexName: 'orders_status', KeySchema: [{ AttributeName: 'status', KeyType: 'HASH' }], Projection: { ProjectionType: 'ALL' } }],
  BillingMode: 'PAY_PER_REQUEST',
});
await waitActive('customers');
await waitActive('orders');
const customers = [
  { id: { N: '1' }, name: { S: 'Ada Lovelace' }, email: { S: 'ada@example.com' }, signed_up: { S: '2024-01-15' }, active: { BOOL: true } },
  { id: { N: '2' }, name: { S: 'Grace Hopper' }, email: { S: 'grace@example.com' }, signed_up: { S: '2024-02-20' }, active: { BOOL: true } },
  { id: { N: '3' }, name: { S: 'Alan Turing' }, email: { NULL: true }, signed_up: { S: '2024-03-05' }, active: { BOOL: false } },
];
const orders = [
  { id: { N: '101' }, customer_id: { N: '1' }, total: { N: '19.99' }, placed_at: { S: '2024-04-01T09:30:00Z' }, status: { S: 'shipped' }, notes: { S: 'Gift wrap' }, tags: { L: [{ S: 'gift' }, { S: 'express' }] }, shipping: { M: { city: { S: 'London' }, postcode: { S: 'N1' } } } },
  { id: { N: '102' }, customer_id: { N: '1' }, total: { N: '5.5' }, placed_at: { S: '2024-04-02T14:00:00Z' }, status: { S: 'placed' }, tags: { L: [] } },
  { id: { N: '103' }, customer_id: { N: '2' }, total: { N: '120' }, placed_at: { S: '2024-04-03T11:15:00Z' }, status: { S: 'returned' }, tags: { L: [{ S: 'bulk' }] }, shipping: { M: { city: { S: 'New York' } } } },
  { id: { N: '104' }, customer_id: { N: '3' }, total: { N: '42.25' }, placed_at: { S: '2024-04-04T16:45:00Z' }, status: { S: 'placed' }, tags: { L: [] } },
];
for (const Item of customers) await call('PutItem', { TableName: 'customers', Item });
for (const Item of orders) await call('PutItem', { TableName: 'orders', Item });
const { Count } = await call('Scan', { TableName: 'orders', Select: 'COUNT' });
console.log(`Seeded ${region} at ${new URL(endpoint).host}: ${Count ?? orders.length} orders.`);
