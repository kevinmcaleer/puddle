// The DynamoDB driver against the exchanges recorded from a DynamoDB (tests/fixtures/db/dynamodb/, regenerated with
// scripts/record-database.mjs dynamodb <url>; the stand-in checked each request's signature), and against one that
// refuses a part.
import { tableFromIPC } from 'apache-arrow';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { exchangesFor, replayFetch } from '../../../tests/helpers/replayFetch';
import type { Connection } from '../../model';
import { ConnectorError, type CatalogDetail } from '../types';
import { catalogFromTables, detailFromTables, dynamoConfigFor, dynamoConnector, dynamoProblem, plainItem, plainValue, quoteTable, statementProblem } from './dynamodb';

const recorded = JSON.parse(readFileSync(join(__dirname, '../../../tests/fixtures/db/dynamodb/catalog.json'), 'utf8')) as { test: unknown; catalog: unknown; detail: CatalogDetail };

const connection: Connection = { id: 'c', name: 'shop', driver: 'dynamodb', via: 'browser', settings: { region: 'eu-west-2', accessKeyId: 'AKIDEXAMPLE', endpoint: 'http://127.0.0.1:18092' }, auth: 'aws' };
const ctx = { connection, secret: 'secretexample' };
const dated = (d: CatalogDetail) => ({ ...d, tables: d.tables.map((t) => ({ ...t, note: t.note?.replace(/\d{4}-\d{2}-\d{2}$/, 'DATE') })) });

