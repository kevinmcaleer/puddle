import { keptLabel, keptNearLimit, keptTotal, keptView, parseMemoryLimit } from './kept';

describe('kept results', () => {
  it('reads DuckDB’s memory limit in bytes', () => {
    expect(parseMemoryLimit('3.1 GiB')).toBe(Math.round(3.1 * 2 ** 30));
    expect(parseMemoryLimit('512.0 MiB')).toBe(512 * 2 ** 20);
    expect(parseMemoryLimit('1GB')).toBe(1e9);
    expect(parseMemoryLimit('2048')).toBe(2048);
    expect(parseMemoryLimit('lots')).toBeNull();
    expect(parseMemoryLimit('3 parsecs')).toBeNull();
  });

  it('says whether a table is current for the node’s upstream', () => {
    expect(keptView(undefined, 'k1')).toEqual({ state: 'stale' });
    expect(keptView({ key: 'k1', bytes: 2048 }, 'k1')).toEqual({ state: 'ready', bytes: 2048 });
    expect(keptView({ key: 'k1', bytes: 2048 }, 'k2')).toEqual({ state: 'stale' });
    expect(keptView({ key: 'k1', building: 'k2' }, 'k2')).toEqual({ state: 'stale' });
    expect(keptView({ key: 'k1', error: { key: 'k2', message: 'Out of memory' } }, 'k2')).toEqual({ state: 'failed', message: 'Out of memory' });
  });

  it('labels a kept node by its memory, or as out of date', () => {
    expect(keptLabel({ state: 'ready', bytes: 5_314_560 })).toBe('5.1 MB kept');
    expect(keptLabel({ state: 'stale' })).toBe('Kept · out of date');
    expect(keptLabel({ state: 'failed', message: 'x' })).toBe('Kept · couldn’t build');
  });

  it('totals kept memory and warns above half the engine’s limit', () => {
    expect(keptTotal({ a: { key: 'k', bytes: 100 }, b: {}, c: { key: 'k', bytes: 50 } })).toBe(150);
    expect(keptNearLimit(150, 1000)).toBe(false);
    expect(keptNearLimit(501, 1000)).toBe(true);
    expect(keptNearLimit(501, null)).toBe(false);
  });
});
