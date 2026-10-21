// A DynamoDB read (replayed from the exchanges recorded from a DynamoDB) loads into DuckDB-WASM with its types,
// through the same staging and CAST path the app uses: numbers as numbers, the boolean as itself, dates as text.
// The orders table's list loads as JSON, which needs DuckDB's json extension the Node engine can't fetch, so the
// orders read is checked as Arrow in src/connect/drivers/dynamodb.test.ts and the customers table is loaded here.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { compileConnectionLoad } from '../../src/compiler/connectionLoad';
import { dynamoConnector } from '../../src/connect/drivers/dynamodb';
import { EngineClient } from '../../src/engine/client';
import type { Connection } from '../../src/model';
import { createNodeBackend } from '../helpers/nodeBackend';
import { replayFetch } from '../helpers/replayFetch';

const connection: Connection = { id: 'c', name: 'shop', driver: 'dynamodb', via: 'browser', settings: { region: 'eu-west-2', accessKeyId: 'AKIDEXAMPLE', endpoint: 'http://127.0.0.1:18092' }, auth: 'aws' };

let engine: EngineClient;
beforeAll(async () => {
  engine = new EngineClient(await createNodeBackend());
});
afterAll(() => engine.close());

describe('a DynamoDB read in DuckDB', () => {
  it('loads a scanned table with the inferred types: the key as an integer, a boolean, text with a null', async () => {
    const r = await dynamoConnector(replayFetch('dynamodb')).read({ connection, secret: 'secretexample' }, { table: { name: 'customers' }, limit: 100 });
    if (!('ipc' in r)) throw new Error('expected a stream');
    await engine.insertArrow('dy_arrow', r.ipc);
    await engine.query(compileConnectionLoad('dy_customers', r.columns, { staging: 'dy_arrow' }));
    const described = await engine.describe('SELECT * FROM dy_customers');
    expect(described.map((c) => [c.name, c.type])).toEqual([
      ['id', 'BIGINT'],
      ['name', 'VARCHAR'],
      ['email', 'VARCHAR'],
      ['signed_up', 'VARCHAR'],
      ['active', 'BOOLEAN'],
    ]);
    const { table } = await engine.query('SELECT count(*)::INTEGER AS n, count(email)::INTEGER AS emails, sum(active::INTEGER)::INTEGER AS active, min(signed_up::DATE)::VARCHAR AS first FROM dy_customers');
    expect(table.toArray().map((row) => row.toJSON())).toEqual([{ n: 3, emails: 2, active: 2, first: '2024-01-15' }]);
  });
});
