import { describe, expect, it } from 'vitest';
import { createGistProvider, GITHUB_API } from './gist';
import { SyncAuthError, SyncConflictError, SyncOfflineError, type CredentialStore, type ProviderId } from './types';

function memoryCredentials(): CredentialStore & { map: Map<ProviderId, { secret: string; account: string }> } {
  const map = new Map<ProviderId, { secret: string; account: string }>();
  return {
    map,
    get: async (p) => map.get(p),
    set: async (p, secret, account) => void map.set(p, { secret, account }),
    delete: async (p) => void map.delete(p),
  };
}

interface Call {
  method: string;
  path: string;
  auth: string | null;
  body: unknown;
  cache?: RequestCache;
}

/** A tiny Gist API: answers from a script of handlers, recording every call. */
function fakeApi(handler: (call: Call) => { status?: number; body?: unknown; headers?: Record<string, string> } | 'network') {
  const calls: Call[] = [];
  const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const headers = new Headers(init?.headers);
    const call: Call = { method: init?.method ?? 'GET', path: url.startsWith(GITHUB_API) ? url.slice(GITHUB_API.length) : url, auth: headers.get('Authorization'), body: init?.body ? JSON.parse(String(init.body)) : undefined, cache: init?.cache };
    calls.push(call);
    const res = handler(call);
    if (res === 'network') throw new TypeError('Failed to fetch');
    const body = typeof res.body === 'string' ? res.body : JSON.stringify(res.body ?? {});
    return new Response(body, { status: res.status ?? 200, headers: res.headers });
  }) as typeof globalThis.fetch;
  return { fetch, calls };
}

const gist = (id: string, version: string, files: Record<string, { content?: string; truncated?: boolean; raw_url?: string }> = { 'orders.puddle.json': { content: '{}' } }, description = 'Puddle project: Orders') => ({
  id,
  description,
  updated_at: '2026-10-01T10:00:00Z',
  files,
  history: [{ version }],
});

