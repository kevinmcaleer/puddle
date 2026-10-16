import * as duckdb from '@duckdb/duckdb-wasm';
import ehWorker from '@duckdb/duckdb-wasm/dist/duckdb-browser-eh.worker.js?url';
import mvpWorker from '@duckdb/duckdb-wasm/dist/duckdb-browser-mvp.worker.js?url';
import ehWasm from '@duckdb/duckdb-wasm/dist/duckdb-eh.wasm?url';
import mvpWasm from '@duckdb/duckdb-wasm/dist/duckdb-mvp.wasm?url';
import { Table, type RecordBatch } from 'apache-arrow';
import { setExtensionRepository } from '../compiler/sql';
import { cancelled } from './errors';
import { selfHostedRepository } from './extensions';
import type { BundleName, DuckBackend, EngineInfo, OutputFile } from './types';

// The multi-threaded `coi` bundle is left out: its worker threads never receive files chosen in the browser, so
// any file big enough to be scanned in parallel fails with "No HTML5 file registered" (DuckDB-WASM 1.33).
const BUNDLES: duckdb.DuckDBBundles = {
  mvp: { mainModule: mvpWasm, mainWorker: mvpWorker },
  eh: { mainModule: ehWasm, mainWorker: ehWorker },
};

const bundleName = (b: duckdb.DuckDBBundle): BundleName => (b.mainModule === ehWasm ? 'eh' : 'mvp');

/**
 * A file in DuckDB's in-memory file system, copied out once written. The rows never become JavaScript objects;
 * the file is copied into a Blob once. (OPFS files can't be used: the multi-threaded bundle can't pass their
 * write handles to its threads.)
 */
function memoryOutput(db: duckdb.AsyncDuckDB, name: string): OutputFile {
  return {
    path: name,
    async finish() {
      const data = await db.copyFileToBuffer(name);
      await db.dropFile(name);
      return new Blob([data as Uint8Array<ArrayBuffer>]);
    },
    async discard() {
      await db.dropFile(name).catch(() => undefined);
    },
  };
}

/** DuckDB-WASM in a dedicated Web Worker: `eh`, or `mvp` on browsers without WASM exceptions. */
export async function createBrowserBackend(): Promise<DuckBackend> {
  const bundle = await duckdb.selectBundle(BUNDLES);
  const worker = new Worker(bundle.mainWorker!);
  const db = new duckdb.AsyncDuckDB(new duckdb.VoidLogger(), worker);
  await db.instantiate(bundle.mainModule, bundle.pthreadWorker);
  await db.open({
    path: ':memory:',
    query: { castBigIntToDouble: false },
    // URL sources registered by address (Parquet on servers with range support) are read by HTTP range
    // requests; this build otherwise downloads the whole file on every open.
    filesystem: { forceFullHTTPReads: false, allowFullHTTPReads: true, reliableHeadRequests: true },
  });
  const conn = await db.connect();

  let spill = false;
  try {
    await conn.query(`SET temp_directory = 'opfs://puddle-tmp'`);
    spill = true;
  } catch {
    // OPFS spill is unavailable in this browser or bundle; DuckDB keeps temporary data in memory.
  }

  const name = bundleName(bundle);
  const version = await db.getVersion();
  // Use the extensions this site serves, when its build includes them for this DuckDB version.
  const extensions = await selfHostedRepository(version, `wasm_${name}`, new URL(import.meta.env.BASE_URL, location.href).href);
  if (extensions) for (const sql of setExtensionRepository(extensions)) await conn.query(sql);

  const info: EngineInfo = {
    bundle: name,
    version,
    spill,
    crossOriginIsolated: globalThis.crossOriginIsolated === true,
    extensions: extensions ?? 'https://extensions.duckdb.org',
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
    registerUrl: (name, url) => db.registerFileURL(name, url, duckdb.DuckDBDataProtocol.HTTP, false),
    registerBuffer: (name, data) => db.registerFileBuffer(name, data),
    dropFile: async (name) => {
      await db.dropFile(name);
    },
    insertArrow: (name, ipc) => conn.insertArrowFromIPCStream(ipc, { name, create: true }),
    openOutput: async (name) => memoryOutput(db, name),
    async close() {
      await conn.close();
      await db.terminate();
      worker.terminate();
    },
  };
}
