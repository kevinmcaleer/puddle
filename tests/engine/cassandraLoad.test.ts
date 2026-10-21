// A Cassandra read (replayed from the calls recorded from a Cassandra 5) loads into DuckDB-WASM with its declared
// types, through the same staging and CAST path the app uses: the int as an INTEGER, the date as a DATE, the
// decimal exact and the timestamp as a TIMESTAMP. A set or map column loads as JSON, which needs DuckDB's json
// extension the Node engine can't fetch, so those are checked as Arrow in src/connect/drivers/cassandra.test.ts.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { compileConnectionLoad } from '../../src/compiler/connectionLoad';
import { cassandraConnector, type CqlClientLike } from '../../src/connect/drivers/cassandra';
import { EngineClient } from '../../src/engine/client';
import type { Connection } from '../../src/model';
import { createNodeBackend } from '../helpers/nodeBackend';
import { replayClient } from '../helpers/replayCalls';

const connection: Connection = { id: 'c', name: 'shop', driver: 'cassandra', via: 'local', settings: { host: '127.0.0.1', port: 19042, keyspace: 'shop', datacenter: 'datacenter1' }, auth: 'password' };

let engine: EngineClient;
beforeAll(async () => {
  engine = new EngineClient(await createNodeBackend());
});
afterAll(() => engine.close());

describe('a Cassandra read in DuckDB', () => {
  it('loads a query with its declared types: the int, the date, the boolean, the decimal exact and the timestamp', async () => {
    const connector = cassandraConnector('cassandra', async () => replayClient<CqlClientLike>('cassandra'));
    const customers = await connector.read({ connection, secret: '' }, { query: 'SELECT id, name, email, signed_up, active FROM shop.customers', limit: 10 });
    if (!('ipc' in customers)) throw new Error('expected a stream');
    await engine.insertArrow('cq_arrow', customers.ipc);
    await engine.query(compileConnectionLoad('cq_customers', customers.columns, { staging: 'cq_arrow' }));
    expect((await engine.describe('SELECT * FROM cq_customers')).map((c) => [c.name, c.type])).toEqual([
      ['id', 'INTEGER'],
      ['name', 'VARCHAR'],
      ['email', 'VARCHAR'],
      ['signed_up', 'DATE'],
      ['active', 'BOOLEAN'],
    ]);
    const { table } = await engine.query('SELECT count(*)::INTEGER AS n, count(email)::INTEGER AS emails, sum(active::INTEGER)::INTEGER AS active, min(signed_up)::VARCHAR AS first FROM cq_customers');
    expect(table.toArray().map((row) => row.toJSON())).toEqual([{ n: 3, emails: 2, active: 2, first: '2024-01-15' }]);

    const orders = await connector.read({ connection, secret: '' }, { query: 'SELECT id, total, placed_at FROM shop.orders', limit: 10 });
    if (!('ipc' in orders)) throw new Error('expected a stream');
    await engine.insertArrow('cq_orders_arrow', orders.ipc);
    await engine.query(compileConnectionLoad('cq_orders', orders.columns, { staging: 'cq_orders_arrow' }));
    expect((await engine.describe('SELECT * FROM cq_orders')).map((c) => [c.name, c.type])).toEqual([
      ['id', 'INTEGER'],
      ['total', 'DECIMAL(38,9)'],
      ['placed_at', 'TIMESTAMP'],
    ]);
    const sums = await engine.query('SELECT sum(total)::VARCHAR AS total, min(placed_at)::VARCHAR AS first FROM cq_orders');
    expect(sums.table.toArray().map((row) => row.toJSON())).toEqual([{ total: '187.740000000', first: '2024-04-01 09:30:00' }]);
  });
});
