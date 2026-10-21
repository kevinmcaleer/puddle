// MongoDB, read with the official client in puddle-connect and the runner. A database's collections and views are
// the catalogue; since documents have no fixed shape, a collection's columns are inferred from a sample of them
// (plan section 5.1): nested documents flattened to `parent.child` columns to a depth, deeper ones and arrays as
// JSON text or, when the source asks, one row per element. A table read is find() with the source's filter, a
// query is a shell call, db.orders.find({ … }) or db.orders.aggregate([ … ]), written in JSON (keys may go
// unquoted and strings in single quotes, as in the shell; Extended JSON such as {"$oid": …} is understood). A
// pipeline that writes ($out, $merge) is refused before it is sent; give the user the read role all the same.
import { EJSON } from 'bson';
import { sheetToIPC } from '../../excel/arrow';
import type { Catalog, CatalogTable } from '../../model';
import { inferTable } from '../../schema/inferSchema';
import { DEFAULT_DEPTH, documentsToSheet, shapeFor } from '../documents';
import { ConnectorError, type CatalogDetail, type Connector, type ConnectorContext, type DocIndex, type DocTable, type ReadRequest, type ReadResult, type TestOutcome } from '../types';

export type Document = Record<string, unknown>;

export interface MongoCollectionInfo {
  name: string;
  type: 'collection' | 'view' | 'timeseries';
  /** A view: the collection it reads and the pipeline it runs. */
  viewOn?: string;
  pipeline?: unknown[];
}

export interface MongoIndexInfo {
  name: string;
  key: Record<string, unknown>;
  unique?: boolean;
}

/** What the driver asks of a client, with BSON values already plain (plainBson), so tests can stand in for it. */
export interface MongoClientLike {
  version(): Promise<string>;
  collections(): Promise<MongoCollectionInfo[]>;
  /** An estimate from the collection's metadata, never a scan. */
  count(collection: string): Promise<number>;
  find(collection: string, filter: Document, limit?: number, projection?: Document): Promise<Document[]>;
  aggregate(collection: string, pipeline: Document[]): Promise<Document[]>;
  indexes(collection: string): Promise<MongoIndexInfo[]>;
  end(): Promise<void>;
}

export interface MongoConfig {
  url: string;
  database: string;
  user?: string;
  password?: string;
  authSource?: string;
  depth: number;
}

export type MongoConnect = (config: MongoConfig) => Promise<MongoClientLike>;

type Bson = { _bsontype?: string } & Record<string, unknown>;

/** A value as the client gives it, as plain JavaScript: ids and decimals as text, binary as bytes, dates kept. */
export function plainBson(v: unknown): unknown {
  if (v === null || v === undefined) return null;
  if (Array.isArray(v)) return v.map(plainBson);
  if (v instanceof Date) return v;
  if (v instanceof Uint8Array) return v;
  if (typeof v !== 'object') return v;
  const b = v as Bson;
  switch (b._bsontype) {
    case 'ObjectId':
    case 'ObjectID':
      return (b as { toHexString(): string }).toHexString();
    case 'Decimal128':
    case 'Timestamp':
    case 'BSONSymbol':
    case 'UUID':
      return String(b);
    case 'Long': {
      const n = Number(String(b));
      return Number.isSafeInteger(n) ? n : String(b);
    }
    case 'Int32':
    case 'Double':
      return Number((b as { value: number }).value);
    case 'Binary': {
      const bin = b as { sub_type: number; buffer: Uint8Array; toUUID(): { toString(): string } };
      if (bin.sub_type === 4) {
        try {
          return bin.toUUID().toString();
        } catch {
          // Not a well-formed UUID after all.
        }
      }
      return new Uint8Array(bin.buffer);
    }
    case 'BSONRegExp':
      return `/${String(b.pattern)}/${String(b.options ?? '')}`;
    case 'Code':
      return String(b.code);
    case 'MinKey':
      return 'MinKey';
    case 'MaxKey':
      return 'MaxKey';
    case 'DBRef':
      return { collection: String(b.collection), id: plainBson(b.oid) };
    default:
      return Object.fromEntries(Object.entries(b).map(([k, x]) => [k, plainBson(x)]));
  }
}

const hostOf = (url: string): string => {
  try {
    return new URL(url).host || url;
  } catch {
    return url;
  }
};

