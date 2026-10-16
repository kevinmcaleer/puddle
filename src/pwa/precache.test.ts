import { cacheName, precacheList, strategyFor } from './precache';

describe('precacheList', () => {
  it('keeps the app, the eh engine and its extensions and the sample datasets, and leaves out maps, the mvp bundle and the worker itself', () => {
    const files = [
      'index.html',
      'sw.js',
      'precache.json',
      '_headers',
      'manifest.webmanifest',
      'assets/main-abc.js',
      'assets/main-abc.js.map',
      'assets/duckdb-eh-1.wasm',
      'assets/duckdb-mvp-2.wasm',
      'assets/duckdb-browser-eh.worker-3.js',
      'assets/duckdb-browser-mvp.worker-4.js',
      'duckdb-extensions/manifest.json',
      'duckdb-extensions/v1.5.4/wasm_eh/json.duckdb_extension.wasm',
      'duckdb-extensions/v1.5.4/wasm_mvp/json.duckdb_extension.wasm',
      'samples/contacts.csv',
    ];
    expect(precacheList(files)).toEqual([
      './',
      'assets/duckdb-browser-eh.worker-3.js',
      'assets/duckdb-eh-1.wasm',
      'assets/main-abc.js',
      'duckdb-extensions/v1.5.4/wasm_eh/json.duckdb_extension.wasm',
      'index.html',
      'manifest.webmanifest',
      'samples/contacts.csv',
    ]);
  });
});

describe('strategyFor', () => {
  const origin = 'https://puddle.example';
  it('sends pages to the network first, versioned files to the cache, and leaves other sites alone', () => {
    expect(strategyFor(new URL('/', origin), origin, 'navigate')).toBe('page');
    expect(strategyFor(new URL('/assets/main-abc.js', origin), origin, 'cors')).toBe('cache-first');
    // Samples are read by fetch, so offline they come from the cache too.
    expect(strategyFor(new URL('/samples/contacts.csv', origin), origin, 'cors')).toBe('cache-first');
    expect(strategyFor(new URL('/duckdb-extensions/manifest.json', origin), origin, 'cors')).toBe('network');
    expect(strategyFor(new URL('https://elsewhere.example/x.js'), origin, 'cors')).toBe('network');
  });

  it('names each build’s cache apart', () => {
    expect(cacheName('abc')).toBe('puddle-abc');
  });
});
