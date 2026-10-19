// The main thread's side of the Access worker. mdb-reader is only ever loaded inside the worker.
import type { WorkerReply } from '../excel/client';
import type { AccessOp, AccessOps, AccessService } from './service';
import { AccessError } from './types';

export interface AccessRequest {
  id: number;
  op: AccessOp;
  args: unknown;
}

/** Call an operation of the Access worker. Failures reject with an AccessError whose message can be shown as it is. */
export interface AccessClient {
  call<K extends AccessOp>(op: K, args: AccessOps[K]['args']): Promise<AccessOps[K]['result']>;
}

/** A client backed by a dedicated worker, started on first use. */
export function workerClient(start: () => Worker = () => new Worker(new URL('./worker.ts', import.meta.url), { type: 'module', name: 'access' })): AccessClient {
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
      else w.reject(new AccessError(reply.message));
    };
    // A worker that dies (out of memory on a huge database, most likely) is started afresh on the next call.
    worker.onerror = (e) => {
      e.preventDefault();
      for (const w of waiting.values()) w.reject(new AccessError('Reading the database stopped, probably for lack of memory. Export the table from Access as CSV and add that instead.'));
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
        get().postMessage({ id, op, args } satisfies AccessRequest);
      });
    },
  };
}

/** A client that runs the service on this thread, for tests. */
export const inProcessClient = (service: AccessService): AccessClient => ({ call: (op, args) => service.run(op, args) });

let shared: AccessClient | undefined;

/** The app's one Access worker. */
export const accessClient = (): AccessClient => (shared ??= workerClient());

/** Use another client (tests run the service in process). */
export const setAccessClient = (client: AccessClient | undefined) => {
  shared = client;
};
