// Redis, read by key pattern: a Redis has no tables, so a pattern such as user:* is one (plan section 5.1), read as
// one row per key with the key and its type, a string's value, a hash's fields as columns, a list or set one row
// per member (a sorted set with its score, a stream one row per entry with its fields) and a RedisJSON value as
// JSON text. Keys are found with SCAN, never KEYS, so a large database is read in pieces. The catalogue groups the
// keys by the text before the first colon (user:*, session:*; keys without one under *). In the browser a Redis with
// a REST interface (Upstash) is read directly over fetch; through puddle-connect the socket client is used, or the
// REST interface when the connection names one. Only reading commands are ever sent.
import { sheetToIPC } from '../../excel/arrow';
import type { Catalog, CatalogTable } from '../../model';
import { inferTable } from '../../schema/inferSchema';
import { documentsToSheet } from '../documents';
import { ConnectorError, type CatalogDetail, type Connector, type ConnectorContext, type DocTable, type ReadRequest, type ReadResult, type TestOutcome } from '../types';
import { baseUrl, fetchProblem, hostOf, type Fetch } from './http';

export type RedisReply = string | number | null | RedisReply[];

/** What the driver asks of a client: one command, or several at once (pipelined), answered as RESP2 does, so tests can stand in for it. */
export interface RedisClientLike {
  send(args: string[]): Promise<RedisReply>;
  sendAll(commands: string[][]): Promise<RedisReply[]>;
  end(): Promise<void>;
}

export interface RedisConfig {
  host?: string;
  port: number;
  db: number;
  user?: string;
  password?: string;
  ssl: boolean;
  /** Upstash's REST address; the password is then the token. */
  rest?: string;
}

export type RedisConnect = (config: RedisConfig, signal?: AbortSignal) => Promise<RedisClientLike>;

type Document = Record<string, unknown>;

/** The settings as a config. The secret is the password, or the REST token. */
export function redisConfigFor(ctx: ConnectorContext): RedisConfig {
  const s = ctx.connection.settings;
  const rest = String(s.rest ?? '').trim();
  const host = String(s.host ?? '').trim();
  if (ctx.connection.via === 'browser' && !rest) throw new ConnectorError('In the browser a Redis is read over its REST interface: give the Upstash REST address.');
  if (!rest && !host) throw new ConnectorError('Give the host, or the Upstash REST address.');
  const user = String(s.user ?? '').trim();
  return { ...(host ? { host } : {}), port: Number(s.port) || 6379, db: Number(s.db) > 0 ? Math.floor(Number(s.db)) : 0, ...(user ? { user } : {}), ...(ctx.secret !== undefined ? { password: ctx.secret } : {}), ssl: s.ssl === true || s.ssl === 'true', ...(rest ? { rest: baseUrl(rest, 'Upstash REST address') } : {}) };
}

/** A client over Upstash's REST interface: a command is POSTed as a JSON array, several to /pipeline. */
export function upstashClient(rest: string, token: string, f: Fetch, signal?: AbortSignal): RedisClientLike {
  const call = async (path: string, body: unknown): Promise<unknown> => {
    let res: Response;
    try {
      res = await f(`${rest}${path}`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal });
    } catch (e) {
      throw fetchProblem(e, hostOf(rest), signal);
    }
    const text = await res.text();
    if (res.status === 401) throw new ConnectorError('Upstash refused the token.');
    let answer: unknown;
    try {
      answer = JSON.parse(text);
    } catch {
      throw new ConnectorError(res.ok ? `Nothing at ${hostOf(rest)} answers as Upstash.` : `Upstash answered ${res.status}: ${text.slice(0, 200)}`);
    }
    if (!res.ok && !(answer && typeof answer === 'object' && 'error' in answer)) throw new ConnectorError(`Upstash answered ${res.status}: ${text.slice(0, 200)}`);
    return answer;
  };
  const unwrap = (x: unknown): RedisReply => {
    const r = x as { result?: RedisReply; error?: string };
    if (r && typeof r === 'object' && typeof r.error === 'string') throw redisProblem(new Error(r.error));
    return r?.result ?? null;
  };
  return {
    send: async (args) => unwrap(await call('', args)),
    sendAll: async (commands) => (commands.length ? ((await call('/pipeline', commands)) as unknown[]).map(unwrap) : []),
    end: async () => undefined,
  };
}

