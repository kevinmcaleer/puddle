// A client that answers each call as a real database's client did, from tests/fixtures/db/<family>/calls.json
// (recorded with scripts/record-database.mjs for the families whose client is called rather than queried: MongoDB,
// Redis, Cassandra), for their unit and engine tests. A call is matched by its method and its arguments as the
// recording keeps them; bytes come back as Uint8Array and dates as Date. `refuse` makes a call fail as a lesser
// server or user would.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export interface RecordedCall {
  method: string;
  args: unknown[];
  result: unknown;
}

export function recordedCalls(family: string): RecordedCall[] {
  return JSON.parse(readFileSync(join(__dirname, '../fixtures/db', family, 'calls.json'), 'utf8')) as RecordedCall[];
}

/** A value as the recording keeps it: bytes as base64 under {bytes}, dates as ISO text under {date}, anything with a toJSON as that. */
export function plainDeep(v: unknown): unknown {
  if (v === null || v === undefined) return null;
  if (v instanceof Uint8Array) return { bytes: Buffer.from(v).toString('base64') };
  if (v instanceof Date) return { date: v.toISOString() };
  if (Array.isArray(v)) return v.map(plainDeep);
  if (typeof v === 'object') {
    const j = (v as { toJSON?: () => unknown }).toJSON;
    return typeof j === 'function' ? plainDeep(j.call(v)) : Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, plainDeep(x)]));
  }
  return v;
}

/** A recorded value as the client gave it. */
export function revive(v: unknown): unknown {
  if (v === null || v === undefined) return v;
  if (Array.isArray(v)) return v.map(revive);
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>;
    const keys = Object.keys(o);
    if (keys.length === 1 && keys[0] === 'bytes' && typeof o.bytes === 'string') return new Uint8Array(Buffer.from(o.bytes, 'base64'));
    if (keys.length === 1 && keys[0] === 'date' && typeof o.date === 'string') return new Date(o.date);
    return Object.fromEntries(Object.entries(o).map(([k, x]) => [k, revive(x)]));
  }
  return v;
}

export interface ReplayOptions {
  /** An error to fail a call with, as a lesser server or user would. */
  refuse?: (method: string, args: unknown[]) => Error | undefined;
  onEnd?: () => void;
}

/** The replaying client, typed as the driver's client interface, with the calls it answered on `calls`. */
export type ReplayClient<T> = T & { calls: { method: string; args: unknown[] }[] };

export function replayClient<T extends object>(family: string, options: ReplayOptions = {}): ReplayClient<T> {
  const recorded = recordedCalls(family);
  const calls: { method: string; args: unknown[] }[] = [];
  return new Proxy({} as ReplayClient<T>, {
    get(_, method) {
      if (method === 'calls') return calls;
      if (typeof method !== 'string') return undefined;
      if (method === 'end') return async () => options.onEnd?.();
      if (method === 'then') return undefined;
      return async (...args: unknown[]) => {
        calls.push({ method, args });
        const refused = options.refuse?.(method, args);
        if (refused) throw refused;
        const key = JSON.stringify(plainDeep(args));
        const call = recorded.find((c) => c.method === method && JSON.stringify(c.args) === key);
        if (!call) throw new Error(`No recording for ${method}(${key.slice(1, -1)})`);
        return revive(call.result);
      };
    },
  });
}
