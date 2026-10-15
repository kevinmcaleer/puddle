// DuckDB-WASM's blocking Node build behind the same DuckBackend interface the browser uses,
// so engine and compiler tests run real DuckDB-WASM against fixture files.
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createDuckDB, NODE_RUNTIME, VoidLogger } from '@duckdb/duckdb-wasm/blocking';
import type { DuckBackend } from '../../src/engine/types';
import { cancelled } from '../../src/engine/errors';

const dist = dirname(createRequire(import.meta.url).resolve('@duckdb/duckdb-wasm/dist/duckdb-node-blocking.cjs'));

export async function createNodeBackend(opts: { beforeQuery?: (sql: string) => Promise<void> } = {}): Promise<DuckBackend> {
  const db = await createDuckDB(
    {
      mvp: { mainModule: join(dist, 'duckdb-mvp.wasm'), mainWorker: join(dist, 'duckdb-node-mvp.worker.cjs') },
      eh: { mainModule: join(dist, 'duckdb-eh.wasm'), mainWorker: join(dist, 'duckdb-node-eh.worker.cjs') },
    },
    new VoidLogger(),
    NODE_RUNTIME,
  );
  await db.instantiate();
  db.open({ path: ':memory:', query: { castBigIntToDouble: false } });
  const conn = db.connect();
  // Extensions (json, parquet) download from extensions.duckdb.org on first use, which blocks this
  // synchronous build when offline. Tests stay hermetic: anything needing an extension fails fast instead.
  conn.query('SET autoinstall_known_extensions = false');
  conn.query('SET autoload_known_extensions = false');
  const outDir = mkdtempSync(join(tmpdir(), 'puddle-export-'));
  return {
    info: { bundle: 'eh', version: db.getVersion(), spill: false, crossOriginIsolated: false },
    async query(sql, signal) {
      await opts.beforeQuery?.(sql);
      if (signal.aborted) throw cancelled();
      return conn.query(sql);
    },
    async registerFile(name, file) {
      db.registerFileBuffer(name, new Uint8Array(await file.arrayBuffer()));
    },
    async registerBuffer(name, data) {
      db.registerFileBuffer(name, data);
    },
    async dropFile(name) {
      db.dropFile(name);
    },
    // The Node build's COPY writes to the real disk, so exports go to a temp folder and are read back from it.
    async openOutput(name) {
      const path = join(outDir, name);
      return {
        path,
        async finish() {
          const data = readFileSync(path);
          rmSync(path, { force: true });
          return new Blob([data]);
        },
        async discard() {
          rmSync(path, { force: true });
        },
      };
    },
    async close() {
      conn.close();
      rmSync(outDir, { recursive: true, force: true });
    },
  };
}
