// The Redis driver against a live server: over its socket when PUDDLE_TEST_REDIS names one (a URL such as
// redis://:password@localhost:6379/0, seeded with scripts/seed-redis.mjs), and over Upstash's REST interface when
// PUDDLE_TEST_UPSTASH names one (http://127.0.0.1:18079?token=…, scripts/upstash-stand-in.mjs in front of that
// Redis in CI, or a real Upstash database). Without the variables the parts are skipped.
import { tableFromIPC } from 'apache-arrow';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { redisConnector } from '../../src/connect/drivers/redis';
import { redisConnect } from '../../src/connect/drivers/redisSocket';
import { createServer, type ServerOptions } from '../../src/connect/server';
import type { Connection } from '../../src/model';

const socketUrl = process.env.PUDDLE_TEST_REDIS;
const restUrl = process.env.PUDDLE_TEST_UPSTASH;

const checks = (connector: ReturnType<typeof redisConnector>, ctx: { connection: Connection; secret: string }) => {
  it('connects and counts the keys', async () => {
    const t = await connector.test(ctx);
    expect(t).toMatchObject({ ok: true });
    expect(t.ok && t.server).toMatch(/^Redis.*, 13 keys$/);
  });

  it('catalogues the keys by prefix, documents them, and reads a pattern as rows', async () => {
    const c = await connector.catalog(ctx);
    expect(c.tables.map((t) => [t.name, t.rows])).toEqual([
      ['*', 3],
      ['order:*', 6],
      ['orders:*', 1],
      ['user:*', 3],
    ]);
    expect(c.tables.find((t) => t.name === 'user:*')!.columns.map((x) => x.name)).toEqual(expect.arrayContaining(['key', 'type', 'name', 'email', 'signed_up', 'active']));
    const d = await connector.document!(ctx);
    expect(d.tables.find((t) => t.name === 'user:*')!.note).toMatch(/^Keys matching user:\*\. Inferred from 3 keys on /);
    const users = await connector.read(ctx, { table: { name: 'user:*' } });
    if (!('ipc' in users)) throw new Error('expected a stream');
    expect(users.rows).toBe(3);
    expect([...tableFromIPC(users.ipc).getChild('name')!.toArray()].sort()).toEqual(['Ada Lovelace', 'Alan Turing', 'Grace Hopper']);
    const orders = await connector.read(ctx, { query: 'order:*' });
    if (!('ipc' in orders)) throw new Error('expected a stream');
    // Four hashes and the three members of the two tag sets.
    expect(orders.rows).toBe(7);
    const types = tableFromIPC(orders.ipc).getChild('type')!.toArray();
    expect(types.filter((t: unknown) => t === 'hash')).toHaveLength(4);
    expect(types.filter((t: unknown) => t === 'set')).toHaveLength(3);
    const few = await connector.read(ctx, { query: '*', limit: 2 });
    expect('ipc' in few && few.rows).toBe(2);
  });
};

describe.skipIf(!socketUrl)(`the redis driver against ${socketUrl ? new URL(socketUrl).host : 'no server'}`, () => {
  const u = new URL(socketUrl ?? 'redis://localhost');
  const settings = { host: u.hostname, port: Number(u.port) || 6379, db: Number(u.pathname.slice(1)) || 0, user: decodeURIComponent(u.username), ssl: u.protocol === 'rediss:' };
  const connection: Connection = { id: 'c', name: 'cache', driver: 'redis', via: 'local', settings, auth: 'password' };
  const secret = decodeURIComponent(u.password);
  checks(redisConnector(redisConnect), { connection, secret });

  describe('through puddle-connect', () => {
    let base: string;
    let server: ReturnType<typeof createServer>;
    beforeAll(async () => {
      const options: ServerOptions = { host: '127.0.0.1', port: 0, origins: [], allow: [], files: [], timeoutMs: 20_000, rowCap: 1000, concurrent: 2, log: () => undefined };
      server = createServer(options);
      base = await new Promise<string>((resolve) => server.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${(server.address() as AddressInfo).port}`)));
    });
    afterAll(() => server.close());
    const post = (route: string, body: unknown) => fetch(`${base}/${route}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

    it('lists the driver, tests the connection and streams a pattern, the key pattern passing its own check', async () => {
      expect(((await (await fetch(`${base}/health`)).json()) as { drivers: string[] }).drivers).toContain('redis');
      expect(await (await post('test', { driver: 'redis', settings, secret })).json()).toMatchObject({ ok: true });
      const r = await post('read', { driver: 'redis', settings, secret, query: 'user:*', limit: 10 });
      expect(r.status).toBe(200);
      expect(r.headers.get('puddle-rows')).toBe('3');
      expect([...tableFromIPC(new Uint8Array(await r.arrayBuffer())).getChild('key')!.toArray()].sort()).toEqual(['user:1', 'user:2', 'user:3']);
      expect((await post('read', { driver: 'redis', settings, secret, query: ' ' })).status).toBe(422);
    });
  });
});

describe.skipIf(!restUrl)(`the redis driver over REST at ${restUrl ? new URL(restUrl).host : 'no address'}`, () => {
  const u = new URL(restUrl ?? 'http://localhost');
  const connection: Connection = { id: 'r', name: 'cache', driver: 'redis', via: 'browser', settings: { rest: u.origin }, auth: 'password' };
  checks(redisConnector(), { connection, secret: u.searchParams.get('token') ?? '' });

  it('is refused with the wrong token', async () => {
    await expect(redisConnector().test({ connection, secret: 'wrong' })).rejects.toThrow('Upstash refused the token.');
  });
});
