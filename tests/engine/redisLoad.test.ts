// A Redis read (replayed from the calls recorded over the socket) loads into DuckDB-WASM through the same staging
// and CAST path the app uses: a hash per row with its fields as text columns, the missing field null, and a sorted
// set's score as a double.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { compileConnectionLoad } from '../../src/compiler/connectionLoad';
import { redisConnector, type RedisClientLike } from '../../src/connect/drivers/redis';
import { EngineClient } from '../../src/engine/client';
import type { Connection } from '../../src/model';
import { createNodeBackend } from '../helpers/nodeBackend';
import { replayClient } from '../helpers/replayCalls';

const connection: Connection = { id: 'c', name: 'cache', driver: 'redis', via: 'local', settings: { host: '127.0.0.1', port: 16379, db: 0 }, auth: 'password' };

let engine: EngineClient;
beforeAll(async () => {
  engine = new EngineClient(await createNodeBackend());
});
afterAll(() => engine.close());

describe('a Redis read in DuckDB', () => {
  it('loads the hashes of a pattern as rows, and a sorted set with its scores', async () => {
    const connector = redisConnector(async () => replayClient<RedisClientLike>('redis'));
    const users = await connector.read({ connection, secret: 'puddle' }, { table: { name: 'user:*' }, limit: 10 });
    if (!('ipc' in users)) throw new Error('expected a stream');
    await engine.insertArrow('rd_arrow', users.ipc);
    await engine.query(compileConnectionLoad('rd_users', users.columns, { staging: 'rd_arrow' }));
    expect((await engine.describe('SELECT * FROM rd_users')).map((c) => [c.name, c.type])).toEqual([
      ['key', 'VARCHAR'],
      ['type', 'VARCHAR'],
      ['name', 'VARCHAR'],
      ['signed_up', 'VARCHAR'],
      ['active', 'VARCHAR'],
      ['email', 'VARCHAR'],
    ]);
    const { table } = await engine.query("SELECT count(*)::INTEGER AS n, count(email)::INTEGER AS emails, sum(active::INTEGER)::INTEGER AS active, min(signed_up::DATE)::VARCHAR AS first FROM rd_users WHERE type = 'hash'");
    expect(table.toArray().map((row) => row.toJSON())).toEqual([{ n: 3, emails: 2, active: 2, first: '2024-01-15' }]);

    const all = await connector.read({ connection, secret: 'puddle' }, { query: '*', limit: 5 });
    if (!('ipc' in all)) throw new Error('expected a stream');
    await engine.insertArrow('rd_all_arrow', all.ipc);
    await engine.query(compileConnectionLoad('rd_all', all.columns, { staging: 'rd_all_arrow' }));
    expect((await engine.describe('SELECT * FROM rd_all')).find((c) => c.name === 'score')?.type).toBe('DOUBLE');
    // The row limit cuts the five keys' ten rows to five: three hashes and the first two members of the sorted set.
    const scores = await engine.query("SELECT count(*)::INTEGER AS n, max(score) AS top FROM rd_all WHERE type = 'zset'");
    expect(scores.table.toArray().map((row) => row.toJSON())).toEqual([{ n: 2, top: 120 }]);
  });
});
