// puddle-connect: the small service that speaks the database protocols a browser cannot (plan sections 3.7 and 4).
// Plain Node http, no state between requests: each request carries the connection's settings and the secret for
// that request only. It is not a fetch proxy: there is no route that takes a URL, only drivers that open databases,
// and only to hosts on the allowlist when it listens beyond this computer.
//   npx puddle-connect --origin https://puddle.kevspowertools.com     (a laptop: binds 127.0.0.1:8765)
//   PUDDLE_CONNECT_TOKEN=… PUDDLE_CONNECT_ALLOW=db.local,10.0.0.0/8 puddle-connect --host 0.0.0.0   (the Pi)
import { randomUUID } from 'node:crypto';
import { createServer as createHttpServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import type { Connection, DriverId } from '../model';
import { isAllowed, isLoopback, parseAllow, type AllowRule } from './allow';
import { bearer, tokenMatches } from './auth';
import { nodeConnectors } from './node';
import { statementProblem } from './statement';
import { ConnectorError, type Connector, type ReadRequest } from './types';

export const VERSION = '0.1.0';

export interface ServerOptions {
  host: string;
  port: number;
  /** Origins the browser may call from (CORS). The loopback dev and preview origins are added when bound to loopback. */
  origins: string[];
  token?: string;
  /** Hosts the drivers may connect to. On loopback with none given, any host; elsewhere none. */
  allow: AllowRule[];
  /** Folders the file drivers may read. */
  files: string[];
  timeoutMs: number;
  /** The most rows one read returns. */
  rowCap: number;
  /** Reads running at once. */
  concurrent: number;
  log: (line: string) => void;
}

export const DEFAULT_PORT = 8765;
const BODY_LIMIT = 64 * 1024;
const DEV_ORIGINS = ['http://localhost:5173', 'http://localhost:4173', 'http://127.0.0.1:5173', 'http://127.0.0.1:4173'];

/** What the command line and environment say; a problem comes back as `error`. */
export function parseArgs(argv: string[], env: NodeJS.ProcessEnv): { options?: ServerOptions; error?: string } {
  const opts: ServerOptions = {
    host: env.PUDDLE_CONNECT_HOST || '127.0.0.1',
    port: Number(env.PUDDLE_CONNECT_PORT || DEFAULT_PORT),
    origins: (env.PUDDLE_CONNECT_ORIGIN ?? '').split(/[\s,]+/).filter(Boolean),
    token: env.PUDDLE_CONNECT_TOKEN || undefined,
    allow: [],
    files: (env.PUDDLE_CONNECT_FILES ?? '').split(/[,\n]+/).map((f) => f.trim()).filter(Boolean),
    timeoutMs: Number(env.PUDDLE_CONNECT_TIMEOUT || 60) * 1000,
    rowCap: Number(env.PUDDLE_CONNECT_ROWS || 1_000_000),
    concurrent: 4,
    log: (line) => console.log(`${new Date().toISOString()} ${line}`),
  };
  let allowText = env.PUDDLE_CONNECT_ALLOW ?? '';
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    const value = () => {
      const v = argv[++i];
      if (v === undefined) throw new Error(`${a} needs a value`);
      return v;
    };
    try {
      if (a === '--origin') opts.origins.push(...value().split(/[\s,]+/).filter(Boolean));
      else if (a === '--port') opts.port = Number(value());
      else if (a === '--host') opts.host = value();
      else if (a === '--allow') allowText += `,${value()}`;
      else if (a === '--files') opts.files.push(...value().split(',').map((f) => f.trim()).filter(Boolean));
      else if (a === '--timeout') opts.timeoutMs = Number(value()) * 1000;
      else if (a === '--token') return { error: 'Put the token in PUDDLE_CONNECT_TOKEN, not on the command line, where other users of this computer can read it.' };
      else if (a === '--help' || a === '-h') return { error: USAGE };
      else return { error: `Unknown option ${a}\n\n${USAGE}` };
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) };
    }
  }
  if (!Number.isInteger(opts.port) || opts.port < 1 || opts.port > 65535) return { error: 'The port must be a number from 1 to 65535.' };
  if (!(opts.timeoutMs > 0)) return { error: 'The timeout must be a number of seconds.' };
  const allow = parseAllow(allowText);
  if (allow.errors.length) return { error: `PUDDLE_CONNECT_ALLOW: ${allow.errors.join('; ')}` };
  opts.allow = allow.rules;
  const loopback = isLoopback(opts.host);
  if (!loopback && !opts.token) return { error: `puddle-connect listens beyond this computer (${opts.host}), so it needs PUDDLE_CONNECT_TOKEN set; it refuses to start without one.` };
  if (loopback) {
    opts.origins.push(...DEV_ORIGINS);
    // A laptop's service reads the files its user asks for; the Pi's only the folders it is given.
    if (!opts.files.length) opts.files.push(process.cwd());
  }
  return { options: opts };
}

