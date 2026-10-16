// The main thread's side of the Excel worker. SheetJS is only ever loaded inside the worker.
import type { ExcelOp, ExcelOps, ExcelService } from './service';
import { ExcelError } from './types';

export interface WorkerRequest {
  id: number;
  op: ExcelOp;
  args: unknown;
}

export type WorkerReply = { id: number; ok: true; value: unknown } | { id: number; ok: false; message: string };

/** Call an operation of the Excel worker. Failures reject with an ExcelError whose message can be shown as it is. */
export interface ExcelClient {
  call<K extends ExcelOp>(op: K, args: ExcelOps[K]['args']): Promise<ExcelOps[K]['result']>;
}

/** A client backed by a dedicated worker, started on first use. */
export function workerClient(start: () => Worker = () => new Worker(new URL('./worker.ts', import.meta.url), { type: 'module', name: 'excel' })): ExcelClient {
  let worker: Worker | undefined;
  let next = 1;
  const waiting = new Map<number, { resolve: (v: unknown) => void; reject: (e: unknown) => void }>();
  const fail = (message: string) => {
    for (const w of waiting.values()) w.reject(new ExcelError(message));
    waiting.clear();
    worker?.terminate();
    worker = undefined;
  };
  const get = () => {
    if (worker) return worker;
    worker = start();
    worker.onmessage = (e: MessageEvent<WorkerReply>) => {
      const reply = e.data;
      const w = waiting.get(reply.id);
      if (!w) return;
      waiting.delete(reply.id);
      if (reply.ok) w.resolve(reply.value);
      else w.reject(new ExcelError(reply.message));
    };
    // A worker that dies (out of memory on a huge workbook, most likely) is started afresh on the next call.
    worker.onerror = (e) => {
      e.preventDefault();
      fail('Reading the workbook stopped, probably for lack of memory. Save the sheet as CSV and add that instead.');
    };
    return worker;
  };
  return {
    call(op, args) {
      const id = next++;
      return new Promise((resolve, reject) => {
        waiting.set(id, { resolve: resolve as (v: unknown) => void, reject });
        get().postMessage({ id, op, args } satisfies WorkerRequest);
      });
    },
  };
}

/** A client that runs the service on this thread, for tests. */
export const inProcessClient = (service: ExcelService): ExcelClient => ({ call: (op, args) => service.run(op, args) });

let shared: ExcelClient | undefined;

/** The app's one Excel worker. */
export const excelClient = (): ExcelClient => (shared ??= workerClient());

/** Use another client (tests run the service in process). */
export const setExcelClient = (client: ExcelClient | undefined) => {
  shared = client;
};
