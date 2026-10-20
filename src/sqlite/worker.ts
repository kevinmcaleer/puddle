/// <reference lib="webworker" />
// The SQLite worker: sql.js opens databases and reads their tables here, off the main thread.
import wasmUrl from 'sql.js/dist/sql-wasm.wasm?url';
import type { WorkerReply } from '../excel/client';
import { transferables } from '../excel/transfer';
import type { SqliteRequest } from './client';
import { SqliteService } from './service';

const service = new SqliteService(() => wasmUrl);

self.onmessage = async (e: MessageEvent<SqliteRequest>) => {
  const { id, op, args } = e.data;
  let reply: WorkerReply;
  try {
    const value = await service.run(op, args as never);
    reply = { id, ok: true, value };
    (self as DedicatedWorkerGlobalScope).postMessage(reply, transferables(value));
  } catch (err) {
    reply = { id, ok: false, message: err instanceof Error ? err.message : String(err) };
    (self as DedicatedWorkerGlobalScope).postMessage(reply);
  }
};
