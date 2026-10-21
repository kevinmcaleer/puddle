// A SAP HANA read (replayed from the hand-made recording) loads into DuckDB-WASM with its types, through the same
// staging and CAST path the app uses: the DECIMAL exact, the timestamp, the date and the boolean as themselves.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { compileConnectionLoad } from '../../src/compiler/connectionLoad';
import { hanaConnector, type HanaConnect, type HanaField } from '../../src/connect/drivers/hana';
import { EngineClient } from '../../src/engine/client';
import type { Connection } from '../../src/model';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createNodeBackend } from '../helpers/nodeBackend';

const queries = JSON.parse(readFileSync(join(__dirname, '../fixtures/db/hana/queries.json'), 'utf8')) as { text: string; rows: unknown[][]; fields: HanaField[] }[];
const replay: HanaConnect = async () => ({
  query: async (sql) => {
    const q = queries.find((x) => x.text === sql);
    if (!q) throw new Error(`No recording for: ${sql}`);
    return { rows: q.rows, fields: q.fields };
  },
  end: async () => undefined,
});
const connection: Connection = { id: 'c', name: 'shop', driver: 'hana', via: 'local', settings: { host: 'localhost', port: 39015, user: 'SHOP' }, auth: 'password' };

let engine: EngineClient;
beforeAll(async () => {
  engine = new EngineClient(await createNodeBackend());
});
afterAll(() => engine.close());

describe('a SAP HANA read in DuckDB', () => {
  it('loads a query with the driver’s types', async () => {
    const r = await hanaConnector(replay).read({ connection, secret: 'pw' }, { query: 'SELECT c.NAME, o.TOTAL, o.PLACED_AT, o.STATUS, c.SIGNED_UP, c.ACTIVE FROM ORDERS o JOIN CUSTOMERS c ON c.ID = o.CUSTOMER_ID ORDER BY o.ID', limit: 2 });
    if (!('ipc' in r)) throw new Error('expected a stream');
    await engine.insertArrow('ha_arrow', r.ipc);
    await engine.query(compileConnectionLoad('ha_query', r.columns, { staging: 'ha_arrow' }));
    const described = await engine.describe('SELECT * FROM ha_query');
    expect(described.map((c) => [c.name, c.type])).toEqual([
      ['NAME', 'VARCHAR'],
      ['TOTAL', 'DECIMAL(10,2)'],
      ['PLACED_AT', 'TIMESTAMP'],
      ['STATUS', 'VARCHAR'],
      ['SIGNED_UP', 'DATE'],
      ['ACTIVE', 'BOOLEAN'],
    ]);
    const { table } = await engine.query('SELECT "NAME", sum("TOTAL")::VARCHAR AS total, min("PLACED_AT")::VARCHAR AS first, "SIGNED_UP"::VARCHAR AS signed_up, "ACTIVE" FROM ha_query GROUP BY ALL');
    expect(table.toArray().map((row) => row.toJSON())).toEqual([{ NAME: 'Ada Lovelace', total: '25.49', first: '2024-04-01 09:30:00', signed_up: '2024-01-15', ACTIVE: true }]);
  });
});
