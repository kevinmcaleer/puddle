// The Redis driver against the calls recorded from a Redis-compatible server over its socket (tests/fixtures/db/redis/)
// and the exchanges recorded over the Upstash REST stand-in (tests/fixtures/db/upstash/), both regenerated with
// scripts/record-database.mjs, and against servers that refuse.
import { tableFromIPC } from 'apache-arrow';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { replayClient } from '../../../tests/helpers/replayCalls';
import { replayFetch } from '../../../tests/helpers/replayFetch';
import type { Connection } from '../../model';
import { ConnectorError, type CatalogDetail } from '../types';
import { escapeGlob, pairs, patternOf, patternProblem, redisConfigFor, redisConnector, redisProblem, rowsOf, upstashClient, valueCommand, versionOf, type RedisClientLike } from './redis';

const recorded = (family: string) => JSON.parse(readFileSync(join(__dirname, `../../../tests/fixtures/db/${family}/catalog.json`), 'utf8')) as { test: unknown; catalog: unknown; detail: CatalogDetail };
const replay = (refuse?: RegExp, onEnd?: () => void) => async () => replayClient<RedisClientLike>('redis', { refuse: (_, args) => (refuse?.test(JSON.stringify(args)) ? new Error('NOPERM this user has no permissions to run the command') : undefined), onEnd });

const connection: Connection = { id: 'c', name: 'cache', driver: 'redis', via: 'local', settings: { host: '127.0.0.1', port: 16379, db: 0 }, auth: 'password' };
const ctx = { connection, secret: 'puddle' };
const rest: Connection = { id: 'r', name: 'cache', driver: 'redis', via: 'browser', settings: { rest: 'http://127.0.0.1:18079' }, auth: 'password' };
const restCtx = { connection: rest, secret: 'puddle-token' };
const dated = (d: CatalogDetail) => ({ ...d, tables: d.tables.map((t) => ({ ...t, note: t.note?.replace(/\d{4}-\d{2}-\d{2}$/, 'DATE') })) });

