// DuckDB-WASM's blocking Node build behind the same DuckBackend interface the browser uses,
// so engine and compiler tests run real DuckDB-WASM against fixture files.
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createDuckDB, NODE_RUNTIME, VoidLogger } from '@duckdb/duckdb-wasm/blocking';
import { tableFromIPC } from 'apache-arrow';
import type { DuckBackend } from '../../src/engine/types';
import { cancelled } from '../../src/engine/errors';

const require = createRequire(import.meta.url);
const dist = dirname(require.resolve('@duckdb/duckdb-wasm/dist/duckdb-node-blocking.cjs'));
/**
 * The blocking build loads Arrow through CommonJS, so its tables are instances of a second copy of Arrow's classes
 * that the app's (ESM) Arrow functions don't recognise: tableToIPC writes nothing for them. In the browser DuckDB and
 * the app share one Arrow, so results are passed through IPC here to match.
 */
const cjsArrow = require('apache-arrow') as typeof import('apache-arrow');

/** DuckDB's own lexer (the tokenizer behind its parser), for checking ours against it. Offsets and token types. */
export async function createNodeTokenizer(): Promise<(sql: string) => { offsets: number[]; types: number[] }> {
  const db = await createDuckDB(
    {
      mvp: { mainModule: join(dist, 'duckdb-mvp.wasm'), mainWorker: join(dist, 'duckdb-node-mvp.worker.cjs') },
      eh: { mainModule: join(dist, 'duckdb-eh.wasm'), mainWorker: join(dist, 'duckdb-node-eh.worker.cjs') },
    },
    new VoidLogger(),
    NODE_RUNTIME,
  );
  await db.instantiate();
  return (sql) => db.tokenize(sql);
}

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
  let conn = db.connect();
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
      return tableFromIPC(cjsArrow.tableToIPC(conn.query(sql), 'stream'));
    },
    async registerFile(name, file) {
      db.registerFileBuffer(name, new Uint8Array(await file.arrayBuffer()));
    },
    // The Node build has no HTTP file system here, so an address is fetched whole (tests serve it locally).
    async registerUrl(name, url) {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
      db.registerFileBuffer(name, new Uint8Array(await res.arrayBuffer()));
    },
    async registerBuffer(name, data) {
      db.registerFileBuffer(name, data);
    },
    async dropFile(name) {
      db.dropFile(name);
    },
    async insertArrow(name, ipc) {
      conn.insertArrowFromIPCStream(ipc, { name, create: true });
    },
    async reconnect() {
      conn = db.connect();
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