export const USAGE = `puddle-connect: the database service for Puddle, on this computer or a server.
  puddle-connect [--origin <https://puddle.example>] [--port ${DEFAULT_PORT}] [--host 127.0.0.1] [--allow <hosts>] [--files <folders>] [--timeout <seconds>]
Environment: PUDDLE_CONNECT_TOKEN (required off loopback), PUDDLE_CONNECT_ALLOW (hosts, *.suffixes, addresses or CIDRs the drivers may reach; empty allows none off loopback), PUDDLE_CONNECT_FILES (folders the file drivers may read), PUDDLE_CONNECT_ORIGIN, PUDDLE_CONNECT_TIMEOUT, PUDDLE_CONNECT_ROWS.`;

class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

/** The request's body, as JSON, at most BODY_LIMIT bytes. */
function readBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > BODY_LIMIT) {
        reject(new HttpError(413, 'The request is too large.'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      try {
        resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {});
      } catch {
        reject(new HttpError(400, 'The request isn’t JSON.'));
      }
    });
    req.on('error', (e) => reject(new HttpError(400, e.message)));
  });
}

interface Parsed {
  connection: Connection;
  secret?: string;
  read: ReadRequest;
}

/** The connection a request describes: driver and settings, with the secret for this request; nothing else is read. */
export function parseRequest(body: unknown): Parsed {
  const b = (body ?? {}) as Record<string, unknown>;
  const driver = typeof b.driver === 'string' ? (b.driver as DriverId) : undefined;
  if (!driver) throw new HttpError(400, 'The request names no driver.');
  const settings: Record<string, string | number | boolean> = {};
  if (b.settings && typeof b.settings === 'object') {
    for (const [k, v] of Object.entries(b.settings as Record<string, unknown>)) if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') settings[k] = v;
  }
  const table = b.table && typeof b.table === 'object' && typeof (b.table as { name?: unknown }).name === 'string' ? { ...(typeof (b.table as { schema?: unknown }).schema === 'string' ? { schema: (b.table as { schema: string }).schema } : {}), name: (b.table as { name: string }).name } : undefined;
  const read: ReadRequest = { ...(table ? { table } : {}), ...(typeof b.query === 'string' ? { query: b.query } : {}), ...(typeof b.limit === 'number' && b.limit > 0 ? { limit: Math.floor(b.limit) } : {}) };
  return { connection: { id: 'request', name: '', driver, via: 'local', settings, auth: 'none' }, ...(typeof b.secret === 'string' ? { secret: b.secret } : {}), read };
}

/** The host a connection reaches: its host setting, or the host of its address. */
export function targetHost(settings: Record<string, string | number | boolean>): string | undefined {
  if (typeof settings.host === 'string' && settings.host.trim()) return settings.host.trim();
  if (typeof settings.url === 'string' && settings.url.trim()) {
    try {
      return new URL(settings.url.trim()).hostname || undefined;
    } catch {
      return settings.url.trim();
    }
  }
  return undefined;
}

/** What `/health` answers. */
export interface HealthBody {
  version: string;
  drivers: string[];
  /** Whether an allowlist limits the hosts (always true off loopback). */
  allowlist: boolean;
}