/** A failure in plain words, without echoing the password. */
export function redisProblem(e: unknown, config?: RedisConfig): ConnectorError {
  if (e instanceof ConnectorError) return e;
  const err = e as { code?: string; message?: string };
  const message = (err.message ?? String(e)).replace(/^ERR /, '');
  const where = config?.rest ? hostOf(config.rest) : `${config?.host ?? ''}:${config?.port ?? 6379}`;
  if (/ECONNREFUSED|ENOTFOUND|EAI_AGAIN|ETIMEDOUT|Connection timeout|Socket closed unexpectedly/i.test(`${err.code ?? ''} ${message}`)) return new ConnectorError(`Nothing answers at ${where}.`);
  if (/certificate|CERT_|self[- ]signed/i.test(message)) return new ConnectorError(`${where}’s certificate isn’t trusted.`);
  if (/NOAUTH|WRONGPASS|invalid password|invalid username-password|AUTH <password> called/i.test(message)) return new ConnectorError('Redis refused the user name or password.');
  if (/NOPERM|no permissions/i.test(message)) return new ConnectorError(`The user may not do that: ${message}`);
  if (/^(ERR )?(DB index is out of range|invalid DB index)/i.test(message)) return new ConnectorError('There is no database with that number.');
  return new ConnectorError(`Redis answered: ${message}`);
}

/** A key as a pattern matching only itself: its glob characters escaped. */
export const escapeGlob = (key: string) => key.replace(/[\\*?[\]]/g, (c) => `\\${c}`);

/** The table a key belongs to in the catalogue: the text before its first colon as a pattern, or * for a key without one. */
export const patternOf = (key: string): string => (key.includes(':') ? `${escapeGlob(key.slice(0, key.indexOf(':')))}:*` : '*');

/** Why a key pattern can't be read, or undefined. */
export function patternProblem(pattern: string): string | undefined {
  if (!pattern.trim()) return 'Give a key pattern, such as user:*.';
  if (/[\r\n]/.test(pattern)) return 'A key pattern is one line.';
  return undefined;
}

const str = (v: RedisReply): string | null => (v === null ? null : Array.isArray(v) ? JSON.stringify(v) : String(v));

/**
 * Field and value pairs as HGETALL and ZRANGE WITHSCORES answer them: a flat list over RESP2 and Upstash, a map or a
 * list of [member, score] pairs when the client already paired them (RESP3).
 */
export function pairs(reply: RedisReply): [string, RedisReply][] {
  if (Array.isArray(reply)) {
    if (reply.length > 0 && reply.every((e) => Array.isArray(e) && e.length === 2 && !Array.isArray(e[0]))) return reply.map((e) => [String((e as RedisReply[])[0]), (e as RedisReply[])[1]!]);
    const out: [string, RedisReply][] = [];
    for (let i = 0; i + 1 < reply.length; i += 2) out.push([String(reply[i]), reply[i + 1]!]);
    return out;
  }
  if (reply && typeof reply === 'object') return Object.entries(reply as Record<string, RedisReply>);
  return [];
}

/** The command that reads a key of a type, or none for a type the driver doesn't read. */
export function valueCommand(key: string, type: string): string[] | undefined {
  switch (type) {
    case 'string':
      return ['GET', key];
    case 'hash':
      return ['HGETALL', key];
    case 'list':
      return ['LRANGE', key, '0', '-1'];
    case 'set':
      return ['SMEMBERS', key];
    case 'zset':
      return ['ZRANGE', key, '0', '-1', 'WITHSCORES'];
    case 'stream':
      return ['XRANGE', key, '-', '+'];
    case 'ReJSON-RL':
      return ['JSON.GET', key];
    default:
      return undefined;
  }
}

