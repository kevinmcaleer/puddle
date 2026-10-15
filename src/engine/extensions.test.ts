import { repositoryFor, selfHostedRepository } from './extensions';

const manifest = { version: 'v1.5.4', platforms: ['wasm_eh', 'wasm_mvp'], extensions: ['json', 'parquet'] };
const base = 'https://puddle.example/';

describe('self-hosted extensions', () => {
  it('points DuckDB at the site’s copy when it matches the engine', () => {
    expect(repositoryFor(manifest, 'v1.5.4', 'wasm_eh', base)).toBe('https://puddle.example/duckdb-extensions');
    expect(repositoryFor(manifest, 'v1.5.4', 'wasm_eh', 'https://puddle.example/sub/')).toBe('https://puddle.example/sub/duckdb-extensions');
  });

  it('keeps DuckDB’s default for another version, platform or a broken manifest', () => {
    expect(repositoryFor(manifest, 'v1.6.0', 'wasm_eh', base)).toBeUndefined();
    expect(repositoryFor(manifest, 'v1.5.4', 'wasm_threads', base)).toBeUndefined();
    expect(repositoryFor({ version: 1 }, 'v1.5.4', 'wasm_eh', base)).toBeUndefined();
  });

  it('reads the manifest, and copes when the build has none or the network fails', async () => {
    const ok = (async () => new Response(JSON.stringify(manifest))) as unknown as typeof fetch;
    const missing = (async () => new Response('', { status: 404 })) as unknown as typeof fetch;
    const offline = (async () => {
      throw new TypeError('Failed to fetch');
    }) as unknown as typeof fetch;
    expect(await selfHostedRepository('v1.5.4', 'wasm_eh', base, ok)).toBe('https://puddle.example/duckdb-extensions');
    expect(await selfHostedRepository('v1.5.4', 'wasm_eh', base, missing)).toBeUndefined();
    expect(await selfHostedRepository('v1.5.4', 'wasm_eh', base, offline)).toBeUndefined();
  });
});
