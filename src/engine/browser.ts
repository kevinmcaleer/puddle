import * as duckdb from '@duckdb/duckdb-wasm';
import coiWorker from '@duckdb/duckdb-wasm/dist/duckdb-browser-coi.worker.js?url';
import coiPthreadWorker from '@duckdb/duckdb-wasm/dist/duckdb-browser-coi.pthread.worker.js?url';
import ehWorker from '@duckdb/duckdb-wasm/dist/duckdb-browser-eh.worker.js?url';
import mvpWorker from '@duckdb/duckdb-wasm/dist/duckdb-browser-mvp.worker.js?url';
import coiWasm from '@duckdb/duckdb-wasm/dist/duckdb-coi.wasm?url';
import ehWasm from '@duckdb/duckdb-wasm/dist/duckdb-eh.wasm?url';
import mvpWasm from '@duckdb/duckdb-wasm/dist/duckdb-mvp.wasm?url';
import { Table, type RecordBatch } from 'apache-arrow';
import { cancelled } from './errors';
import type { BundleName, DuckBackend, EngineInfo } from './types';

const BUNDLES: duckdb.DuckDBBundles = {
  mvp: { mainModule: mvpWasm, mainWorker: mvpWorker },
  eh: { mainModule: ehWasm, mainWorker: ehWorker },
  coi: { mainModule: coiWasm, mainWorker: coiWorker, pthreadWorker: coiPthreadWorker },
};

const bundleName = (b: duckdb.DuckDBBundle): BundleName => (b.mainModule === coiWasm ? 'coi' : b.mainModule === ehWasm ? 'eh' : 'mvp');

/**
 * DuckDB-WASM in a dedicated Web Worker. selectBundle picks `coi` (multi-threaded) when the page is
 * cross-origin isolated, `eh` otherwise, and `mvp` only on browsers without WASM exceptions.
 */
export async function createBrowserBackend(): Promise<DuckBackend> {
  const bundle = await duckdb.selectBundle(BUNDLES);
  const worker = new Worker(bundle.mainWorker!);
  const db = new duckdb.AsyncDuckDB(new duckdb.VoidLogger(), worker);
  await db.instantiate(bundle.mainModule, bundle.pthreadWorker);
  await db.open({ path: ':memory:', query: { castBigIntToDouble: false } });
  const conn = await db.connect();

  let spill = false;
  try {
    await conn.query(`SET temp_directory = 'opfs://puddle-tmp'`);
    spill = true;
  } catch {
    // OPFS spill is unavailable in this browser or bundle; DuckDB keeps temporary data in memory.
  }

  const info: EngineInfo = {
    bundle: bundleName(bundle),
    version: await db.getVersion(),
    spill,
    crossOriginIsolated: globalThis.crossOriginIsolated === true,
  };

  return {
    info,
    async query(sql, signal): Promise<Table> {
      if (signal.aborted) throw cancelled();
      const onAbort = () => void conn.cancelSent();
      signal.addEventListener('abort', onAbort, { once: true });
      try {
        // send() streams batches and can be interrupted with cancelSent().
        const reader = await conn.send(sql, true);
        const batches: RecordBatch[] = [];
        for await (const batch of reader) {
          if (signal.aborted) throw cancelled();
          batches.push(batch);
        }
        return batches.length ? new Table(batches) : new Table(reader.schema);
      } finally {
        signal.removeEventListener('abort', onAbort);
      }
    },
    registerFile: (name, file) => db.registerFileHandle(name, file, duckdb.DuckDBDataProtocol.BROWSER_FILEREADER, true),
    registerBuffer: (name, data) => db.registerFileBuffer(name, data),
    dropFile: async (name) => {
      await db.dropFile(name);
    },
    async close() {
      await conn.close();
      await db.terminate();
      worker.terminate();
    },
  };
}
