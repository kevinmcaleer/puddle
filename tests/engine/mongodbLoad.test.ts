// A MongoDB read (replayed from the calls recorded from a MongoDB-compatible server) loads into DuckDB-WASM with
// its inferred types, through the same staging and CAST path the app uses: the ids as integers, the date as a
// timestamp, the boolean as itself, the null kept. The orders collection's array loads as JSON, which needs DuckDB's
// json extension the Node engine can't fetch, so orders are checked as Arrow in src/connect/drivers/mongodb.test.ts.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { compileConnectionLoad } from '../../src/compiler/connectionLoad';
import { mongoConnector, type MongoClientLike } from '../../src/connect/drivers/mongodb';
import { EngineClient } from '../../src/engine/client';
import type { Connection } from '../../src/model';
import { createNodeBackend } from '../helpers/nodeBackend';
import { replayClient } from '../helpers/replayCalls';

const connection: Connection = { id: 'c', name: 'shop', driver: 'mongodb', via: 'local', settings: { url: 'mongodb://127.0.0.1:27018', database: 'shop' }, auth: 'password' };

let engine: EngineClient;
beforeAll(async () => {
  engine = new EngineClient(await createNodeBackend());
});
afterAll(() => engine.close());

describe('a MongoDB read in DuckDB', () => {
  it('loads a collection with the inferred types: _id as an integer, the date as a timestamp, the boolean, text with a null', async () => {
    const r = await mongoConnector(async () => replayClient<MongoClientLike>('mongodb')).read({ connection, secret: '' }, { table: { name: 'customers' }, limit: 100 });
    if (!('ipc' in r)) throw new Error('expected a stream');
    await engine.insertArrow('mg_arrow', r.ipc);
    await engine.query(compileConnectionLoad('mg_customers', r.columns, { staging: 'mg_arrow' }));
    const described = await engine.describe('SELECT * FROM mg_customers');
    expect(described.map((c) => [c.name, c.type])).toEqual([
      ['_id', 'BIGINT'],
      ['name', 'VARCHAR'],
      ['email', 'VARCHAR'],
      ['signed_up', 'TIMESTAMP'],
      ['active', 'BOOLEAN'],
    ]);
    const { table } = await engine.query('SELECT count(*)::INTEGER AS n, count(email)::INTEGER AS emails, sum(active::INTEGER)::INTEGER AS active, min(signed_up)::DATE::VARCHAR AS first FROM mg_customers');
    expect(table.toArray().map((row) => row.toJSON())).toEqual([{ n: 3, emails: 2, active: 2, first: '2024-01-15' }]);
  });
});
