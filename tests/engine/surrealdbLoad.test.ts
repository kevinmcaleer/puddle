// A SurrealDB read (replayed from the exchanges recorded from a SurrealDB server) loads into DuckDB-WASM with its
// types, through the same staging and CAST path the app uses: the declared decimal exact, the datetime a timestamp.
// The orders table's array column loads as JSON, which needs DuckDB's json extension the Node engine can't fetch,
// so the table read is checked as Arrow in src/connect/drivers/surrealdb.test.ts and the query is loaded here.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { compileConnectionLoad } from '../../src/compiler/connectionLoad';
import { surrealConnector } from '../../src/connect/drivers/surrealdb';
import { EngineClient } from '../../src/engine/client';
import type { Connection } from '../../src/model';
import { createNodeBackend } from '../helpers/nodeBackend';
import { replayFetch } from '../helpers/replayFetch';

const connection: Connection = { id: 'c', name: 'shop', driver: 'surrealdb', via: 'browser', settings: { url: 'http://127.0.0.1:18000', namespace: 'shop', database: 'shop', user: 'root' }, auth: 'password' };

let engine: EngineClient;
beforeAll(async () => {
  engine = new EngineClient(await createNodeBackend());
});
afterAll(() => engine.close());

describe('a SurrealDB read in DuckDB', () => {
  it('loads a query with the driver’s types, then the table’s declared ones cast on top', async () => {
    const r = await surrealConnector(replayFetch('surrealdb')).read({ connection, secret: 'root' }, { query: 'SELECT customer.name AS name, total, placed_at, status, customer.signed_up AS signed_up, customer.active AS active, id FROM orders ORDER BY id', limit: 2 });
    if (!('ipc' in r)) throw new Error('expected a stream');
    await engine.insertArrow('su_arrow', r.ipc);
    await engine.query(compileConnectionLoad('su_query', r.columns, { staging: 'su_arrow' }));
    const described = await engine.describe('SELECT * FROM su_query');
    expect(described.map((c) => [c.name, c.type])).toEqual([
      ['active', 'BOOLEAN'],
      ['id', 'VARCHAR'],
      ['name', 'VARCHAR'],
      ['placed_at', 'VARCHAR'],
      ['signed_up', 'VARCHAR'],
      ['status', 'VARCHAR'],
      ['total', 'VARCHAR'],
    ]);
    // A query's values are text where SurrealDB's JSON has no type for them; DuckDB reads them as the types they are.
    const { table } = await engine.query("SELECT name, sum(total::DECIMAL(10,2))::VARCHAR AS total, min(placed_at::TIMESTAMP)::VARCHAR AS first, signed_up::TIMESTAMP::DATE::VARCHAR AS signed_up, active FROM su_query GROUP BY ALL");
    expect(table.toArray().map((row) => row.toJSON())).toEqual([{ name: 'Ada Lovelace', total: '25.49', first: '2024-04-01 09:30:00', signed_up: '2024-01-15', active: true }]);
  });
});