/** The service: an http.Server plus the handler, so tests can call it without a port. */
export function createServer(options: ServerOptions, connectors: Partial<Record<DriverId, Connector>> = nodeConnectors({ files: options.files })): Server {
  const loopback = isLoopback(options.host);
  const reads = new Map<string, AbortController>();
  let running = 0;
  const cors = (req: IncomingMessage, res: ServerResponse) => {
    const origin = req.headers.origin;
    if (origin && options.origins.includes(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
      res.setHeader('Access-Control-Expose-Headers', 'Puddle-Columns, Puddle-Rows, Puddle-Read-Id');
      res.setHeader('Access-Control-Max-Age', '600');
    }
  };
  const json = (res: ServerResponse, status: number, body: unknown) => {
    res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(body));
  };
  const text = (res: ServerResponse, status: number, message: string) => {
    res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(message);
  };
  const hostAllowed = (settings: Record<string, string | number | boolean>) => {
    const host = targetHost(settings);
    if (!host) return true;
    if (loopback && !options.allow.length) return true;
    return isAllowed(host, options.allow);
  };

  const handle = async (req: IncomingMessage, res: ServerResponse) => {
    cors(req, res);
    const route = (req.url ?? '/').split('?')[0]!.replace(/\/+$/, '') || '/';
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }
    // The token comes first, before the body is read.
    if (options.token && !tokenMatches(bearer(req.headers.authorization), options.token)) {
      text(res, 401, 'puddle-connect wants its token (PUDDLE_CONNECT_TOKEN) as a bearer token.');
      return;
    }
    if (route === '/health' && (req.method === 'GET' || req.method === 'POST')) {
      const body: HealthBody = { version: VERSION, drivers: Object.keys(connectors), allowlist: !loopback || options.allow.length > 0 };
      json(res, 200, body);
      return;
    }
    if (req.method !== 'POST') {
      text(res, 405, 'POST only.');
      return;
    }
    if (route === '/cancel') {
      const body = (await readBody(req)) as { id?: unknown };
      const id = typeof body.id === 'string' ? body.id : '';
      reads.get(id)?.abort();
      json(res, 200, { cancelled: reads.has(id) });
      return;
    }
    if (!['/test', '/catalog', '/document', '/read'].includes(route)) {
      text(res, 404, 'No such route. puddle-connect answers /health, /test, /catalog, /document, /read and /cancel.');
      return;
    }
    const { connection, secret, read } = parseRequest(await readBody(req));
    const host = targetHost(connection.settings);
    options.log(`${route.slice(1)} ${connection.driver}${host ? ` ${host}` : ''}`);
    if (!hostAllowed(connection.settings)) {
      text(res, 403, `puddle-connect may not connect to ${host}: it isn’t on the allowlist (PUDDLE_CONNECT_ALLOW).`);
      return;
    }
    const connector = connectors[connection.driver];
    if (!connector) {
      text(res, 501, `This puddle-connect has no ${connection.driver} driver.`);
      return;
    }
    const ctx = { connection, secret };
    if (route === '/test') {
      json(res, 200, await connector.test(ctx));
      return;
    }
    if (route === '/catalog') {
      json(res, 200, await connector.catalog(ctx));
      return;
    }
    if (route === '/document') {
      if (!connector.document) {
        text(res, 501, `The ${connection.driver} driver can’t describe its schema yet.`);
        return;
      }
      json(res, 200, await connector.document(ctx));
      return;
    }
    // A read: one statement that reads, at most the row cap, within the timeout, no more than a few at once.
    if (read.query) {
      const problem = statementProblem(read.query);
      if (problem) {
        text(res, 400, problem);
        return;
      }
    }
    if (running >= options.concurrent) {
      text(res, 503, `puddle-connect is already running ${options.concurrent} reads. Try again in a moment.`);
      return;
    }
    const id = randomUUID();
    const controller = new AbortController();
    reads.set(id, controller);
    running++;
    const timer = setTimeout(() => controller.abort(), options.timeoutMs);
    // The browser dropping the request (a cancel, a closed tab) stops the read as /cancel would.
    const dropped = () => {
      if (!res.writableFinished) controller.abort();
    };
    req.on('close', dropped);
    res.on('close', dropped);
    try {
      const limit = Math.min(read.limit ?? options.rowCap, options.rowCap);
      const result = await Promise.race([
        connector.read({ ...ctx, signal: controller.signal }, { ...read, limit }),
        new Promise<never>((_, reject) => controller.signal.addEventListener('abort', () => reject(new HttpError(499, 'The read was cancelled.')))),
      ]);
      if (controller.signal.aborted) throw new HttpError(499, 'The read was cancelled.');
      if (!('ipc' in result)) throw new HttpError(500, 'This driver answers with a relation, which only the browser can read.');
      res.writeHead(200, { 'Content-Type': 'application/vnd.apache.arrow.stream', 'Cache-Control': 'no-store', 'Puddle-Columns': JSON.stringify(result.columns), 'Puddle-Rows': String(result.rows), 'Puddle-Read-Id': id });
      // Written in pieces, so a cancel between them stops the rest.
      const CHUNK = 256 * 1024;
      for (let at = 0; at < result.ipc.length; at += CHUNK) {
        if (controller.signal.aborted) break;
        const piece = result.ipc.subarray(at, Math.min(at + CHUNK, result.ipc.length));
        if (!res.write(piece)) await new Promise<void>((r) => res.once('drain', r));
      }
      res.end();
    } finally {
      clearTimeout(timer);
      reads.delete(id);
      running--;
    }
  };

  return createHttpServer((req, res) => {
    // The read id is sent before the read starts (once), so /cancel can name it.
    handle(req, res).catch((e: unknown) => {
      if (res.headersSent) {
        res.destroy();
        return;
      }
      if (e instanceof HttpError) text(res, e.status === 499 ? 499 : e.status, e.message);
      else if (e instanceof ConnectorError) text(res, 422, e.message);
      else {
        options.log(`error: ${e instanceof Error ? e.message : String(e)}`);
        text(res, 500, e instanceof Error ? e.message : 'puddle-connect hit a problem.');
      }
    });
  });
}

/** Start from the command line. */
export async function main(argv = process.argv.slice(2), env = process.env): Promise<void> {
  const { options, error } = parseArgs(argv, env);
  if (!options) {
    console.error(error);
    process.exit(error === USAGE ? 0 : 1);
  }
  const server = createServer(options);
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port, options.host, resolve);
  });
  options.log(`puddle-connect ${VERSION} listening on http://${options.host}:${options.port} for ${options.origins.join(', ') || 'no origins'}; ${options.token ? 'token required' : 'no token (loopback)'}; hosts: ${options.allow.length ? `${options.allow.length} allowed` : isLoopback(options.host) ? 'any' : 'none'}; files: ${options.files.join(', ') || 'none'}`);
  const stop = () => server.close(() => process.exit(0));
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) void main();
