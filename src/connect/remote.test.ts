import { tableFromArrays, tableFromIPC, tableToIPC } from 'apache-arrow';
import type { Connection } from '../model';
import { forgetAllSecrets, rememberSecret, SERVICE_TOKEN_ID } from '../connections/secrets';
import { remoteConnector } from './remote';
import { ConnectorError } from './types';

const pg: Connection = { id: 'c1', name: 'Shop', driver: 'postgres', via: 'local', settings: { host: 'db', port: 5432, database: 'shop', user: 'kev' }, auth: 'password' };

type Call = { url: string; init: RequestInit };
const answering = (status: number, body: BodyInit | null, headers: Record<string, string> = {}, calls: Call[] = []) => {
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return new Response(body, { status, headers });
  }) as typeof fetch;
  return { fetchImpl, calls };
};

afterEach(() => forgetAllSecrets());

describe('the remote connector', () => {
  it('posts the driver, settings and secret to the service, never the connection name, and reads the answer', async () => {
    const { fetchImpl, calls } = answering(200, JSON.stringify({ ok: true, server: 'PostgreSQL 16.2' }), { 'Content-Type': 'application/json' });
    const c = remoteConnector('local', fetchImpl);
    expect(await c.test({ connection: pg, secret: 'hunter2' })).toEqual({ ok: true, server: 'PostgreSQL 16.2' });
    expect(calls[0]!.url).toBe('http://localhost:8765/test');
    expect(JSON.parse(calls[0]!.init.body as string)).toEqual({ driver: 'postgres', settings: pg.settings, secret: 'hunter2' });
    expect(calls[0]!.init.body).not.toContain('Shop');
    expect((calls[0]!.init.headers as Record<string, string>).Authorization).toBeUndefined();
  });

  it('sends the Pi route’s token, and says when the service refuses it or isn’t there', async () => {
    rememberSecret(SERVICE_TOKEN_ID, 'tok');
    const { fetchImpl, calls } = answering(401, 'no');
    await expect(remoteConnector('pi', fetchImpl).catalog({ connection: { ...pg, via: 'pi' } })).rejects.toThrow('refused the token');
    expect((calls[0]!.init.headers as Record<string, string>).Authorization).toBe('Bearer tok');
    const down = (async () => {
      throw new TypeError('Failed to fetch');
    }) as typeof fetch;
    await expect(remoteConnector('local', down).catalog({ connection: pg })).rejects.toThrow('npx puddle-connect');
    const { fetchImpl: failing } = answering(400, 'relation "nowhere" does not exist');
    await expect(remoteConnector('local', failing).read({ connection: pg }, { query: 'SELECT * FROM nowhere' })).rejects.toThrow(ConnectorError);
    await expect(remoteConnector('local', failing).read({ connection: pg }, { query: 'SELECT * FROM nowhere' })).rejects.toThrow('relation "nowhere" does not exist');
  });

  it('reads rows as the Arrow stream the service answers with, typed by its headers', async () => {
    const ipc = tableToIPC(tableFromArrays({ id: [1, 2], name: ['Ada', 'Grace'] }), 'stream');
    const { fetchImpl, calls } = answering(200, ipc as BodyInit, { 'Puddle-Columns': JSON.stringify([{ name: 'id', sqlType: 'BIGINT' }, { name: 'name', sqlType: 'VARCHAR' }]), 'Puddle-Rows': '2' });
    const r = await remoteConnector('local', fetchImpl).read({ connection: pg, secret: 's' }, { table: { schema: 'public', name: 'customers' }, limit: 10 });
    expect(JSON.parse(calls[0]!.init.body as string)).toMatchObject({ table: { schema: 'public', name: 'customers' }, limit: 10 });
    if (!('ipc' in r)) throw new Error('expected an Arrow stream');
    expect(r.columns).toEqual([{ name: 'id', sqlType: 'BIGINT' }, { name: 'name', sqlType: 'VARCHAR' }]);
    expect(r.rows).toBe(2);
    expect(tableFromIPC(r.ipc).numRows).toBe(2);
  });
});