/** A hash's or stream entry's fields as columns, a field named like a fixed column set apart. */
const fields = (reply: RedisReply): Document => Object.fromEntries(pairs(reply).map(([f, v]) => [f === 'key' || f === 'type' || f === 'id' ? `field.${f}` : f, str(v)]));

/** The rows a key makes from its value. */
export function rowsOf(key: string, type: string, reply: RedisReply | undefined): Document[] {
  switch (type) {
    case 'string':
      return [{ key, type, value: str(reply ?? null) }];
    case 'hash':
      return [{ key, type, ...fields(reply ?? []) }];
    case 'list':
      return (Array.isArray(reply) ? reply : []).map((m, index) => ({ key, type, index, member: str(m) }));
    case 'set':
      return (Array.isArray(reply) ? reply : []).map((m) => ({ key, type, member: str(m) }));
    case 'zset':
      return pairs(reply ?? []).map(([member, score]) => ({ key, type, member, score: Number(score) }));
    case 'stream':
      return (Array.isArray(reply) ? reply : []).map((entry) => {
        const [id, f] = Array.isArray(entry) ? entry : [entry, []];
        return { key, type, id: str(id ?? null), ...fields(f ?? []) };
      });
    case 'ReJSON-RL':
      return [{ key, type: 'json', value: str(reply ?? null) }];
    default:
      return [{ key, type }];
  }
}

/** The keys matching a pattern, scanned in pieces, up to `limit`. Whether the scan reached the end. */
export async function scanKeys(client: RedisClientLike, pattern: string, limit?: number): Promise<{ keys: string[]; complete: boolean }> {
  const keys: string[] = [];
  let cursor = '0';
  do {
    const r = (await client.send(['SCAN', cursor, 'MATCH', pattern, 'COUNT', '500'])) as [RedisReply, RedisReply[]];
    cursor = String(r[0]);
    for (const k of r[1] ?? []) keys.push(String(k));
  } while (cursor !== '0' && (!limit || keys.length < limit));
  const complete = cursor === '0';
  return { keys: limit ? keys.slice(0, limit) : keys, complete };
}

/** The rows of some keys: their types, then their values, each asked in one round trip. */
export async function rowsForKeys(client: RedisClientLike, keys: string[]): Promise<Document[]> {
  const rows: Document[] = [];
  for (let at = 0; at < keys.length; at += 200) {
    const batch = keys.slice(at, at + 200);
    const types = (await client.sendAll(batch.map((k) => ['TYPE', k]))).map((t) => String(t));
    const asked: number[] = [];
    const commands: string[][] = [];
    batch.forEach((k, i) => {
      const c = valueCommand(k, types[i]!);
      if (c) {
        asked.push(i);
        commands.push(c);
      }
    });
    const replies = await client.sendAll(commands);
    const byIndex = new Map(asked.map((i, j) => [i, replies[j]]));
    batch.forEach((k, i) => rows.push(...rowsOf(k, types[i]!, byIndex.get(i))));
  }
  return rows;
}

