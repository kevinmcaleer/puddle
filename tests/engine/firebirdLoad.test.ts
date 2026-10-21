// A Firebird read (replayed from the queries recorded from Firebird 3.0) loads into DuckDB-WASM with its types,
// through the same staging and CAST path the app uses.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { compileConnectionLoad } from '../../src/compiler/connectionLoad';
import { firebirdConnector } from '../../src/connect/drivers/firebird';
import { replay } from '../../src/connect/drivers/firebird.test';
import { EngineClient } from '../../src/engine/client';
import type { Connection } from '../../src/model';
import { createNodeBackend } from '../helpers/nodeBackend';

const connection: Connection = { id: 'c', name: 'shop', driver: 'firebird', via: 'local', settings: { host: 'db', database: '/data/shop.fdb', user: 'SYSDBA' }, auth: 'password' };

let engine: EngineClient;
beforeAll(async () => {
  engine = new EngineClient(await createNodeBackend());
});
afterAll(() => engine.close());

describe('a Firebird read in DuckDB', () => {
  it('loads a table with the driver’s types, the text BLOB as text', async () => {
    const r = await firebirdConnector(replay()).read({ connection, secret: 'pw' }, { table: { name: 'ORDERS' }, limit: 10 });
    if (!('ipc' in r)) throw new Error('expected a stream');
    await engine.insertArrow('fb_arrow', r.ipc);
    await engine.query(compileConnectionLoad('fb_orders', r.columns, { staging: 'fb_arrow' }));
    const described = await engine.describe('SELECT * FROM fb_orders');
    expect(described.map((c) => [c.name, c.type])).toEqual([
      ['ID', 'INTEGER'],
      ['CUSTOMER_ID', 'INTEGER'],
      ['TOTAL', 'DECIMAL(18,2)'],
      ['PLACED_AT', 'TIMESTAMP'],
      ['STATUS', 'VARCHAR'],
      ['NOTES', 'VARCHAR'],
    ]);
    const { table } = await engine.query('SELECT sum("TOTAL")::VARCHAR AS total, min("PLACED_AT")::VARCHAR AS first, count(*) FILTER (WHERE "STATUS" = \'placed\') AS placed, max("NOTES") AS note FROM fb_orders');
    expect(table.toArray().map((row) => row.toJSON())).toEqual([{ total: '187.74', first: '2024-04-01 09:30:00', placed: 2n, note: 'Gift wrap' }]);
  });

  it('loads a query with a date and a boolean', async () => {
    const r = await firebirdConnector(replay()).read({ connection, secret: 'pw' }, { query: 'SELECT c.name, o.total, o.placed_at, o.status, c.signed_up, c.active FROM orders o JOIN customers c ON c.id = o.customer_id ORDER BY o.id', limit: 2 });
    if (!('ipc' in r)) throw new Error('expected a stream');
    await engine.insertArrow('fb_arrow2', r.ipc);
    await engine.query(compileConnectionLoad('fb_query', r.columns, { staging: 'fb_arrow2' }));
    const { table } = await engine.query('SELECT "NAME" AS name, "SIGNED_UP"::VARCHAR AS signed_up, "ACTIVE" AS active FROM fb_query ORDER BY name');
    expect(table.toArray().map((row) => row.toJSON())).toEqual([{ name: 'Ada Lovelace', signed_up: '2024-01-15', active: true }, { name: 'Ada Lovelace', signed_up: '2024-01-15', active: true }]);
  });
});
