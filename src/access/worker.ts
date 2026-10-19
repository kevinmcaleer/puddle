/// <reference lib="webworker" />
// The Access worker: mdb-reader opens databases and reads their tables here, off the main thread.
import type { WorkerReply } from '../excel/client';
import { transferables } from '../excel/transfer';
import type { AccessRequest } from './client';
import { AccessService } from './service';

const service = new AccessService();

self.onmessage = async (e: MessageEvent<AccessRequest>) => {
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