/** The settings as a client config. The secret is the password. */
export function mongoConfigFor(ctx: ConnectorContext): MongoConfig {
  const s = ctx.connection.settings;
  const url = String(s.url ?? '').trim();
  if (!/^mongodb(\+srv)?:\/\//i.test(url)) throw new ConnectorError('Give the address as mongodb://host:27017 or mongodb+srv://cluster.example.');
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new ConnectorError('The address isn’t one the client can read.');
  }
  if (parsed.password) throw new ConnectorError('Put the password in the secret, not in the address.');
  const database = String(s.database ?? '').trim();
  if (!database) throw new ConnectorError('Give the database.');
  const user = String(s.user ?? '').trim() || parsed.username;
  const authSource = String(s.authSource ?? '').trim();
  const depth = Number(s.depth) > 0 ? Math.floor(Number(s.depth)) : DEFAULT_DEPTH;
  return { url, database, ...(user ? { user } : {}), ...(ctx.secret !== undefined ? { password: ctx.secret } : {}), ...(authSource ? { authSource } : {}), depth };
}

/** Connects with the official client. */
export const mongoConnect: MongoConnect = async (config) => {
  const { MongoClient } = await import('mongodb');
  const client = new MongoClient(config.url, {
    serverSelectionTimeoutMS: 10_000,
    connectTimeoutMS: 10_000,
    appName: 'puddle',
    ...(config.user ? { auth: { username: config.user, password: config.password ?? '' }, ...(config.authSource ? { authSource: config.authSource } : {}) } : {}),
  });
  await client.connect();
  const db = client.db(config.database);
  return {
    version: async () => String(((await db.command({ buildInfo: 1 })) as { version?: string }).version ?? ''),
    collections: async () =>
      (await db.listCollections({}, { nameOnly: false }).toArray())
        .filter((c) => !c.name.startsWith('system.'))
        .map((c) => {
          const o = (c as { options?: { viewOn?: string; pipeline?: unknown[] } }).options;
          return { name: c.name, type: (c.type === 'view' || c.type === 'timeseries' ? c.type : 'collection') as MongoCollectionInfo['type'], ...(o?.viewOn ? { viewOn: o.viewOn, pipeline: (o.pipeline ?? []).map(plainBson) } : {}) };
        })
        .sort((a, b) => a.name.localeCompare(b.name)),
    count: (collection) => db.collection(collection).estimatedDocumentCount(),
    find: async (collection, filter, limit, projection) => (await db.collection(collection).find(filter, { ...(limit ? { limit } : {}), ...(projection ? { projection } : {}) }).toArray()).map((d) => plainBson(d) as Document),
    aggregate: async (collection, pipeline) => (await db.collection(collection).aggregate(pipeline).toArray()).map((d) => plainBson(d) as Document),
    indexes: async (collection) => {
      try {
        return (await db.collection(collection).listIndexes().toArray()).map((i) => ({ name: String(i.name), key: i.key as Record<string, unknown>, ...(i.unique ? { unique: true } : {}) }));
      } catch {
        // A view has no indexes to list.
        return [];
      }
    },
    end: () => client.close(),
  };
};

/** A client failure in plain words, without echoing anything secret. */
export function mongoProblem(e: unknown, config: MongoConfig): ConnectorError {
  if (e instanceof ConnectorError) return e;
  const err = e as { name?: string; code?: number | string; codeName?: string; message?: string };
  const message = err.message ?? String(e);
  if (err.name === 'MongoServerSelectionError' || /ECONNREFUSED|ENOTFOUND|EAI_AGAIN|ETIMEDOUT|getaddrinfo|Server selection timed out/i.test(message)) return new ConnectorError(`Nothing answers at ${hostOf(config.url)}.`);
  if (/certificate|CERT_|self[- ]signed/i.test(message)) return new ConnectorError(`${hostOf(config.url)}’s certificate isn’t trusted.`);
  if (err.code === 18 || err.codeName === 'AuthenticationFailed' || /Authentication failed/i.test(message)) return new ConnectorError('The database refused the user name or password.');
  if (err.code === 13 || err.codeName === 'Unauthorized' || /not authorized/i.test(message)) return new ConnectorError(`The user may not read that: ${message.replace(/^.*?not authorized/i, 'not authorized')}`);
  if (err.code === 26 || err.codeName === 'NamespaceNotFound') return new ConnectorError('There is no such collection in the database.');
  return new ConnectorError(`MongoDB answered: ${message}`);
}

/**
 * JSON as the shell lets it be written, as strict JSON: unquoted keys quoted, single-quoted strings double-quoted.
 * Strings and their escapes are left as they are.
 */
