// A BigQuery read (replayed from recorded exchanges) loads into DuckDB-WASM with its types, through the same staging
// and CAST path the app uses. The orders table's array and struct load as JSON, which needs an extension the Node
// engine can't fetch, so the query without them is loaded here and the table read is checked as Arrow in the
// driver's test.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { compileConnectionLoad } from '../../src/compiler/connectionLoad';
import { bigqueryConnector } from '../../src/connect/drivers/bigquery';
import { EngineClient } from '../../src/engine/client';
import type { Connection } from '../../src/model';
import { createNodeBackend } from '../helpers/nodeBackend';
import { replayFetch } from '../helpers/replayFetch';
import { testServiceAccountKey } from '../helpers/testKey';

const connection: Connection = { id: 'c', name: 'shop', driver: 'bigquery', via: 'browser', settings: { project: 'puddle-test', dataset: 'shop', endpoint: 'http://127.0.0.1:18090' }, auth: 'key' };

let engine: EngineClient;
beforeAll(async () => {
  engine = new EngineClient(await createNodeBackend());
});
afterAll(() => engine.close());

describe('a BigQuery read in DuckDB', () => {
  it('loads a query with the driver’s types: a numeric, a timestamp, a date and a boolean', async () => {
    const r = await bigqueryConnector(replayFetch('bigquery')).read({ connection, secret: await testServiceAccountKey() }, { query: 'SELECT c.name, o.total, o.placed_at, o.status, c.signed_up, c.active FROM orders o JOIN customers c ON c.id = o.customer_id ORDER BY o.id', limit: 2 });
    if (!('ipc' in r)) throw new Error('expected a stream');
    await engine.insertArrow('bq_arrow', r.ipc);
    await engine.query(compileConnectionLoad('bq_query', r.columns, { staging: 'bq_arrow' }));
    const described = await engine.describe('SELECT * FROM bq_query');
    expect(described.map((c) => [c.name, c.type])).toEqual([
      ['name', 'VARCHAR'],
      ['total', 'DECIMAL(38,9)'],
      ['placed_at', 'TIMESTAMP'],
      ['status', 'VARCHAR'],
      ['signed_up', 'DATE'],
      ['active', 'BOOLEAN'],
    ]);
    const { table } = await engine.query('SELECT name, sum(total)::VARCHAR AS total, min(placed_at)::VARCHAR AS first, signed_up::VARCHAR AS signed_up, active FROM bq_query GROUP BY ALL');
    expect(table.toArray().map((row) => row.toJSON())).toEqual([{ name: 'Ada Lovelace', total: '25.490000000', first: '2024-04-01 09:30:00', signed_up: '2024-01-15', active: true }]);
  });
});
