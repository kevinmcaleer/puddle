// A Snowflake read (replayed from recorded exchanges) loads into DuckDB-WASM with its types, through the same staging
// and CAST path the app uses. The orders table's array and object load as JSON, which needs an extension the Node
// engine can't fetch, so the query without them is loaded here and the table read is checked as Arrow in the
// driver's test.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { compileConnectionLoad } from '../../src/compiler/connectionLoad';
import { snowflakeConnector } from '../../src/connect/drivers/snowflake';
import { EngineClient } from '../../src/engine/client';
import type { Connection } from '../../src/model';
import { createNodeBackend } from '../helpers/nodeBackend';
import { replayFetch } from '../helpers/replayFetch';
import { testPrivateKeyPem } from '../helpers/testKey';

const connection: Connection = { id: 'c', name: 'shop', driver: 'snowflake', via: 'local', settings: { account: 'xy12345.eu-west-2.aws', user: 'puddle', warehouse: 'compute_wh', database: 'shop', schema: 'public', url: 'http://127.0.0.1:18091' }, auth: 'keypair' };

let engine: EngineClient;
beforeAll(async () => {
  engine = new EngineClient(await createNodeBackend());
});
afterAll(() => engine.close());

describe('a Snowflake read in DuckDB', () => {
  it('loads a query with the driver’s types: a NUMBER(10,2), a timestamp, a date and a boolean', async () => {
    const r = await snowflakeConnector(replayFetch('snowflake')).read({ connection, secret: await testPrivateKeyPem() }, { query: 'SELECT c.name, o.total, o.placed_at, o.status, c.signed_up, c.active FROM orders o JOIN customers c ON c.id = o.customer_id ORDER BY o.id', limit: 2 });
    if (!('ipc' in r)) throw new Error('expected a stream');
    await engine.insertArrow('sf_arrow', r.ipc);
    await engine.query(compileConnectionLoad('sf_query', r.columns, { staging: 'sf_arrow' }));
    const described = await engine.describe('SELECT * FROM sf_query');
    expect(described.map((c) => [c.name, c.type])).toEqual([
      ['NAME', 'VARCHAR'],
      ['TOTAL', 'DECIMAL(10,2)'],
      ['PLACED_AT', 'TIMESTAMP'],
      ['STATUS', 'VARCHAR'],
      ['SIGNED_UP', 'DATE'],
      ['ACTIVE', 'BOOLEAN'],
    ]);
    const { table } = await engine.query('SELECT "NAME" AS name, sum("TOTAL")::VARCHAR AS total, min("PLACED_AT")::VARCHAR AS first, "SIGNED_UP"::VARCHAR AS signed_up, "ACTIVE" AS active FROM sf_query GROUP BY ALL');
    expect(table.toArray().map((row) => row.toJSON())).toEqual([{ name: 'Ada Lovelace', total: '25.49', first: '2024-04-01 09:30:00', signed_up: '2024-01-15', active: true }]);
  });
});