describe('GitHub Gist provider', () => {
  it('checks the token with GitHub before keeping it, and forgets it on disconnect', async () => {
    const credentials = memoryCredentials();
    const api = fakeApi((c) => (c.auth === 'Bearer good' ? { body: { login: 'kev' } } : { status: 401 }));
    const gists = createGistProvider({ credentials, fetch: api.fetch });
    await expect(gists.connect('bad')).rejects.toBeInstanceOf(SyncAuthError);
    expect(credentials.map.size).toBe(0);
    expect(await gists.connect('  good\n')).toBe('kev');
    expect(api.calls.at(-1)).toMatchObject({ path: '/user', auth: 'Bearer good' });
    expect(credentials.map.get('gist')).toEqual({ secret: 'good', account: 'kev' });
    expect(await gists.account()).toBe('kev');
    await gists.disconnect();
    expect(credentials.map.size).toBe(0);
    expect(await gists.account()).toBeNull();
  });

  it('creates a secret Gist holding the project file on the first push', async () => {
    const credentials = memoryCredentials();
    await credentials.set('gist', 'tok', 'kev');
    const api = fakeApi(() => ({ status: 201, body: gist('g1', 'v1') }));
    const remote = await createGistProvider({ credentials, fetch: api.fetch }).push({ title: 'Orders', fileName: 'orders.puddle.json', text: '{"a":1}' });
    expect(remote).toEqual({ id: 'g1', title: 'Orders', fileName: 'orders.puddle.json', updatedAt: '2026-10-01T10:00:00Z', revision: 'v1' });
    expect(api.calls).toEqual([
      { method: 'POST', path: '/gists', auth: 'Bearer tok', cache: 'no-store', body: { description: 'Puddle project: Orders', public: false, files: { 'orders.puddle.json': { content: '{"a":1}' } } } },
    ]);
  });

  it('writes over a Gist only while it is at the revision last seen', async () => {
    const credentials = memoryCredentials();
    await credentials.set('gist', 'tok', 'kev');
    const api = fakeApi((c) => (c.method === 'GET' ? { body: gist('g1', 'v2') } : { body: gist('g1', 'v3', { 'renamed.puddle.json': { content: 'x' } }, 'Puddle project: Renamed') }));
    const gists = createGistProvider({ credentials, fetch: api.fetch });
    const file = { title: 'Renamed', fileName: 'renamed.puddle.json', text: 'x' };

    const conflict = await gists.push(file, { id: 'g1', revision: 'v1' }).catch((e: unknown) => e);
    expect(conflict).toBeInstanceOf(SyncConflictError);
    expect((conflict as SyncConflictError).remote.revision).toBe('v2');
    expect(api.calls.filter((c) => c.method === 'PATCH')).toHaveLength(0);

    const remote = await gists.push(file, { id: 'g1', revision: 'v2' });
    expect(remote.revision).toBe('v3');
    // The file is renamed along with the project rather than added beside the old one.
    expect(api.calls.at(-1)).toMatchObject({
      method: 'PATCH',
      path: '/gists/g1',
      body: { description: 'Puddle project: Renamed', files: { 'orders.puddle.json': { filename: 'renamed.puddle.json', content: 'x' } } },
    });
  });

  it('writes a Gist deleted on GitHub again as a new one', async () => {
    const credentials = memoryCredentials();
    await credentials.set('gist', 'tok', 'kev');
    const api = fakeApi((c) => (c.method === 'GET' ? { status: 404 } : { status: 201, body: gist('g2', 'v1') }));
    const remote = await createGistProvider({ credentials, fetch: api.fetch }).push({ title: 'Orders', fileName: 'orders.puddle.json', text: '{}' }, { id: 'g1', revision: 'v1' });
    expect(remote.id).toBe('g2');
    expect(api.calls.map((c) => `${c.method} ${c.path}`)).toEqual(['GET /gists/g1', 'POST /gists']);
  });

  it('lists only Gists with a Puddle project, newest first, across pages', async () => {
    const credentials = memoryCredentials();
    await credentials.set('gist', 'tok', 'kev');
    const filler = Array.from({ length: 99 }, (_, i) => ({ ...gist(`other${i}`, ''), files: { 'notes.md': {} }, description: 'Notes' }));
    const api = fakeApi((c) =>
      c.path.endsWith('page=1')
        ? { body: [{ ...gist('a', ''), updated_at: '2026-01-01T00:00:00Z' }, ...filler] }
        : { body: [{ ...gist('b', '', { 'stock.puddle.json': {} }, null as unknown as string), updated_at: '2026-02-01T00:00:00Z' }] },
    );
    const list = await createGistProvider({ credentials, fetch: api.fetch }).list();
    expect(list.map((f) => [f.id, f.title])).toEqual([
      ['b', 'stock'],
      ['a', 'Orders'],
    ]);
    expect(api.calls.map((c) => c.path)).toEqual(['/gists?per_page=100&page=1', '/gists?per_page=100&page=2']);
  });

  it('pulls the project file, from its raw address when GitHub truncates it', async () => {
    const credentials = memoryCredentials();
    await credentials.set('gist', 'tok', 'kev');
    const api = fakeApi((c) => (c.path === '/gists/g1' ? { body: gist('g1', 'v4', { 'orders.puddle.json': { content: '{"cut', truncated: true, raw_url: 'https://gist.githubusercontent.com/raw/orders' } }) } : { body: '{"whole":true}' }));
    const pulled = await createGistProvider({ credentials, fetch: api.fetch }).pull('g1');
    expect(pulled).toMatchObject({ id: 'g1', revision: 'v4', text: '{"whole":true}' });
    // The token goes to api.github.com only.
    expect(api.calls[1]).toMatchObject({ path: 'https://gist.githubusercontent.com/raw/orders', auth: null });
  });

  it('says offline when the request never reaches GitHub, and refuses without a token', async () => {
    const credentials = memoryCredentials();
    const api = fakeApi(() => 'network');
    const gists = createGistProvider({ credentials, fetch: api.fetch });
    await expect(gists.list()).rejects.toBeInstanceOf(SyncAuthError);
    expect(api.calls).toHaveLength(0);
    await credentials.set('gist', 'tok', 'kev');
    await expect(gists.head('g1')).rejects.toBeInstanceOf(SyncOfflineError);
  });
});
