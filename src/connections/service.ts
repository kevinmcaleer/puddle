// Reaching puddle-connect, the service that speaks the database protocols a browser cannot (plan section 3.7): on
// this computer at localhost, or on the Pi behind the tunnel at /connect/. This module only finds it and asks it to
// test a connection; reads come with the connector interface (#202) and the service itself (#205).
import { create } from 'zustand';
import type { Connection, ConnectionVia } from '../model';
import { driver } from './drivers';
import { secretFor, SERVICE_TOKEN_ID } from './secrets';

export const LOCAL_SERVICE = 'http://localhost:8765';

export class ConnectionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConnectionError';
  }
}

/** Where the service for a route answers, without a trailing slash. */
export function serviceBase(via: ConnectionVia, base = typeof document === 'undefined' ? 'http://localhost/' : document.baseURI): string {
  if (via === 'local') return LOCAL_SERVICE;
  if (via === 'pi') return new URL('connect', base).href;
  throw new ConnectionError('A connection in the browser needs no service.');
}

export interface Health {
  version: string;
  drivers: string[];
}

export type Fetch = typeof fetch;

/** What a route's service answered, or undefined when nothing answered within a moment. */
export async function probe(via: Exclude<ConnectionVia, 'browser'>, fetchImpl: Fetch = fetch, timeoutMs = 1500): Promise<Health | undefined> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(`${serviceBase(via)}/health`, { signal: controller.signal, headers: headersFor(via) });
    if (!res.ok) return undefined;
    const body = (await res.json()) as Partial<Health>;
    return { version: String(body.version ?? ''), drivers: Array.isArray(body.drivers) ? body.drivers.map(String) : [] };
  } catch {
    return undefined;
  } finally {
    clearTimeout(timer);
  }
}

/** Which routes have a service answering right now; undefined until probed. */
export const useReach = create<{ local?: Health; pi?: Health; probed: boolean }>(() => ({ probed: false }));

export async function refreshReach(fetchImpl: Fetch = fetch) {
  const [local, pi] = await Promise.all([probe('local', fetchImpl), probe('pi', fetchImpl)]);
  useReach.setState({ local, pi, probed: true });
}

/** The Pi's service wants its token on every request; the local one trusts its own computer. */
function headersFor(via: ConnectionVia): Record<string, string> {
  const token = via === 'pi' ? secretFor(SERVICE_TOKEN_ID) : undefined;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/** What the service is told about a connection: its driver and settings, never its name or catalogue, with the secret for this request only. */
export const serviceBody = (connection: Pick<Connection, 'driver' | 'settings'>, secret: string | undefined) => ({ driver: connection.driver, settings: connection.settings, secret });

export interface TestResult {
  ok: boolean;
  /** The server's version line, or why the connection failed. */
  detail: string;
}

const notRunning = (via: ConnectionVia) =>
  via === 'local'
    ? 'puddle-connect isn’t running on this computer. Start it with “npx puddle-connect”, then try again.'
    : 'puddle-connect isn’t answering on the Pi. It runs under the connect profile; see the deployment guide.';

/** Ask the route's service to open the connection and close it again. */
export async function testConnection(connection: Pick<Connection, 'driver' | 'settings' | 'via'>, secret: string | undefined, fetchImpl: Fetch = fetch): Promise<TestResult> {
  const d = driver(connection.driver);
  if (connection.via === 'browser') return { ok: false, detail: `Reading ${d.label} in the browser isn’t built yet.` };
  let res: Response;
  try {
    res = await fetchImpl(`${serviceBase(connection.via)}/test`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headersFor(connection.via) },
      body: JSON.stringify(serviceBody(connection, secret)),
    });
  } catch {
    return { ok: false, detail: notRunning(connection.via) };
  }
  if (res.status === 401) return { ok: false, detail: 'The Pi’s service refused the token. Check it under Where it runs.' };
  if (!res.ok) return { ok: false, detail: `The service answered ${res.status}.` };
  const body = (await res.json()) as { ok?: boolean; server?: string; reason?: string };
  return body.ok ? { ok: true, detail: body.server ?? 'Connected' } : { ok: false, detail: body.reason ?? 'The database refused the connection.' };
}
