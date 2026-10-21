// A MySQL read (replayed from the queries recorded from MariaDB) loads into DuckDB-WASM with its types, through the
// same staging and CAST path the app uses.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { compileConnectionLoad } from '../../src/compiler/connectionLoad';
import { mysqlConnector } from '../../src/connect/drivers/mysql';
import { replay } from '../../src/connect/drivers/mysql.test';
import { EngineClient } from '../../src/engine/client';
import type { Connection } from '../../src/model';
import { createNodeBackend } from '../helpers/nodeBackend';

const connection: Connection = { id: 'c', name: 'shop', driver: 'mysql', via: 'local', settings: { host: 'db', database: 'shop', user: 'kev' }, auth: 'password' };

let engine: EngineClient;
beforeAll(async () => {
  engine = new EngineClient(await createNodeBackend());
});
afterAll(() => engine.close());

describe('a MySQL read in DuckDB', () => {
  it('loads a table with the driver’s types', async () => {
    const r = await mysqlConnector('mysql', replay()).read({ connection, secret: 'pw' }, { table: { name: 'orders' }, limit: 10 });
    if (!('ipc' in r)) throw new Error('expected a stream');
    await engine.insertArrow('my_arrow', r.ipc);
    await engine.query(compileConnectionLoad('my_orders', r.columns, { staging: 'my_arrow' }));
    const described = await engine.describe('SELECT * FROM my_orders');
    expect(described.map((c) => [c.name, c.type])).toEqual([
      ['id', 'INTEGER'],
      ['customer_id', 'INTEGER'],
      ['total', 'DECIMAL(10,2)'],
      ['placed_at', 'TIMESTAMP'],
      ['status', 'VARCHAR'],
    ]);
    const { table } = await engine.query("SELECT sum(total)::VARCHAR AS total, min(placed_at)::VARCHAR AS first, count(*) FILTER (WHERE status = 'placed') AS placed FROM my_orders");
    expect(table.toArray().map((row) => row.toJSON())).toEqual([{ total: '187.74', first: '2024-04-01 09:30:00', placed: 2n }]);
  });

  it('loads a query with a date and a boolean', async () => {
    const r = await mysqlConnector('mysql', replay()).read({ connection, secret: 'pw' }, { query: 'SELECT c.name, o.total, o.placed_at, o.status, c.signed_up, c.active FROM orders o JOIN customers c ON c.id = o.customer_id ORDER BY o.id', limit: 2 });
    if (!('ipc' in r)) throw new Error('expected a stream');
    await engine.insertArrow('my_arrow2', r.ipc);
    await engine.query(compileConnectionLoad('my_query', r.columns, { staging: 'my_arrow2' }));
    const { table } = await engine.query('SELECT name, signed_up::VARCHAR AS signed_up, active FROM my_query ORDER BY name');
    expect(table.toArray().map((row) => row.toJSON())).toEqual([{ name: 'Ada Lovelace', signed_up: '2024-01-15', active: true }, { name: 'Ada Lovelace', signed_up: '2024-01-15', active: true }]);
  });
});