describe('the DynamoDB driver', () => {
  it('tests, catalogues and documents the shop as recorded: the keys first, the rest inferred from the items', async () => {
    const c = dynamoConnector(replayFetch('dynamodb'));
    expect(await c.test(ctx)).toEqual(recorded.test);
    expect(await c.catalog(ctx)).toEqual(recorded.catalog);
    expect(dated(await c.document!(ctx))).toEqual(dated(recorded.detail));
    const orders = recorded.detail.tables.find((t) => t.name === 'orders')!;
    expect(orders.columns.slice(0, 2).map((x) => [x.name, x.pk, x.unique])).toEqual([
      ['customer_id', true, false],
      ['id', true, false],
    ]);
    expect(orders.indexes).toEqual([{ name: 'orders_status', columns: ['status'], unique: false }]);
    expect(orders.note).toMatch(/^Partition key customer_id, sort key id\. Inferred from 4 documents on /);
    expect(orders.columns.find((x) => x.name === 'shipping.city')).toMatchObject({ type: 'string', notNull: false, note: 'present in 50% of documents' });
    expect(recorded.detail.tables.find((t) => t.name === 'customers')!.columns.find((x) => x.name === 'id')).toMatchObject({ pk: true, unique: true, notNull: true, type: 'integer' });
  });

  it('reads a table by scanning it: maps flattened, lists as JSON text, numbers as numbers, the null as null', async () => {
    const f = replayFetch('dynamodb');
    const r = await dynamoConnector(f).read(ctx, { table: { name: 'orders' }, limit: 10 });
    if (!('ipc' in r)) throw new Error('expected a stream');
    expect(r.rows).toBe(4);
    expect(r.columns).toEqual([
      { name: 'id', sqlType: 'BIGINT' },
      { name: 'customer_id', sqlType: 'BIGINT' },
      { name: 'total', sqlType: 'DOUBLE' },
      { name: 'placed_at', sqlType: 'VARCHAR' },
      { name: 'status', sqlType: 'VARCHAR' },
      { name: 'notes', sqlType: 'VARCHAR' },
      { name: 'tags', sqlType: 'JSON' },
      { name: 'shipping.city', sqlType: 'VARCHAR' },
      { name: 'shipping.postcode', sqlType: 'VARCHAR' },
    ]);
    const t = tableFromIPC(r.ipc);
    expect(t.getChild('total')!.toArray()).toEqual(new Float64Array([19.99, 5.5, 120, 42.25]));
    expect(t.getChild('tags')!.toArray()).toEqual(['["gift","express"]', '[]', '["bulk"]', '[]']);
    expect(t.getChild('shipping.postcode')!.toArray()).toEqual(['N1', null, null, null]);
    expect(f.calls.map((x) => JSON.parse(x.body!) as { TableName?: string; Limit?: number })).toContainEqual({ TableName: 'orders', Limit: 10 });
  });

  it('reads a PartiQL SELECT with ExecuteStatement, bounded by the row limit, and refuses anything else before sending it', async () => {
    const f = replayFetch('dynamodb');
    const c = dynamoConnector(f);
    const r = await c.read(ctx, { query: 'SELECT * FROM "orders" WHERE customer_id = 1 ORDER BY id', limit: 2 });
    if (!('ipc' in r)) throw new Error('expected a stream');
    expect(r.rows).toBe(2);
    expect(tableFromIPC(r.ipc).getChild('id')!.toArray()).toEqual(new BigInt64Array([101n, 102n]));
    const sent = f.calls.length;
    await expect(c.read(ctx, { query: 'DELETE FROM "orders" WHERE id = 101' })).rejects.toThrow('Only a SELECT can run here, not DELETE.');
    await expect(c.read(ctx, { query: 'SELECT * FROM "orders"; INSERT INTO "orders" VALUE {}' })).rejects.toThrow(/One statement at a time/);
    await expect(c.read(ctx, {})).rejects.toThrow('Choose a table or write a query.');
    expect(f.calls.length).toBe(sent);
    expect(statementProblem('')).toBe('The query is empty.');
    expect(statementProblem(`SELECT * FROM "orders" WHERE status = 'delete'`)).toBeUndefined();
  });

  it('says a failure in plain words, without the keys', async () => {
    const config = dynamoConfigFor(ctx);
    expect(dynamoProblem(400, JSON.stringify({ __type: 'com.amazonaws.dynamodb.v20120810#UnrecognizedClientException', message: 'The security token included in the request is invalid.' }), config).message).toBe('DynamoDB refused the access key id or secret access key.');
    expect(dynamoProblem(400, JSON.stringify({ __type: 'com.amazon.coral.service#InvalidSignatureException', message: 'x' }), config).message).toBe('DynamoDB refused the access key id or secret access key.');
    expect(dynamoProblem(400, JSON.stringify({ __type: '#ResourceNotFoundException', message: 'Requested resource not found' }), config).message).toBe('There is no such table in eu-west-2.');
    expect(dynamoProblem(400, JSON.stringify({ __type: '#AccessDeniedException', Message: 'User is not authorized' }), config).message).toBe('The access key may not do that: User is not authorized');
    expect(dynamoProblem(400, JSON.stringify({ __type: '#ProvisionedThroughputExceededException', message: 'x' }), config).message).toBe('DynamoDB is throttling the read; try a smaller row limit or later.');
    expect(dynamoProblem(400, JSON.stringify({ __type: '#ValidationException', message: 'Statement wasn’t well formed' }), config).message).toBe('DynamoDB answered: Statement wasn’t well formed');
    expect(dynamoProblem(503, 'gateway', config).message).toBe('DynamoDB answered: gateway');
    const refused = dynamoConnector(replayFetch('dynamodb', { test: () => true, status: 400, response: JSON.stringify({ __type: '#UnrecognizedClientException', message: 'x' }) }));
    expect(await refused.test(ctx)).toEqual({ ok: false, reason: 'DynamoDB refused the access key id or secret access key.' });
    const notDynamo = dynamoConnector(replayFetch('dynamodb', { test: () => true, status: 200, response: '<html>' }));
    await expect(notDynamo.catalog(ctx)).rejects.toThrow('Nothing at 127.0.0.1:18092 answers as DynamoDB.');
    expect(new ConnectorError('x').name).toBe('ConnectorError');
  });

  it('turns the settings into a config (the region’s own endpoint, a session token after the secret) and attribute values into plain ones', () => {
    expect(dynamoConfigFor(ctx)).toEqual({ region: 'eu-west-2', endpoint: 'http://127.0.0.1:18092', credentials: { accessKeyId: 'AKIDEXAMPLE', secretAccessKey: 'secretexample' }, depth: 2 });
    expect(dynamoConfigFor({ connection: { ...connection, settings: { region: 'us-east-1', accessKeyId: 'k', depth: 3 } }, secret: 's t' })).toEqual({ region: 'us-east-1', endpoint: 'https://dynamodb.us-east-1.amazonaws.com', credentials: { accessKeyId: 'k', secretAccessKey: 's', sessionToken: 't' }, depth: 3 });
    expect(() => dynamoConfigFor({ connection: { ...connection, settings: {} } })).toThrow('Give the region.');
    expect(() => dynamoConfigFor({ connection: { ...connection, settings: { region: 'r' } } })).toThrow('Give the access key id.');
    expect(() => dynamoConfigFor({ connection: { ...connection, settings: { region: 'r', accessKeyId: 'k' } } })).toThrow('Give the secret access key to sign in.');
    expect(plainValue({ N: '19.99' })).toBe(19.99);
    expect(plainValue({ N: '12345678901234567890' })).toBe('12345678901234567890');
    expect(plainValue({ B: 'AQI=' })).toEqual(new Uint8Array([1, 2]));
    expect(plainValue({ NULL: true })).toBeNull();
    expect(plainValue({ SS: ['a'] })).toEqual(['a']);
    expect(plainValue({ NS: ['1', '2.5'] })).toEqual([1, 2.5]);
    expect(plainValue({ BS: ['AQ=='] })).toEqual(['AQ==']);
    expect(plainItem({ a: { M: { b: { L: [{ BOOL: true }, { S: 'x' }] } } } })).toEqual({ a: { b: [true, 'x'] } });
    expect(quoteTable('my"table')).toBe('"my""table"');
    const info = [{ description: { TableName: 't', KeySchema: [{ AttributeName: 'pk', KeyType: 'HASH' as const }], AttributeDefinitions: [{ AttributeName: 'pk', AttributeType: 'B' as const }] }, sample: [] }];
    expect(catalogFromTables(info, 2)).toEqual({ tables: [{ name: 't', kind: 'table', columns: [{ name: 'pk', type: 'BLOB', nullable: false }] }] });
    expect(detailFromTables(info, new Date('2026-10-21'), 2).tables[0]!.columns).toEqual([{ name: 'pk', type: 'binary', pk: true, unique: true, notNull: true, increment: false }]);
    expect(exchangesFor('dynamodb').every((e) => !/secretexample|Signature/.test(`${e.url}${e.body ?? ''}`))).toBe(true);
  });
});