export function shellJson(text: string): string {
  let out = '';
  let i = 0;
  while (i < text.length) {
    const c = text[i]!;
    if (c === '"' || c === "'") {
      let j = i + 1;
      let s = '';
      while (j < text.length && text[j] !== c) {
        if (text[j] === '\\') {
          // An escaped quote of the other kind needs no escape once the string is double-quoted; the rest stays.
          if (c === "'" && text[j + 1] === "'") s += "'";
          else s += text[j]! + (text[j + 1] ?? '');
          j += 2;
        } else {
          s += c === "'" && text[j] === '"' ? '\\"' : text[j]!;
          j++;
        }
      }
      out += `"${s}"`;
      i = j + 1;
    } else if (/[A-Za-z_$]/.test(c) && /[{,]\s*$/.test(out)) {
      let j = i;
      while (j < text.length && /[\w$]/.test(text[j]!)) j++;
      const word = text.slice(i, j);
      const rest = text.slice(j);
      if (/^\s*:/.test(rest)) out += `"${word}"`;
      else out += word;
      i = j;
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

/** A document written in the shell's JSON (Extended JSON understood), or why it can't be read. */
export function parseDocument(text: string, what: string): Document | Document[] {
  let value: unknown;
  try {
    value = EJSON.parse(shellJson(text), { relaxed: true });
  } catch (e) {
    throw new ConnectorError(`The ${what} isn’t JSON: ${e instanceof Error ? e.message.replace(/^JSON\.parse: /, '').replace(/ in JSON at position \d+.*$/, '') : String(e)}.`);
  }
  if (Array.isArray(value)) return value as Document[];
  if (value && typeof value === 'object') return value as Document;
  throw new ConnectorError(`The ${what} must be a JSON object, such as {"status": "placed"}.`);
}

const WRITES = ['$out', '$merge'];

/** The stage, if any, that would write. */
const writingStage = (pipeline: Document[]): string | undefined => {
  for (const stage of pipeline) {
    if (!stage || typeof stage !== 'object') continue;
    const w = Object.keys(stage).find((k) => WRITES.includes(k));
    if (w) return w;
  }
  return undefined;
};

export interface ShellQuery {
  collection: string;
  find?: Document;
  projection?: Document;
  pipeline?: Document[];
}

/** A shell query, `db.<collection>.find(<filter>[, <projection>])` or `db.<collection>.aggregate(<pipeline>)`, or why it isn't one. */
export function parseShellQuery(text: string): ShellQuery {
  const m = /^\s*db\.(?:([A-Za-z_][\w-]*)|getCollection\(\s*(['"])([^'"]+)\2\s*\))\s*\.\s*(find|aggregate)\s*\(([\s\S]*)\)\s*;?\s*$/.exec(text);
  if (!m) throw new ConnectorError('Write the query as the shell takes it: db.orders.find({ "status": "placed" }) or db.orders.aggregate([ … ]).');
  const collection = m[1] ?? m[3]!;
  const method = m[4]!;
  const args = m[5]!.trim();
  const parsed = args ? parseDocument(`[${args}]`, 'query') : [];
  const list = Array.isArray(parsed) ? parsed : [parsed];
  if (method === 'find') {
    const [find, projection] = list as [Document?, Document?];
    if (find !== undefined && (Array.isArray(find) || typeof find !== 'object')) throw new ConnectorError('find() takes a filter document, such as { "status": "placed" }.');
    return { collection, find: find ?? {}, ...(projection && typeof projection === 'object' && !Array.isArray(projection) ? { projection } : {}) };
  }
  const pipeline = list[0];
  if (!Array.isArray(pipeline)) throw new ConnectorError('aggregate() takes a pipeline: an array of stages.');
  const w = writingStage(pipeline as Document[]);
  if (w) throw new ConnectorError(`A pipeline with ${w} writes; the connection only reads.`);
  return { collection, pipeline: pipeline as Document[] };
}

export interface MongoCollectionSample {
  info: MongoCollectionInfo;
  count?: number;
  sample: Document[];
}

/** The catalogue: each collection with the columns its sampled documents show, `_id` first. */
export function catalogFromCollections(collections: MongoCollectionSample[], depth: number): Catalog {
  return {
    tables: collections.map(({ info, count, sample }): CatalogTable => {
      const { columns, sqlTypes } = documentsToSheet(sample, depth);
      return {
        name: info.name,
        kind: info.type === 'view' ? 'view' : 'table',
        ...(count !== undefined ? { rows: count } : {}),
        columns: columns.map((c, i) => ({ name: c.name, type: sqlTypes[i]!, nullable: c.name !== '_id' && c.values.some((v) => v === null) })),
      };
    }),
  };
}

/** The schema in detail: the inferred table from the sample, `_id` as the key, the indexes, a view's pipeline as its definition. */
export function detailFromCollections(collections: (MongoCollectionSample & { indexes: MongoIndexInfo[] })[], at: Date, depth: number): CatalogDetail {
  return {
    tables: collections.map(({ info, sample, indexes }): DocTable => {
      const inferred = inferTable(info.name, sample, at, { depth, keys: ['_id'] });
      const ix: DocIndex[] = indexes.filter((i) => i.name !== '_id_').map((i) => ({ name: i.name, columns: Object.keys(i.key), unique: !!i.unique }));
      const view = info.type === 'view';
      return {
        ...inferred,
        kind: view ? 'view' : 'table',
        indexes: ix,
        ...(view ? { note: `A view on ${info.viewOn}. ${inferred.note}`, sql: EJSON.stringify(info.pipeline ?? [], undefined, 2, { relaxed: true }) } : {}),
      };
    }),
    enums: [],
  };
}

export function mongoConnector(connect: MongoConnect = mongoConnect): Connector {
  const withClient = async <T>(ctx: ConnectorContext, fn: (client: MongoClientLike, config: MongoConfig) => Promise<T>): Promise<T> => {
    const config = mongoConfigFor(ctx);
    let client: MongoClientLike;
    try {
      client = await connect(config);
    } catch (e) {
      throw mongoProblem(e, config);
    }
    const stop = () => void client.end().catch(() => undefined);
    if (ctx.signal?.aborted) {
      stop();
      throw new ConnectorError('The read was cancelled.');
    }
    ctx.signal?.addEventListener('abort', stop);
    try {
      return await fn(client, config);
    } catch (e) {
      if (ctx.signal?.aborted) throw new ConnectorError('The read was cancelled.');
      throw mongoProblem(e, config);
    } finally {
      ctx.signal?.removeEventListener('abort', stop);
      await client.end().catch(() => undefined);
    }
  };

  const sampled = async (client: MongoClientLike, size: number): Promise<MongoCollectionSample[]> => {
    const out: MongoCollectionSample[] = [];
    for (const info of await client.collections()) {
      const count = info.type === 'view' ? undefined : await client.count(info.name);
      out.push({ info, ...(count !== undefined ? { count } : {}), sample: await client.find(info.name, {}, size) });
    }
    return out;
  };

  return {
    id: 'mongodb',
    runsIn: ['local', 'pi'],
    test: (ctx): Promise<TestOutcome> =>
      withClient(ctx, async (client) => {
        const version = await client.version();
        const n = (await client.collections()).length;
        return { ok: true, server: `MongoDB ${version}, ${n} ${n === 1 ? 'collection' : 'collections'}` };
      }),
    catalog: (ctx) => withClient(ctx, async (client, config) => catalogFromCollections(await sampled(client, 100), config.depth)),
    document: (ctx) =>
      withClient(ctx, async (client, config) => {
        const collections = await sampled(client, 1000);
        const withIndexes = [];
        // A user who may read but not list indexes still gets the schema, without them.
        for (const c of collections) withIndexes.push({ ...c, indexes: c.info.type === 'view' ? [] : await client.indexes(c.info.name).catch(() => []) });
        return detailFromCollections(withIndexes, new Date(), config.depth);
      }),
    read: (ctx, req: ReadRequest): Promise<ReadResult> =>
      withClient(ctx, async (client, config) => {
        if (!req.table && !req.query) throw new ConnectorError('Choose a collection or write a query.');
        const limit = req.limit ? Math.max(1, Math.floor(req.limit)) : undefined;
        let documents: Document[];
        if (req.table) {
          const filter = req.filter?.trim() ? parseDocument(req.filter, 'filter') : {};
          if (Array.isArray(filter)) throw new ConnectorError('The filter must be a JSON object, such as {"status": "placed"}.');
          documents = await client.find(req.table.name, filter, limit);
        } else {
          const q = parseShellQuery(req.query!);
          if (q.pipeline) documents = await client.aggregate(q.collection, limit ? [...q.pipeline, { $limit: limit }] : q.pipeline);
          else documents = await client.find(q.collection, q.find ?? {}, limit, q.projection);
        }
        const shape = shapeFor(req.shape, config.depth);
        const { columns, sqlTypes } = documentsToSheet(documents, shape.depth, shape.arrays);
        return { ipc: sheetToIPC(columns), columns: columns.map((c, i) => ({ name: c.name, sqlType: sqlTypes[i]! })), rows: columns[0]?.values.length ?? 0 };
      }),
  };
}

export default mongoConnector();
