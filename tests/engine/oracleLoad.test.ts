// An Oracle read (replayed from the queries an Oracle Database 23ai answers) loads into DuckDB-WASM with its types,
// through the same staging and CAST path the app uses: NUMBER(10,2) as a decimal of that scale, NUMBER(10,0) whole.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { compileConnectionLoad } from '../../src/compiler/connectionLoad';
import { oracleConnector } from '../../src/connect/drivers/oracle';
import { replay } from '../../src/connect/drivers/oracle.test';
import { EngineClient } from '../../src/engine/client';
import type { Connection } from '../../src/model';
import { createNodeBackend } from '../helpers/nodeBackend';

const connection: Connection = { id: 'c', name: 'shop', driver: 'oracle', via: 'local', settings: { host: 'db', service: 'FREEPDB1', user: 'shop' }, auth: 'password' };

let engine: EngineClient;
beforeAll(async () => {
  engine = new EngineClient(await createNodeBackend());
});
afterAll(() => engine.close());

describe('an Oracle read in DuckDB', () => {
  it('loads a table with NUMBER held by its precision and scale', async () => {
    const r = await oracleConnector(replay()).read({ connection, secret: 'pw' }, { table: { name: 'ORDERS' }, limit: 10 });
    if (!('ipc' in r)) throw new Error('expected a stream');
    await engine.insertArrow('ora_arrow', r.ipc);
    await engine.query(compileConnectionLoad('ora_orders', r.columns, { staging: 'ora_arrow' }));
    const described = await engine.describe('SELECT * FROM ora_orders');
    expect(described.map((c) => [c.name, c.type])).toEqual([
      ['ID', 'BIGINT'],
      ['CUSTOMER_ID', 'BIGINT'],
      ['TOTAL', 'DECIMAL(10,2)'],
      ['PLACED_AT', 'TIMESTAMP'],
      ['STATUS', 'VARCHAR'],
    ]);
    const { table } = await engine.query('SELECT sum("TOTAL")::VARCHAR AS total, min("PLACED_AT")::VARCHAR AS first, count(*) FILTER (WHERE "STATUS" = \'placed\') AS placed FROM ora_orders');
    expect(table.toArray().map((row) => row.toJSON())).toEqual([{ total: '187.74', first: '2024-04-01 09:30:00', placed: 2n }]);
  });

  it('loads a query with a DATE (a timestamp in Oracle) and a NUMBER(1) flag', async () => {
    const r = await oracleConnector(replay()).read({ connection, secret: 'pw' }, { query: 'SELECT c.name, o.total, o.placed_at, o.status, c.signed_up, c.active FROM orders o JOIN customers c ON c.id = o.customer_id ORDER BY o.id', limit: 2 });
    if (!('ipc' in r)) throw new Error('expected a stream');
    await engine.insertArrow('ora_arrow2', r.ipc);
    await engine.query(compileConnectionLoad('ora_query', r.columns, { staging: 'ora_arrow2' }));
    const { table } = await engine.query('SELECT "NAME" AS name, "SIGNED_UP"::VARCHAR AS signed_up, "ACTIVE" AS active FROM ora_query ORDER BY "TOTAL"');
    expect(table.toArray().map((row) => row.toJSON())).toEqual([{ name: 'Ada Lovelace', signed_up: '2024-01-15 00:00:00', active: 1 }, { name: 'Ada Lovelace', signed_up: '2024-01-15 00:00:00', active: 1 }]);
  });
});
