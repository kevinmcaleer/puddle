import { describe, expect, it, vi } from 'vitest';
import { createDriveProvider, DRIVE_API, DRIVE_UPLOAD, GOOGLE_REVOKE, type DriveToken, type TokenStore } from './drive';
import { DRIVE_SCOPE } from './drive-auth';
import { SyncAuthError, SyncConflictError, SyncError, SyncOfflineError } from './types';

function memoryTokens(initial?: DriveToken): TokenStore & { value: DriveToken | undefined } {
  const store = {
    value: initial,
    get: () => store.value,
    set: (t: DriveToken) => void (store.value = t),
    delete: () => void (store.value = undefined),
  };
  return store;
}

interface Call {
  method: string;
  url: URL;
  auth: string | null;
  contentType: string | null;
  body: string | undefined;
  cache?: RequestCache;
}

type Answer = { status?: number; body?: unknown } | 'network';

/** Drive's API from a script of handlers, recording every call. */
function fakeApi(handler: (call: Call) => Answer) {
  const calls: Call[] = [];
  const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    const call: Call = { method: init?.method ?? 'GET', url: new URL(String(input)), auth: headers.get('Authorization'), contentType: headers.get('Content-Type'), body: init?.body as string | undefined, cache: init?.cache };
    calls.push(call);
    const res = handler(call);
    if (res === 'network') throw new TypeError('Failed to fetch');
    return new Response(typeof res.body === 'string' ? res.body : JSON.stringify(res.body ?? {}), { status: res.status ?? 200 });
  }) as typeof globalThis.fetch;
  return { fetch, calls };
}

/** The metadata and content parts of a multipart upload. */
function parts(call: Call) {
  const boundary = /boundary=(.+)$/.exec(call.contentType ?? '')![1]!;
  const [meta, content] = call.body!.split(`--${boundary}`).slice(1, 3).map((p) => p.split('\r\n\r\n').slice(1).join('\r\n\r\n').replace(/\r\n$/, ''));
  return { meta: JSON.parse(meta!) as Record<string, unknown>, content: content! };
}

const NOW = Date.UTC(2026, 9, 16, 12);
const token = (account = 'kev@example.com'): DriveToken => ({ token: 'tok', expiresAt: NOW + 30 * 60_000, account });
const file = (id: string, version: number, extra: object = {}) => ({ id, name: 'orders.puddle.json', description: 'Puddle project: Orders', modifiedTime: '2026-10-16T10:00:00.000Z', version: String(version), ...extra });
const path = (c: Call) => c.url.href.replace(c.url.search, '');

const provider = (api: ReturnType<typeof fakeApi>, tokens = memoryTokens(token()), signIn = vi.fn(async () => {})) => createDriveProvider({ tokens, signIn, fetch: api.fetch, now: () => NOW });

