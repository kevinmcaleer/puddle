import { PageLoader, type Row } from './pages';

const rows = (page: number, size: number, total: number): Row[] =>
  Array.from({ length: Math.max(0, Math.min(size, total - page * size)) }, (_, i) => [String(page * size + i)]);

describe('page loader', () => {
  it('loads only the pages a visible range touches, once each', async () => {
    const fetch = vi.fn((page: number) => Promise.resolve(rows(page, 10, 35)));
    const loader = new PageLoader(fetch, 10);
    expect(loader.row(0)).toBeUndefined();
    await loader.ensure(8, 5);
    expect(fetch.mock.calls.map(([p]) => p)).toEqual([0, 1]);
    expect(loader.row(12)).toEqual(['12']);
    await Promise.all([loader.ensure(0, 10), loader.ensure(25, 20)]);
    expect(fetch.mock.calls.map(([p]) => p)).toEqual([0, 1, 2, 3, 4]);
    expect(loader.loadedRows).toBe(35);
    expect(loader.row(34)).toEqual(['34']);
  });

  it('shares a page that is still loading', async () => {
    let resolve!: (r: Row[]) => void;
    const fetch = vi.fn(() => new Promise<Row[]>((r) => (resolve = r)));
    const loader = new PageLoader(fetch, 10);
    const a = loader.ensure(0, 5);
    const b = loader.ensure(3, 2);
    resolve(rows(0, 10, 10));
    await Promise.all([a, b]);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('tells subscribers when pages arrive, and keeps the error when one fails', async () => {
    const fetch = vi.fn((page: number) => (page === 1 ? Promise.reject(new Error('boom')) : Promise.resolve(rows(page, 10, 30))));
    const loader = new PageLoader(fetch, 10);
    const seen = vi.fn();
    const off = loader.subscribe(seen);
    await loader.ensure(0, 1);
    expect(seen).toHaveBeenCalledTimes(1);
    await expect(loader.ensure(10, 1)).rejects.toThrow('boom');
    expect((loader.error as Error).message).toBe('boom');
    expect(loader.has(1)).toBe(false);
    off();
    await loader.ensure(20, 1);
    expect(seen).toHaveBeenCalledTimes(2);
  });
});