/** The catalogue's tables from a scan of the keys: one per prefix, with the columns a few of its keys show and a count when the scan was complete. */
export async function catalogFromKeys(client: RedisClientLike, keys: string[], complete: boolean, sample = 50): Promise<Catalog> {
  const groups = new Map<string, string[]>();
  for (const k of keys) groups.set(patternOf(k), [...(groups.get(patternOf(k)) ?? []), k]);
  const tables: CatalogTable[] = [];
  for (const [name, members] of [...groups.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const { columns, sqlTypes } = documentsToSheet(await rowsForKeys(client, members.slice(0, sample)), 1);
    tables.push({ name, kind: 'table', ...(complete ? { rows: members.length } : {}), columns: columns.map((c, i) => ({ name: c.name, type: sqlTypes[i]!, nullable: c.values.some((v) => v === null) })) });
  }
  return { tables };
}

/** The server's version from INFO server, or nothing where INFO isn't answered. */
export const versionOf = (info: RedisReply): string | undefined => /redis_version:(\S+)/.exec(String(info ?? ''))?.[1];

/** Keys found in a scan, with its sample size; 10,000 keys bound the catalogue's scan. */
export const SCAN_SAMPLE = 10_000;

/**
 * The connector. `connect` opens the socket client (puddle-connect gives it; the browser has none and reads over
 * REST only); `fetchImpl` is for the REST interface.
 */
export function redisConnector(connect?: RedisConnect, fetchImpl?: Fetch): Connector {
  const f: Fetch = (input, init) => (fetchImpl ?? fetch)(input, init);
  const withClient = async <T>(ctx: ConnectorContext, fn: (client: RedisClientLike) => Promise<T>): Promise<T> => {
    const config = redisConfigFor(ctx);
    let client: RedisClientLike;
    try {
      if (config.rest) client = upstashClient(config.rest, config.password ?? '', f, ctx.signal);
      else if (connect) client = await connect(config, ctx.signal);
      else throw new ConnectorError('Reading a Redis over its socket needs puddle-connect; in the browser give the Upstash REST address.');
    } catch (e) {
      throw redisProblem(e, config);
    }
    const stop = () => void client.end().catch(() => undefined);
    if (ctx.signal?.aborted) {
      stop();
      throw new ConnectorError('The read was cancelled.');
    }
    ctx.signal?.addEventListener('abort', stop);
    try {
      return await fn(client);
    } catch (e) {
      if (ctx.signal?.aborted) throw new ConnectorError('The read was cancelled.');
      throw redisProblem(e, config);
    } finally {
      ctx.signal?.removeEventListener('abort', stop);
      await client.end().catch(() => undefined);
    }
  };
  return {
    id: 'redis',
    runsIn: ['browser', 'local', 'pi'],
    test: (ctx): Promise<TestOutcome> =>
      withClient(ctx, async (client) => {
        const version = versionOf(await client.send(['INFO', 'server']).catch(() => null));
        const n = Number(await client.send(['DBSIZE']));
        return { ok: true, server: `Redis${version ? ` ${version}` : ''}, ${n.toLocaleString('en-GB')} ${n === 1 ? 'key' : 'keys'}` };
      }),
    catalog: (ctx) =>
      withClient(ctx, async (client) => {
        const { keys, complete } = await scanKeys(client, '*', SCAN_SAMPLE);
        return catalogFromKeys(client, keys, complete);
      }),
    document: (ctx) =>
      withClient(ctx, async (client): Promise<CatalogDetail> => {
        const { keys } = await scanKeys(client, '*', SCAN_SAMPLE);
        const groups = new Map<string, string[]>();
        for (const k of keys) groups.set(patternOf(k), [...(groups.get(patternOf(k)) ?? []), k]);
        const at = new Date();
        const tables: DocTable[] = [];
        for (const [name, members] of [...groups.entries()].sort(([a], [b]) => a.localeCompare(b))) {
          const sample = members.slice(0, 200);
          const inferred = inferTable(name, await rowsForKeys(client, sample), at, { depth: 1, keys: [] });
          tables.push({ ...inferred, note: `Keys matching ${name}. Inferred from ${sample.length.toLocaleString('en-GB')} ${sample.length === 1 ? 'key' : 'keys'} on ${at.toISOString().slice(0, 10)}` });
        }
        return { tables, enums: [] };
      }),
    read: (ctx, req: ReadRequest): Promise<ReadResult> =>
      withClient(ctx, async (client) => {
        const pattern = (req.table ? req.table.name : req.query ?? '').trim();
        const problem = patternProblem(pattern);
        if (problem) throw new ConnectorError(problem);
        const limit = req.limit ? Math.max(1, Math.floor(req.limit)) : undefined;
        const { keys } = await scanKeys(client, pattern, limit);
        const rows = await rowsForKeys(client, keys);
        const kept = limit ? rows.slice(0, limit) : rows;
        const { columns, sqlTypes } = documentsToSheet(kept, 1);
        return { ipc: sheetToIPC(columns), columns: columns.map((c, i) => ({ name: c.name, sqlType: sqlTypes[i]! })), rows: kept.length };
      }),
  };
}

export default redisConnector();