describe('the Redis driver', () => {
  it('tests, catalogues and documents the keys as recorded over the socket: a table per prefix, a hash’s fields as columns', async () => {
    const c = redisConnector(replay());
    expect(await c.test(ctx)).toEqual(recorded('redis').test);
    expect(await c.catalog(ctx)).toEqual(recorded('redis').catalog);
    expect(dated(await c.document!(ctx))).toEqual(dated(recorded('redis').detail));
    const { catalog, detail } = recorded('redis') as { catalog: { tables: { name: string; rows?: number; columns: { name: string }[] }[] }; detail: CatalogDetail };
    expect(catalog.tables.map((t) => [t.name, t.rows])).toEqual([
      ['*', 3],
      ['order:*', 6],
      ['orders:*', 1],
      ['user:*', 3],
    ]);
    expect(catalog.tables.find((t) => t.name === 'user:*')!.columns.map((x) => x.name)).toEqual(['key', 'type', 'name', 'signed_up', 'active', 'email']);
    expect(detail.tables.find((t) => t.name === 'user:*')!.note).toMatch(/^Keys matching user:\*\. Inferred from 3 keys on /);
    expect(detail.tables.find((t) => t.name === 'order:*')!.columns.find((x) => x.name === 'member')).toMatchObject({ type: 'string', note: 'present in 43% of documents' });
  });

  it('reads a pattern as rows: one per hash, a set one per member, a list with its index, the sorted set with its score', async () => {
    const c = redisConnector(replay());
    const users = await c.read(ctx, { table: { name: 'user:*' }, limit: 10 });
    if (!('ipc' in users)) throw new Error('expected a stream');
    expect(users.rows).toBe(3);
    expect(users.columns.map((x) => [x.name, x.sqlType])).toEqual([
      ['key', 'VARCHAR'],
      ['type', 'VARCHAR'],
      ['name', 'VARCHAR'],
      ['signed_up', 'VARCHAR'],
      ['active', 'VARCHAR'],
      ['email', 'VARCHAR'],
    ]);
    const t = tableFromIPC(users.ipc);
    expect([...t.getChild('key')!.toArray()].sort()).toEqual(['user:1', 'user:2', 'user:3']);
    expect(t.getChild('email')!.toArray().filter((x: unknown) => x === null)).toHaveLength(1);
    const orders = await c.read(ctx, { query: 'order:*', limit: 2 });
    if (!('ipc' in orders)) throw new Error('expected a stream');
    expect(orders.rows).toBe(2);
    expect(tableFromIPC(orders.ipc).getChild('type')!.toArray()).toEqual(['hash', 'hash']);
    const everything = await c.read(ctx, { query: '*', limit: 5 });
    if (!('ipc' in everything)) throw new Error('expected a stream');
    expect(everything.rows).toBe(5);
    const all = tableFromIPC(everything.ipc);
    expect(all.getChild('type')!.toArray()).toContain('zset');
    expect(everything.columns.find((x) => x.name === 'score')!.sqlType).toBe('DOUBLE');
  });

  it('reads over Upstash’s REST interface in the browser as recorded, and says when the token is refused', async () => {
    const c = redisConnector(undefined, replayFetch('upstash'));
    expect(await c.test(restCtx)).toEqual(recorded('upstash').test);
    expect(await c.catalog(restCtx)).toEqual(recorded('upstash').catalog);
    expect(dated(await c.document!(restCtx))).toEqual(dated(recorded('upstash').detail));
    const users = await c.read(restCtx, { table: { name: 'user:*' }, limit: 10 });
    expect('ipc' in users && users.rows).toBe(3);
    const refused = redisConnector(undefined, replayFetch('upstash', { test: () => true, status: 401, response: '{"error":"Unauthorized"}' }));
    await expect(refused.test(restCtx)).rejects.toThrow('Upstash refused the token.');
    const erring = redisConnector(undefined, replayFetch('upstash', { test: (b) => b.includes('DBSIZE'), status: 400, response: '{"error":"ERR unknown command"}' }));
    await expect(erring.test(restCtx)).rejects.toThrow('Redis answered: unknown command');
    await expect(redisConnector(undefined, replayFetch('upstash')).read(restCtx, { table: { name: 'nothing:*' } })).rejects.toThrow(/No recording/);
  });

  it('sends a command as Upstash takes it, and a pipeline', async () => {
    const sent: { url: string; body: string; auth: string | undefined }[] = [];
    const f = (async (input: RequestInfo | URL, init?: RequestInit) => {
      sent.push({ url: String(input), body: String(init?.body), auth: new Headers(init?.headers).get('Authorization') ?? undefined });
      return new Response(String(input).endsWith('/pipeline') ? '[{"result":1},{"result":["a"]}]' : '{"result":"PONG"}', { status: 200 });
    }) as typeof fetch;
    const client = upstashClient('https://db.upstash.io', 'tok', f);
    expect(await client.send(['PING'])).toBe('PONG');
    expect(await client.sendAll([['DBSIZE'], ['SMEMBERS', 's']])).toEqual([1, ['a']]);
    expect(await client.sendAll([])).toEqual([]);
    expect(sent).toEqual([
      { url: 'https://db.upstash.io', body: '["PING"]', auth: 'Bearer tok' },
      { url: 'https://db.upstash.io/pipeline', body: '[["DBSIZE"],["SMEMBERS","s"]]', auth: 'Bearer tok' },
    ]);
    const broken = upstashClient('https://db.upstash.io', 'tok', (async () => new Response('<html>', { status: 200 })) as typeof fetch);
    await expect(broken.send(['PING'])).rejects.toThrow('Nothing at db.upstash.io answers as Upstash.');
  });

  it('refuses a socket read in the browser, and without a host or REST address', async () => {
    await expect(redisConnector().test({ connection: { ...rest, settings: {} }, secret: 'x' })).rejects.toThrow('In the browser a Redis is read over its REST interface: give the Upstash REST address.');
    await expect(redisConnector().test({ connection: { ...connection, settings: {} }, secret: 'x' })).rejects.toThrow('Give the host, or the Upstash REST address.');
    await expect(redisConnector().test(ctx)).rejects.toThrow('Reading a Redis over its socket needs puddle-connect; in the browser give the Upstash REST address.');
    expect(redisConfigFor({ connection: { ...connection, settings: { host: 'cache', user: 'app', db: 2, ssl: 'true' } }, secret: 'pw' })).toEqual({ host: 'cache', port: 6379, db: 2, user: 'app', password: 'pw', ssl: true });
    expect(redisConfigFor({ connection: { ...connection, settings: { host: 'cache', rest: 'https://db.upstash.io/' } }, secret: 'tok' })).toEqual({ host: 'cache', port: 6379, db: 0, password: 'tok', ssl: false, rest: 'https://db.upstash.io' });
  });

  it('makes rows of each type, a field named like a fixed column set apart', () => {
    expect(rowsOf('k', 'string', '42')).toEqual([{ key: 'k', type: 'string', value: '42' }]);
    expect(rowsOf('k', 'hash', ['name', 'Ada', 'key', 'x', 'n', 1])).toEqual([{ key: 'k', type: 'hash', name: 'Ada', 'field.key': 'x', n: '1' }]);
    expect(rowsOf('k', 'list', ['a', 'b'])).toEqual([
      { key: 'k', type: 'list', index: 0, member: 'a' },
      { key: 'k', type: 'list', index: 1, member: 'b' },
    ]);
    expect(rowsOf('k', 'set', ['a'])).toEqual([{ key: 'k', type: 'set', member: 'a' }]);
    expect(rowsOf('k', 'zset', ['a', '1.5', 'b', '2'])).toEqual([
      { key: 'k', type: 'zset', member: 'a', score: 1.5 },
      { key: 'k', type: 'zset', member: 'b', score: 2 },
    ]);
    expect(rowsOf('k', 'stream', [['1-0', ['kind', 'signup']]])).toEqual([{ key: 'k', type: 'stream', id: '1-0', kind: 'signup' }]);
    expect(rowsOf('k', 'ReJSON-RL', '{"a":1}')).toEqual([{ key: 'k', type: 'json', value: '{"a":1}' }]);
    expect(rowsOf('k', 'none', undefined)).toEqual([{ key: 'k', type: 'none' }]);
    expect(rowsOf('k', 'string', undefined)).toEqual([{ key: 'k', type: 'string', value: null }]);
    expect(pairs({ a: '1' } as never)).toEqual([['a', '1']]);
    // RESP3 clients pair the members and scores themselves.
    expect(pairs([['a', 1.5], ['b', 2]])).toEqual([['a', 1.5], ['b', 2]]);
    expect(rowsOf('k', 'zset', [['a', 1.5], ['b', 2]])).toEqual([
      { key: 'k', type: 'zset', member: 'a', score: 1.5 },
      { key: 'k', type: 'zset', member: 'b', score: 2 },
    ]);
    expect(valueCommand('k', 'zset')).toEqual(['ZRANGE', 'k', '0', '-1', 'WITHSCORES']);
    expect(valueCommand('k', 'MBbloom--')).toBeUndefined();
  });

  it('groups keys by their prefix as patterns, escaping glob characters, and checks a pattern', () => {
    expect(patternOf('user:1')).toBe('user:*');
    expect(patternOf('a:b:c')).toBe('a:*');
    expect(patternOf('visits')).toBe('*');
    expect(patternOf('ke[y]*:1')).toBe('ke\\[y\\]\\*:*');
    expect(escapeGlob('a?b')).toBe('a\\?b');
    expect(patternProblem('')).toBe('Give a key pattern, such as user:*.');
    expect(patternProblem('a\nb')).toBe('A key pattern is one line.');
    expect(patternProblem('user:*')).toBeUndefined();
    expect(versionOf('# Server\r\nredis_version:7.4.0\r\n')).toBe('7.4.0');
    expect(versionOf(null)).toBeUndefined();
  });

  it('says what went wrong in plain words, and still tests when INFO is refused', async () => {
    const config = redisConfigFor(ctx);
    expect(redisProblem(Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' }), config).message).toBe('Nothing answers at 127.0.0.1:16379.');
    expect(redisProblem(new Error('WRONGPASS invalid username-password pair'), config).message).toBe('Redis refused the user name or password.');
    expect(redisProblem(new Error('NOAUTH Authentication required.'), config).message).toBe('Redis refused the user name or password.');
    expect(redisProblem(new Error('NOPERM this user has no permissions'), config).message).toBe('The user may not do that: NOPERM this user has no permissions');
    expect(redisProblem(new Error('ERR DB index is out of range'), config).message).toBe('There is no database with that number.');
    expect(redisProblem(new ConnectorError('as is'), config).message).toBe('as is');
    expect(redisProblem(new Error('ERR something'), redisConfigFor(restCtx)).message).toBe('Redis answered: something');
    expect(await redisConnector(replay(/INFO/)).test(ctx)).toEqual({ ok: true, server: 'Redis, 13 keys' });
    expect(await redisConnector(replay(/SCAN/)).test(ctx)).toEqual(recorded('redis').test);
    await expect(redisConnector(replay(/SCAN/)).catalog(ctx)).rejects.toThrow('The user may not do that');
  });

  it('closes the client when a read is cancelled', async () => {
    let ended = 0;
    const controller = new AbortController();
    const read = redisConnector(replay(undefined, () => ended++)).read({ ...ctx, signal: controller.signal }, { table: { name: 'user:*' }, limit: 10 });
    controller.abort();
    await expect(read).rejects.toThrow('The read was cancelled.');
    expect(ended).toBe(1);
  });
});
