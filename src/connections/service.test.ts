import { forgetAllSecrets, rememberSecret, SERVICE_TOKEN_ID } from './secrets';
import { probe, refreshReach, serviceBase, serviceBody, testConnection, useReach, type Fetch } from './service';

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

describe('puddle-connect routes', () => {
  afterEach(() => forgetAllSecrets());

  it('finds the service at localhost or under the app', () => {
    expect(serviceBase('local')).toBe('http://localhost:8765');
    expect(serviceBase('pi', 'https://puddle.example.com/')).toBe('https://puddle.example.com/connect');
    expect(serviceBase('pi', 'https://example.com/puddle/')).toBe('https://example.com/puddle/connect');
    expect(() => serviceBase('browser')).toThrow();
  });

  it('probes both routes and records what answered', async () => {
    const calls: string[] = [];
    const fetchImpl: Fetch = async (input) => {
      calls.push(String(input));
      return String(input).startsWith('http://localhost:8765') ? json(200, { version: '0.1.0', drivers: ['postgres'] }) : json(404, {});
    };
    await refreshReach(fetchImpl);
    expect(useReach.getState()).toEqual({ local: { version: '0.1.0', drivers: ['postgres'] }, pi: undefined, probed: true });
    expect(calls).toEqual(['http://localhost:8765/health', 'http://localhost/connect/health']);
  });

  it('a route whose fetch fails is not reachable', async () => {
    const fetchImpl: Fetch = async () => {
      throw new TypeError('Failed to fetch');
    };
    expect(await probe('local', fetchImpl)).toBeUndefined();
  });

  it('sends the Pi its token, and the driver, settings and secret for this request only', async () => {
    rememberSecret(SERVICE_TOKEN_ID, 'pi-token');
    let seen: { url: string; init: RequestInit } | undefined;
    const fetchImpl: Fetch = async (input, init) => {
      seen = { url: String(input), init: init! };
      return json(200, { ok: true, server: 'PostgreSQL 16.2' });
    };
    const conn = { driver: 'postgres' as const, via: 'pi' as const, settings: { host: 'db', port: 5432, database: 'shop', user: 'kev' } };
    expect(await testConnection(conn, 'hunter2', fetchImpl)).toEqual({ ok: true, detail: 'PostgreSQL 16.2' });
    expect(seen!.url).toBe('http://localhost/connect/test');
    expect((seen!.init.headers as Record<string, string>).Authorization).toBe('Bearer pi-token');
    expect(JSON.parse(seen!.init.body as string)).toEqual(serviceBody(conn, 'hunter2'));
    expect(Object.keys(serviceBody(conn, 'x'))).toEqual(['driver', 'settings', 'secret']);
  });

  it('says what went wrong: no service, a refused token, a refused database, or a browser driver not yet built', async () => {
    const down: Fetch = async () => {
      throw new TypeError('Failed to fetch');
    };
    const local = { driver: 'mysql' as const, via: 'local' as const, settings: {} };
    expect((await testConnection(local, 'x', down)).detail).toContain('npx puddle-connect');
    expect((await testConnection({ ...local, via: 'pi' }, 'x', async () => json(401, {}))).detail).toContain('token');
    expect(await testConnection(local, 'x', async () => json(200, { ok: false, reason: 'password authentication failed' }))).toEqual({ ok: false, detail: 'password authentication failed' });
    expect((await testConnection({ driver: 'sqlite', via: 'browser', settings: {} }, undefined, down)).detail).toContain('isn’t built yet');
  });
});
