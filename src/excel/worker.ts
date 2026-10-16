/// <reference lib="webworker" />
// The Excel worker: SheetJS parses and writes workbooks here, off the main thread.
import { ExcelService, type ExcelOp } from './service';
import { transferables } from './transfer';
import type { WorkerReply, WorkerRequest } from './client';

const service = new ExcelService();

self.onmessage = async (e: MessageEvent<WorkerRequest>) => {
  const { id, op, args } = e.data;
  let reply: WorkerReply;
  try {
    const value = await service.run(op as ExcelOp, args as never);
    reply = { id, ok: true, value };
    (self as DedicatedWorkerGlobalScope).postMessage(reply, transferables(value));
  } catch (err) {
    reply = { id, ok: false, message: err instanceof Error ? err.message : String(err) };
    (self as DedicatedWorkerGlobalScope).postMessage(reply);
  }
};
