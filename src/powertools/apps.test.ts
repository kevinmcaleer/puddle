import { describe, expect, it, vi } from 'vitest';
import { APPS_URL, BUNDLED_APPS, loadApps, parseApps } from './apps';

const ok = (body: unknown) => vi.fn(async () => new Response(JSON.stringify(body), { status: 200 })) as unknown as typeof fetch;

describe('parseApps', () => {
  it('reads the built-in list, with Puddle in it', () => {
    expect(BUNDLED_APPS.map((a) => a.id)).toEqual(['puddle', 'mermaid-factory', 'wellyboot-bi']);
    expect(BUNDLED_APPS.find((a) => a.id === 'wellyboot-bi')?.status).toBe('soon');
  });

  it('keeps only https addresses on kevspowertools.com', () => {
    const apps = parseApps({
      apps: [
        { id: 'a', name: 'A', url: 'https://a.kevspowertools.com/' },
        { id: 'home', name: 'Home', url: 'https://kevspowertools.com/' },
        { id: 'b', name: 'B', url: 'http://b.kevspowertools.com/' },
        { id: 'c', name: 'C', url: 'https://evil.example/kevspowertools.com' },
        { id: 'd', name: 'D', url: 'https://kevspowertools.com.evil.example/' },
        { id: 'e', name: 'E', url: 'javascript:alert(1)' },
        { id: 'f', name: 'F', url: 'not a url' },
      ],
    });
    expect(apps?.map((a) => a.id)).toEqual(['a', 'home']);
  });

  it('drops entries without an id or name, and repeated ids', () => {
    const apps = parseApps({
      apps: [null, 'x', { name: 'No id', url: 'https://a.kevspowertools.com/' }, { id: 'a', name: ' ', url: 'https://a.kevspowertools.com/' }, { id: 'b', name: 'B', url: 'https://b.kevspowertools.com/' }, { id: 'b', name: 'B again', url: 'https://b.kevspowertools.com/' }],
    });
    expect(apps).toEqual([{ id: 'b', name: 'B', url: 'https://b.kevspowertools.com/', status: 'live' }]);
  });

  it('treats any status but soon as live, and keeps the description', () => {
    const apps = parseApps({ apps: [{ id: 'a', name: 'A', url: 'https://a.kevspowertools.com/', status: 'beta', description: ' Does things ' }, { id: 'b', name: 'B', url: 'https://b.kevspowertools.com/', status: 'soon' }] });
    expect(apps).toEqual([
      { id: 'a', name: 'A', url: 'https://a.kevspowertools.com/', description: 'Does things', status: 'live' },
      { id: 'b', name: 'B', url: 'https://b.kevspowertools.com/', status: 'soon' },
    ]);
  });

  it('gives undefined for a list with nothing usable', () => {
    expect(parseApps(null)).toBeUndefined();
    expect(parseApps({})).toBeUndefined();
    expect(parseApps({ apps: [] })).toBeUndefined();
    expect(parseApps({ apps: [{ id: 'x', name: 'X', url: 'https://example.com/' }] })).toBeUndefined();
  });
});

describe('loadApps', () => {
  it('reads the shared list from the landing page without cookies', async () => {
    const fetcher = ok({ apps: [{ id: 'new', name: 'New tool', url: 'https://new.kevspowertools.com/' }] });
    expect(await loadApps(fetcher)).toEqual([{ id: 'new', name: 'New tool', url: 'https://new.kevspowertools.com/', status: 'live' }]);
    expect(fetcher).toHaveBeenCalledWith(APPS_URL, expect.objectContaining({ credentials: 'omit' }));
  });

  it('falls back to the built-in list when the landing page fails, errs or answers with nonsense', async () => {
    expect(await loadApps(vi.fn(async () => { throw new TypeError('offline'); }) as unknown as typeof fetch)).toBe(BUNDLED_APPS);
    expect(await loadApps(vi.fn(async () => new Response('', { status: 404 })) as unknown as typeof fetch)).toBe(BUNDLED_APPS);
    expect(await loadApps(vi.fn(async () => new Response('<html>', { status: 200 })) as unknown as typeof fetch)).toBe(BUNDLED_APPS);
    expect(await loadApps(ok({ apps: [] }))).toBe(BUNDLED_APPS);
  });

  it('gives up on a landing page that never answers', async () => {
    const hang = vi.fn((_url: string, init: RequestInit) => new Promise<Response>((_, reject) => init.signal!.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))))) as unknown as typeof fetch;
    expect(await loadApps(hang, 10)).toBe(BUNDLED_APPS);
  });
});
