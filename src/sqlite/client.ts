// The main thread's side of the SQLite worker. sql.js is only ever loaded inside the worker.
import type { WorkerReply } from '../excel/client';
import type { SqliteOp, SqliteOps, SqliteService } from './service';
import { SqliteError } from './types';

export interface SqliteRequest {
  id: number;
  op: SqliteOp;
  args: unknown;
}

export interface SqliteClient {
  call<K extends SqliteOp>(op: K, args: SqliteOps[K]['args']): Promise<SqliteOps[K]['result']>;
}

/** A client backed by a dedicated worker, started on first use. */
export function workerClient(start: () => Worker = () => new Worker(new URL('./worker.ts', import.meta.url), { type: 'module', name: 'sqlite' })): SqliteClient {
  let worker: Worker | undefined;
  let next = 1;
  const waiting = new Map<number, { resolve: (v: unknown) => void; reject: (e: unknown) => void }>();
  const get = () => {
    if (worker) return worker;
    worker = start();
    worker.onmessage = (e: MessageEvent<WorkerReply>) => {
      const reply = e.data;
      const w = waiting.get(reply.id);
      if (!w) return;
      waiting.delete(reply.id);
      if (reply.ok) w.resolve(reply.value);
      else w.reject(new SqliteError(reply.message));
    };
    worker.onerror = (e) => {
      e.preventDefault();
      for (const w of waiting.values()) w.reject(new SqliteError('Reading the database stopped, probably for lack of memory.'));
      waiting.clear();
      worker?.terminate();
      worker = undefined;
    };
    return worker;
  };
  return {
    call(op, args) {
      const id = next++;
      return new Promise((resolve, reject) => {
        waiting.set(id, { resolve: resolve as (v: unknown) => void, reject });
        get().postMessage({ id, op, args } satisfies SqliteRequest);
      });
    },
  };
}

/** A client that runs the service on this thread, for tests and the runner. */
export const inProcessClient = (service: SqliteService): SqliteClient => ({ call: (op, args) => service.run(op, args) });

let shared: SqliteClient | undefined;

/** The app's one SQLite worker. */
export const sqliteClient = (): SqliteClient => (shared ??= workerClient());

/** Use another client (tests run the service in process). */
export const setSqliteClient = (client: SqliteClient | undefined) => {
  shared = client;
};