describe('Google Drive provider', () => {
  it('takes the token Google sent back, checks it with Drive and keeps it until it runs out', async () => {
    const tokens = memoryTokens();
    const api = fakeApi((c) => (c.auth === 'Bearer fresh' ? { body: { user: { emailAddress: 'kev@example.com', displayName: 'Kev' } } } : { status: 401 }));
    const drive = provider(api, tokens);
    const answer = new URLSearchParams({ access_token: 'fresh', token_type: 'Bearer', expires_in: '3599', scope: DRIVE_SCOPE }).toString();
    expect(await drive.connect(answer)).toBe('kev@example.com');
    expect(path(api.calls[0]!)).toBe(`${DRIVE_API}/about`);
    expect(tokens.value).toEqual({ token: 'fresh', account: 'kev@example.com', expiresAt: NOW + 3539_000 });
    expect(await drive.account()).toBe('kev@example.com');

    await drive.disconnect();
    expect(tokens.value).toBeUndefined();
    expect(await drive.account()).toBeNull();
    // Google is asked to forget it too.
    expect(api.calls.at(-1)).toMatchObject({ method: 'POST' });
    expect(api.calls.at(-1)!.url.href).toBe(`${GOOGLE_REVOKE}?token=fresh`);
  });

  it('refuses a sign-in without the drive.file permission, and keeps nothing', async () => {
    const tokens = memoryTokens();
    const api = fakeApi(() => ({ body: { user: { emailAddress: 'kev@example.com' } } }));
    const drive = provider(api, tokens);
    await expect(drive.connect('access_token=t&scope=openid')).rejects.toBeInstanceOf(SyncAuthError);
    await expect(drive.connect('error=x')).rejects.toBeInstanceOf(SyncAuthError);
    expect(tokens.value).toBeUndefined();
    expect(api.calls).toHaveLength(0);
  });

  it('forgets a token once it runs out or Drive refuses it, so the user signs in again', async () => {
    const api = fakeApi(() => ({ status: 401 }));
    const expired = memoryTokens({ ...token(), expiresAt: NOW - 1 });
    const drive = provider(api, expired);
    expect(await drive.account()).toBeNull();
    await expect(drive.head('d1')).rejects.toBeInstanceOf(SyncAuthError);
    expect(api.calls).toHaveLength(0);

    const refused = memoryTokens(token());
    await expect(provider(api, refused).head('d1')).rejects.toThrow('run out');
    expect(refused.value).toBeUndefined();
  });

  it('leaves for Google’s sign-in page through the one sign-in function', async () => {
    const signIn = vi.fn(async () => {});
    const drive = provider(fakeApi(() => ({})), memoryTokens(), signIn);
    await drive.signIn!({ then: 'open', projectId: null });
    expect(signIn).toHaveBeenCalledWith({ then: 'open', projectId: null });
  });

  it('creates a project file in the Puddle folder, making the folder the first time', async () => {
    const api = fakeApi((c) => {
      if (c.method === 'GET' && path(c) === `${DRIVE_API}/files`) return { body: { files: [] } };
      if (c.method === 'POST' && path(c) === `${DRIVE_API}/files`) return { body: { id: 'folder1' } };
      return { body: file('d1', 1) };
    });
    const remote = await provider(api).push({ title: 'Orders', fileName: 'orders.puddle.json', text: '{"a":1}' });
    expect(remote).toEqual({ id: 'd1', title: 'Orders', fileName: 'orders.puddle.json', updatedAt: '2026-10-16T10:00:00.000Z', revision: '1' });
    const [find, make, upload] = api.calls;
    expect(find!.url.searchParams.get('q')).toBe("mimeType='application/vnd.google-apps.folder' and name='Puddle' and trashed=false");
    expect(JSON.parse(make!.body!)).toEqual({ name: 'Puddle', mimeType: 'application/vnd.google-apps.folder' });
    expect(path(upload!)).toBe(`${DRIVE_UPLOAD}/files`);
    expect(upload!.url.searchParams.get('uploadType')).toBe('multipart');
    expect(parts(upload!)).toEqual({
      meta: { name: 'orders.puddle.json', mimeType: 'application/json', parents: ['folder1'], description: 'Puddle project: Orders', appProperties: { puddle: 'project' } },
      content: '{"a":1}',
    });
    expect(api.calls.every((c) => c.auth === 'Bearer tok' && c.cache === 'no-store')).toBe(true);
  });

  it('uses the Puddle folder already there', async () => {
    const api = fakeApi((c) => (c.method === 'GET' ? { body: { files: [{ id: 'folder9' }] } } : { body: file('d1', 1) }));
    await provider(api).push({ title: 'Orders', fileName: 'orders.puddle.json', text: '{}' });
    expect(api.calls.map((c) => c.method)).toEqual(['GET', 'POST']);
    expect(parts(api.calls[1]!).meta.parents).toEqual(['folder9']);
  });

  it('writes over the file only while it is at the version this browser last saw', async () => {
    let version = 4;
    const api = fakeApi((c) => {
      if (c.method === 'PATCH') return { body: file('d1', ++version, { name: 'orders-v2.puddle.json', description: 'Puddle project: Orders v2' }) };
      return { body: file('d1', version) };
    });
    const drive = provider(api);
    const pushed = await drive.push({ title: 'Orders v2', fileName: 'orders-v2.puddle.json', text: '{"v":2}' }, { id: 'd1', revision: '4' });
    expect(pushed).toMatchObject({ revision: '5', title: 'Orders v2', fileName: 'orders-v2.puddle.json' });
    const patch = api.calls.find((c) => c.method === 'PATCH')!;
    expect(path(patch)).toBe(`${DRIVE_UPLOAD}/files/d1`);
    expect(parts(patch)).toEqual({ meta: { name: 'orders-v2.puddle.json', description: 'Puddle project: Orders v2' }, content: '{"v":2}' });

    // Someone else wrote version 6: stop at a conflict and write nothing.
    version = 6;
    const before = api.calls.length;
    await expect(drive.push({ title: 'Orders', fileName: 'orders.puddle.json', text: '{}' }, { id: 'd1', revision: '5' })).rejects.toBeInstanceOf(SyncConflictError);
    expect(api.calls.slice(before).map((c) => c.method)).toEqual(['GET']);
  });

  it('writes a file deleted or binned elsewhere again as a new one', async () => {
    for (const gone of [{ status: 404 }, { body: file('d1', 3, { trashed: true }) }]) {
      const api = fakeApi((c) => {
        if (path(c) === `${DRIVE_API}/files/d1`) return gone;
        if (c.method === 'GET') return { body: { files: [{ id: 'folder1' }] } };
        return { body: file('d2', 1) };
      });
      const remote = await provider(api).push({ title: 'Orders', fileName: 'orders.puddle.json', text: '{}' }, { id: 'd1', revision: '3' });
      expect(remote.id).toBe('d2');
    }
  });

  it('reads the version before the text', async () => {
    const api = fakeApi((c) => (c.url.searchParams.get('alt') === 'media' ? { body: '{"name":"x"}' } : { body: file('d1', 7) }));
    const pulled = await provider(api).pull('d1');
    expect(pulled).toMatchObject({ id: 'd1', revision: '7', text: '{"name":"x"}' });
    expect(api.calls.map((c) => c.url.searchParams.get('alt'))).toEqual([null, 'media']);
  });

  it('lists Puddle’s project files, newest first, across pages', async () => {
    const api = fakeApi((c) =>
      c.url.searchParams.get('pageToken')
        ? { body: { files: [file('d3', 1, { modifiedTime: '2026-10-16T11:00:00.000Z', description: undefined, name: 'later.puddle.json' })] } }
        : { body: { files: [file('d1', 1), file('d2', 1, { modifiedTime: '2026-10-15T10:00:00.000Z' })], nextPageToken: 'p2' } },
    );
    const files = await provider(api).list();
    expect(files.map((f) => [f.id, f.title])).toEqual([
      ['d3', 'later'],
      ['d1', 'Orders'],
      ['d2', 'Orders'],
    ]);
    expect(api.calls[0]!.url.searchParams.get('q')).toBe("appProperties has { key='puddle' and value='project' } and trashed=false");
  });

  it('says plainly when the network, rate limit or Drive gets in the way', async () => {
    await expect(provider(fakeApi(() => 'network')).head('d1')).rejects.toBeInstanceOf(SyncOfflineError);
    await expect(provider(fakeApi(() => ({ status: 403, body: { error: { errors: [{ reason: 'userRateLimitExceeded' }] } } }))).head('d1')).rejects.toThrow('rate limit');
    await expect(provider(fakeApi(() => ({ status: 403, body: { error: { errors: [{ reason: 'insufficientPermissions' }] } } }))).head('d1')).rejects.toThrow('refused');
    const failed = provider(fakeApi(() => ({ status: 500 }))).head('d1');
    await expect(failed).rejects.toBeInstanceOf(SyncError);
    await expect(failed).rejects.toThrow('answered 500');
  });
});
