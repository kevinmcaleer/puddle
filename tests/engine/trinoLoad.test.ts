// A Trino read (replayed from recorded exchanges) loads into DuckDB-WASM with its types, through the same staging
// and CAST path the app uses. The orders table's array loads as JSON, which needs an extension the Node engine
// can't fetch, so the query without it is loaded here and the table read is checked as Arrow in the driver's test.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { compileConnectionLoad } from '../../src/compiler/connectionLoad';
import { trinoConnector } from '../../src/connect/drivers/trino';
import { EngineClient } from '../../src/engine/client';
import type { Connection } from '../../src/model';
import { createNodeBackend } from '../helpers/nodeBackend';
import { replayFetch } from '../helpers/replayFetch';

const connection: Connection = { id: 'c', name: 'shop', driver: 'trino', via: 'browser', settings: { url: 'http://127.0.0.1:18080', catalog: 'memory', schema: 'shop', user: 'puddle' }, auth: 'password' };

let engine: EngineClient;
beforeAll(async () => {
  engine = new EngineClient(await createNodeBackend());
});
afterAll(() => engine.close());

describe('a Trino read in DuckDB', () => {
  it('loads a query with the driver’s types: a decimal, a timestamp(3), a date and a boolean', async () => {
    const r = await trinoConnector(replayFetch('trino')).read({ connection }, { query: 'SELECT c.name, o.total, o.placed_at, o.status, c.signed_up, c.active FROM orders o JOIN customers c ON c.id = o.customer_id ORDER BY o.id', limit: 2 });
    if (!('ipc' in r)) throw new Error('expected a stream');
    await engine.insertArrow('tr_arrow', r.ipc);
    await engine.query(compileConnectionLoad('tr_query', r.columns, { staging: 'tr_arrow' }));
    const described = await engine.describe('SELECT * FROM tr_query');
    expect(described.map((c) => [c.name, c.type])).toEqual([
      ['name', 'VARCHAR'],
      ['total', 'DECIMAL(10,2)'],
      ['placed_at', 'TIMESTAMP'],
      ['status', 'VARCHAR'],
      ['signed_up', 'DATE'],
      ['active', 'BOOLEAN'],
    ]);
    const { table } = await engine.query('SELECT name, sum(total)::VARCHAR AS total, min(placed_at)::VARCHAR AS first, signed_up::VARCHAR AS signed_up, active FROM tr_query GROUP BY ALL');
    expect(table.toArray().map((row) => row.toJSON())).toEqual([{ name: 'Ada Lovelace', total: '25.49', first: '2024-04-01 09:30:00', signed_up: '2024-01-15', active: true }]);
  });
});
