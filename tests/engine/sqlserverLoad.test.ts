// A SQL Server read (replayed from the queries a SQL Server 2022 answers) loads into DuckDB-WASM with its types,
// through the same staging and CAST path the app uses: money as a four-place decimal, datetime2 as a timestamp.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { compileConnectionLoad } from '../../src/compiler/connectionLoad';
import { sqlserverConnector } from '../../src/connect/drivers/sqlserver';
import { replay } from '../../src/connect/drivers/sqlserver.test';
import { EngineClient } from '../../src/engine/client';
import type { Connection } from '../../src/model';
import { createNodeBackend } from '../helpers/nodeBackend';

const connection: Connection = { id: 'c', name: 'shop', driver: 'sqlserver', via: 'local', settings: { host: 'db', database: 'shop', user: 'sa' }, auth: 'password' };

let engine: EngineClient;
beforeAll(async () => {
  engine = new EngineClient(await createNodeBackend());
});
afterAll(() => engine.close());

describe('a SQL Server read in DuckDB', () => {
  it('loads a table with the driver’s types, money and datetime2 included', async () => {
    const r = await sqlserverConnector(replay()).read({ connection, secret: 'pw' }, { table: { name: 'orders' }, limit: 10 });
    if (!('ipc' in r)) throw new Error('expected a stream');
    await engine.insertArrow('ms_arrow', r.ipc);
    await engine.query(compileConnectionLoad('ms_orders', r.columns, { staging: 'ms_arrow' }));
    const described = await engine.describe('SELECT * FROM ms_orders');
    expect(described.map((c) => [c.name, c.type])).toEqual([
      ['id', 'INTEGER'],
      ['customer_id', 'INTEGER'],
      ['total', 'DECIMAL(10,2)'],
      ['placed_at', 'TIMESTAMP'],
      ['status', 'VARCHAR'],
      ['paid', 'DECIMAL(19,4)'],
    ]);
    const { table } = await engine.query('SELECT sum(total)::VARCHAR AS total, sum(paid)::VARCHAR AS paid, min(placed_at)::VARCHAR AS first, count(*) FILTER (WHERE paid IS NULL) AS unpaid FROM ms_orders');
    expect(table.toArray().map((row) => row.toJSON())).toEqual([{ total: '187.74', paid: '139.9900', first: '2024-04-01 09:30:00', unpaid: 2n }]);
  });

  it('loads a query with a date and a bit', async () => {
    const r = await sqlserverConnector(replay()).read({ connection, secret: 'pw' }, { query: 'SELECT c.name, o.total, o.placed_at, o.status, c.signed_up, c.active FROM orders o JOIN customers c ON c.id = o.customer_id ORDER BY o.id', limit: 2 });
    if (!('ipc' in r)) throw new Error('expected a stream');
    await engine.insertArrow('ms_arrow2', r.ipc);
    await engine.query(compileConnectionLoad('ms_query', r.columns, { staging: 'ms_arrow2' }));
    const { table } = await engine.query('SELECT name, signed_up::VARCHAR AS signed_up, active FROM ms_query ORDER BY total');
    expect(table.toArray().map((row) => row.toJSON())).toEqual([{ name: 'Ada Lovelace', signed_up: '2024-01-15', active: true }, { name: 'Ada Lovelace', signed_up: '2024-01-15', active: true }]);
  });
});
