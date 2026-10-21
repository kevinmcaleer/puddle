// A LibSQL read (replayed from the exchanges recorded from a LibSQL server) loads into DuckDB-WASM with its types,
// through the same staging and CAST path the app uses: the DECIMAL exact, the boolean as itself, dates as text
// (SQLite keeps them as text; the Parse dates step reads them).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { compileConnectionLoad } from '../../src/compiler/connectionLoad';
import { hranaConnector } from '../../src/connect/drivers/hrana';
import { EngineClient } from '../../src/engine/client';
import type { Connection } from '../../src/model';
import { createNodeBackend } from '../helpers/nodeBackend';
import { replayFetch } from '../helpers/replayFetch';

const connection: Connection = { id: 'c', name: 'shop', driver: 'libsql', via: 'browser', settings: { url: 'http://127.0.0.1:18081' }, auth: 'token' };

let engine: EngineClient;
beforeAll(async () => {
  engine = new EngineClient(await createNodeBackend());
});
afterAll(() => engine.close());

describe('a LibSQL read in DuckDB', () => {
  it('loads a table with the declared types: a decimal, a boolean default and dates as text', async () => {
    const r = await hranaConnector('libsql', replayFetch('libsql')).read({ connection, secret: 'puddle-token' }, { table: { name: 'orders' }, limit: 10 });
    if (!('ipc' in r)) throw new Error('expected a stream');
    await engine.insertArrow('ls_arrow', r.ipc);
    await engine.query(compileConnectionLoad('ls_orders', r.columns, { staging: 'ls_arrow' }));
    const described = await engine.describe('SELECT * FROM ls_orders');
    expect(described.map((c) => [c.name, c.type])).toEqual([
      ['id', 'BIGINT'],
      ['customer_id', 'BIGINT'],
      ['total', 'DECIMAL(10,2)'],
      ['placed_at', 'VARCHAR'],
      ['status', 'VARCHAR'],
      ['notes', 'VARCHAR'],
      ['tags', 'VARCHAR'],
    ]);
    const { table } = await engine.query('SELECT customer_id, sum(total)::VARCHAR AS total, min(placed_at) AS first FROM ls_orders GROUP BY customer_id ORDER BY customer_id');
    expect(table.toArray().map((row) => row.toJSON())).toEqual([
      { customer_id: 1n, total: '25.49', first: '2024-04-01 09:30:00' },
      { customer_id: 2n, total: '120.00', first: '2024-04-03 11:15:00' },
      { customer_id: 3n, total: '42.25', first: '2024-04-04 16:45:00' },
    ]);
  });
});
