// A ClickHouse read (replayed from the exchanges recorded from a ClickHouse engine) loads into DuckDB-WASM with its
// types, through the same staging and CAST path the app uses: the Decimal exact, the Date and Bool as themselves.
// The orders table's Array column loads as JSON, which needs DuckDB's json extension; the Node engine here can't
// fetch extensions, so the table read is checked as Arrow in src/connect/drivers/clickhouse.test.ts and the query
// without it is loaded here.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { compileConnectionLoad } from '../../src/compiler/connectionLoad';
import { clickhouseConnector } from '../../src/connect/drivers/clickhouse';
import { EngineClient } from '../../src/engine/client';
import type { Connection } from '../../src/model';
import { createNodeBackend } from '../helpers/nodeBackend';
import { replayFetch } from '../helpers/replayFetch';

const connection: Connection = { id: 'c', name: 'shop', driver: 'clickhouse', via: 'browser', settings: { url: 'http://127.0.0.1:18123', database: 'shop', user: 'default' }, auth: 'password' };

let engine: EngineClient;
beforeAll(async () => {
  engine = new EngineClient(await createNodeBackend());
});
afterAll(() => engine.close());

describe('a ClickHouse read in DuckDB', () => {
  it('loads a query with the driver’s types: a decimal, a timestamp, a date and a boolean', async () => {
    const r = await clickhouseConnector(replayFetch('clickhouse')).read({ connection, secret: 'puddle' }, { query: 'SELECT c.name, o.total, o.placed_at, o.status, c.signed_up, c.active FROM orders o JOIN customers c ON c.id = o.customer_id ORDER BY o.id', limit: 2 });
    if (!('ipc' in r)) throw new Error('expected a stream');
    await engine.insertArrow('ch_arrow', r.ipc);
    await engine.query(compileConnectionLoad('ch_query', r.columns, { staging: 'ch_arrow' }));
    const described = await engine.describe('SELECT * FROM ch_query');
    expect(described.map((c) => [c.name, c.type])).toEqual([
      ['name', 'VARCHAR'],
      ['total', 'DECIMAL(10,2)'],
      ['placed_at', 'TIMESTAMP'],
      ['status', 'VARCHAR'],
      ['signed_up', 'DATE'],
      ['active', 'BOOLEAN'],
    ]);
    const { table } = await engine.query('SELECT name, sum(total)::VARCHAR AS total, min(placed_at)::VARCHAR AS first, signed_up::VARCHAR AS signed_up, active FROM ch_query GROUP BY ALL');
    expect(table.toArray().map((row) => row.toJSON())).toEqual([{ name: 'Ada Lovelace', total: '25.49', first: '2024-04-01 09:30:00', signed_up: '2024-01-15', active: true }]);
  });
});
