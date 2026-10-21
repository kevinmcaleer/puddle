// A fetch that answers each request as a real server did, from tests/fixtures/db/<family>/exchanges.json (recorded
// with scripts/record-database.mjs, secrets taken out), for the HTTP drivers' unit and engine tests. `refuse` makes
// it answer a request as a lesser server or user would.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { redact, type Exchange, type Fetch } from '../../src/connect/drivers/http';

export function exchangesFor(family: string): Exchange[] {
  return JSON.parse(readFileSync(join(__dirname, '../fixtures/db', family, 'exchanges.json'), 'utf8')) as Exchange[];
}

/** The replaying fetch, with the requests it answered (URLs and bodies as redacted) on `calls`. */
export type ReplayFetch = Fetch & { calls: { url: string; body?: string }[] };

export function replayFetch(family: string, refuse?: { test: (body: string) => boolean; status: number; response: string }): ReplayFetch {
  const exchanges = exchangesFor(family);
  const calls: { url: string; body?: string }[] = [];
  const f = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const { url, body } = redact(String(input), typeof init?.body === 'string' ? init.body : undefined);
    calls.push({ url, ...(body !== undefined ? { body } : {}) });
    if (refuse?.test(`${url}\n${body ?? ''}`)) return new Response(refuse.response, { status: refuse.status });
    const x = exchanges.find((e) => e.url === url && (e.body ?? '') === (body ?? '') && e.method === (init?.method ?? 'GET'));
    if (!x) throw new Error(`No recording for ${init?.method ?? 'GET'} ${url} ${body ?? ''}`);
    return new Response(x.response, { status: x.status, headers: { 'Content-Type': 'application/json' } });
  }) as ReplayFetch;
  f.calls = calls;
  return f;
}
