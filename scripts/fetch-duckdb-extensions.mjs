#!/usr/bin/env node
// Download DuckDB's json and parquet WASM extensions for the bundled DuckDB version, so the app can serve them
// itself and no request goes to extensions.duckdb.org. Usage: node scripts/fetch-duckdb-extensions.mjs [outDir]
import { mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { createDuckDB, NODE_RUNTIME, VoidLogger } from '@duckdb/duckdb-wasm/blocking';

const EXTENSIONS = ['json', 'parquet'];
const PLATFORMS = ['wasm_eh', 'wasm_mvp'];
const SOURCE = process.env.DUCKDB_EXTENSIONS_SOURCE ?? 'https://extensions.duckdb.org';
const out = process.argv[2] ?? 'public/duckdb-extensions';

// The DuckDB version the WASM build reports is the path its extensions live under.
const dist = dirname(createRequire(import.meta.url).resolve('@duckdb/duckdb-wasm/dist/duckdb-node-blocking.cjs'));
const db = await createDuckDB(
  {
    mvp: { mainModule: join(dist, 'duckdb-mvp.wasm'), mainWorker: join(dist, 'duckdb-node-mvp.worker.cjs') },
    eh: { mainModule: join(dist, 'duckdb-eh.wasm'), mainWorker: join(dist, 'duckdb-node-eh.worker.cjs') },
  },
  new VoidLogger(),
  NODE_RUNTIME,
);
await db.instantiate();
const version = db.getVersion();

for (const platform of PLATFORMS) {
  mkdirSync(join(out, version, platform), { recursive: true });
  for (const ext of EXTENSIONS) {
    const url = `${SOURCE}/${version}/${platform}/${ext}.duckdb_extension.wasm`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Couldn't download ${url}: ${res.status} ${res.statusText}`);
    const body = new Uint8Array(await res.arrayBuffer());
    writeFileSync(join(out, version, platform, `${ext}.duckdb_extension.wasm`), body);
    console.log(`${version}/${platform}/${ext}: ${(body.length / 1e6).toFixed(1)} MB`);
  }
}
writeFileSync(join(out, 'manifest.json'), JSON.stringify({ version, platforms: PLATFORMS, extensions: EXTENSIONS }, null, 2) + '\n');
console.log(`Wrote ${out}/manifest.json`);
