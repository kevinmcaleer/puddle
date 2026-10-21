// Amazon DynamoDB, read over its JSON API with fetch and Signature V4: the same code in the page (the service
// answers a browser with CORS headers, as does DynamoDB Local when started with -cors) and in puddle-connect. The
// tables come from ListTables and DescribeTable (keys, indexes, item counts); since items have no fixed shape, the
// columns are inferred from a sample of them (plan section 5.1), nested maps flattened to a depth, lists and deeper
// maps as JSON text. A table is read with Scan (page by page to the row limit; a scan of a whole table costs its
// read units), a query with PartiQL's ExecuteStatement, which must be a SELECT.
import { sheetToIPC } from '../../excel/arrow';
import type { Catalog, CatalogTable } from '../../model';
import { inferTable } from '../../schema/inferSchema';
import { DEFAULT_DEPTH, documentsToSheet } from '../documents';
import { blankLiterals } from '../statement';
import { ConnectorError, type CatalogDetail, type Connector, type ConnectorContext, type DocColumn, type DocIndex, type DocTable, type ReadRequest, type ReadResult, type TestOutcome } from '../types';
import { base64Bytes, baseUrl, fetchProblem, hostOf, type Fetch } from './http';
import { signRequest, type AwsCredentials } from './sigv4';

export interface DynamoConfig {
  region: string;
  endpoint: string;
  credentials: AwsCredentials;
  depth: number;
}

/** An attribute value as the API writes it. */
export type AttributeValue = { S: string } | { N: string } | { B: string } | { BOOL: boolean } | { NULL: boolean } | { M: Record<string, AttributeValue> } | { L: AttributeValue[] } | { SS: string[] } | { NS: string[] } | { BS: string[] };

export interface KeyElement {
  AttributeName: string;
  KeyType: 'HASH' | 'RANGE';
}

export interface TableDescription {
  TableName: string;
  ItemCount?: number;
  KeySchema?: KeyElement[];
  AttributeDefinitions?: { AttributeName: string; AttributeType: 'S' | 'N' | 'B' }[];
  GlobalSecondaryIndexes?: { IndexName: string; KeySchema: KeyElement[] }[];
  LocalSecondaryIndexes?: { IndexName: string; KeySchema: KeyElement[] }[];
}

/** The settings as a config. The secret is the secret access key; a session token can follow it after a space. */
export function dynamoConfigFor(ctx: ConnectorContext): DynamoConfig {
  const s = ctx.connection.settings;
  const region = String(s.region ?? '').trim();
  if (!region) throw new ConnectorError('Give the region.');
  const accessKeyId = String(s.accessKeyId ?? '').trim();
  if (!accessKeyId) throw new ConnectorError('Give the access key id.');
  const [secretAccessKey = '', sessionToken] = (ctx.secret ?? '').trim().split(/\s+/);
  if (!secretAccessKey) throw new ConnectorError('Give the secret access key to sign in.');
  const endpoint = String(s.endpoint ?? '').trim() ? baseUrl(s.endpoint, 'endpoint') : `https://dynamodb.${region}.amazonaws.com`;
  const depth = Number(s.depth) > 0 ? Math.floor(Number(s.depth)) : DEFAULT_DEPTH;
  return { region, endpoint, credentials: { accessKeyId, secretAccessKey, ...(sessionToken ? { sessionToken } : {}) }, depth };
}

/** An attribute value as JavaScript holds it: numbers where they fit, text otherwise; maps and lists as such. */
export function plainValue(v: AttributeValue): unknown {
  if ('S' in v) return v.S;
  if ('N' in v) return /^-?\d{1,15}(\.\d+)?$/.test(v.N) ? Number(v.N) : v.N;
  if ('BOOL' in v) return v.BOOL;
  if ('NULL' in v) return null;
  if ('B' in v) return base64Bytes(v.B);
  if ('M' in v) return Object.fromEntries(Object.entries(v.M).map(([k, x]) => [k, plainValue(x)]));
  if ('L' in v) return v.L.map(plainValue);
  if ('SS' in v) return v.SS;
  if ('NS' in v) return v.NS.map((n) => (/^-?\d{1,15}(\.\d+)?$/.test(n) ? Number(n) : n));
  if ('BS' in v) return v.BS;
  return null;
}

/** An item as a plain document. */
export const plainItem = (item: Record<string, AttributeValue>): Record<string, unknown> => Object.fromEntries(Object.entries(item).map(([k, v]) => [k, plainValue(v)]));

/** A failure in plain words, without the keys. */
export function dynamoProblem(status: number, text: string, config: DynamoConfig): ConnectorError {
  let type = '';
  let message = text.trim();
  try {
    const j = JSON.parse(text) as { __type?: string; message?: string; Message?: string };
    type = (j.__type ?? '').replace(/^.*#/, '');
    message = j.message ?? j.Message ?? message;
  } catch {
    // Plain text.
  }
  if (type === 'UnrecognizedClientException' || type === 'InvalidSignatureException' || type === 'IncompleteSignatureException' || status === 403) return new ConnectorError('DynamoDB refused the access key id or secret access key.');
  if (type === 'AccessDeniedException') return new ConnectorError(`The access key may not do that: ${message}`);
  if (type === 'ResourceNotFoundException') return new ConnectorError(`There is no such table in ${config.region}.`);
  if (type === 'ProvisionedThroughputExceededException' || type === 'ThrottlingException') return new ConnectorError('DynamoDB is throttling the read; try a smaller row limit or later.');
  if (type === 'ValidationException') return new ConnectorError(`DynamoDB answered: ${message}`);
  return new ConnectorError(`DynamoDB answered: ${type ? `${type}: ` : ''}${message || `status ${status}`}`);
}

/** Why a PartiQL statement can't run here, or undefined when it is one SELECT. */
export function statementProblem(statement: string): string | undefined {
  const blank = blankLiterals(statement).trim().replace(/;\s*$/, '');
  if (!blank.trim()) return 'The query is empty.';
  if (blank.includes(';')) return 'One statement at a time: the query has a semicolon in it.';
  const word = /^[(\s]*([A-Za-z_]+)/.exec(blank)?.[1]?.toLowerCase();
  if (word !== 'select') return `Only a SELECT can run here, not ${word ? word.toUpperCase() : 'that'}.`;
  return undefined;
}

/** A table name as PartiQL quotes it. */
export const quoteTable = (name: string) => `"${name.replaceAll('"', '""')}"`;

const keyType = (type: 'S' | 'N' | 'B' | undefined): string => (type === 'N' ? 'DOUBLE' : type === 'B' ? 'BLOB' : 'VARCHAR');

export interface DynamoTableInfo {
  description: TableDescription;
  sample: Record<string, unknown>[];
}

const keyNames = (d: TableDescription) => (d.KeySchema ?? []).map((k) => k.AttributeName);

/** The catalogue: the keys first with their declared types, then the columns the sampled items show. */
export function catalogFromTables(tables: DynamoTableInfo[], depth: number): Catalog {
  return {
    tables: tables.map(({ description: d, sample }): CatalogTable => {
      const types = new Map((d.AttributeDefinitions ?? []).map((a) => [a.AttributeName, a.AttributeType]));
      const keys = keyNames(d);
      const { columns, sqlTypes } = documentsToSheet(sample, depth);
      const seen = new Map(columns.map((c, i) => [c.name, { type: sqlTypes[i]!, nullable: c.values.some((v) => v === null) }]));
      const rest = columns.filter((c) => !keys.includes(c.name)).map((c) => ({ name: c.name, type: seen.get(c.name)!.type, nullable: seen.get(c.name)!.nullable }));
      return { name: d.TableName, kind: 'table', ...(d.ItemCount !== undefined ? { rows: d.ItemCount } : {}), columns: [...keys.map((k) => ({ name: k, type: seen.get(k)?.type ?? keyType(types.get(k)), nullable: false })), ...rest] };
    }),
  };
}

/** The schema in detail: the inferred table from the sample, with the key schema as the primary key and the indexes. */
export function detailFromTables(tables: DynamoTableInfo[], at: Date, depth: number): CatalogDetail {
  return {
    tables: tables.map(({ description: d, sample }): DocTable => {
      const keys = keyNames(d);
      const types = new Map((d.AttributeDefinitions ?? []).map((a) => [a.AttributeName, a.AttributeType]));
      const inferred = inferTable(d.TableName, sample, at, { depth, keys: [] });
      const columns: DocColumn[] = inferred.columns.map((c) => (keys.includes(c.name) ? { ...c, pk: true, unique: keys.length === 1, notNull: true } : c));
      for (const k of keys) if (!columns.some((c) => c.name === k)) columns.unshift({ name: k, type: types.get(k) === 'N' ? 'number' : types.get(k) === 'B' ? 'binary' : 'string', pk: true, unique: keys.length === 1, notNull: true, increment: false });
      columns.sort((a, b) => Number(keys.includes(b.name)) - Number(keys.includes(a.name)) || (keys.includes(a.name) ? keys.indexOf(a.name) - keys.indexOf(b.name) : 0));
      const indexes: DocIndex[] = [...(d.GlobalSecondaryIndexes ?? []), ...(d.LocalSecondaryIndexes ?? [])].map((i) => ({ name: i.IndexName, columns: i.KeySchema.map((k) => k.AttributeName), unique: false }));
      const note = `${keys.length === 2 ? `Partition key ${keys[0]}, sort key ${keys[1]}` : `Partition key ${keys[0] ?? '?'}`}. ${inferred.note}`;
      return { ...inferred, columns, indexes, note };
    }),
    enums: [],
  };
}

export function dynamoConnector(fetchImpl?: Fetch): Connector {
  const f: Fetch = (input, init) => (fetchImpl ?? fetch)(input, init);

  /** One API call, signed. */
  const call = async <T>(ctx: ConnectorContext, target: string, body: Record<string, unknown>): Promise<T> => {
    const config = dynamoConfigFor(ctx);
    const text = JSON.stringify(body);
    const url = `${config.endpoint}/`;
    const headers = await signRequest({ method: 'POST', url, headers: { 'content-type': 'application/x-amz-json-1.0', 'x-amz-target': `DynamoDB_20120810.${target}` }, body: text, region: config.region, service: 'dynamodb', credentials: config.credentials });
    let res: Response;
    try {
      res = await f(url, { method: 'POST', headers, body: text, signal: ctx.signal });
    } catch (e) {
      throw fetchProblem(e, hostOf(config.endpoint), ctx.signal);
    }
    const answer = await res.text();
    if (!res.ok) throw dynamoProblem(res.status, answer, config);
    try {
      return JSON.parse(answer) as T;
    } catch {
      throw new ConnectorError(`Nothing at ${hostOf(config.endpoint)} answers as DynamoDB.`);
    }
  };

  const tableNames = async (ctx: ConnectorContext): Promise<string[]> => {
    const names: string[] = [];
    let start: string | undefined;
    do {
      const r = await call<{ TableNames: string[]; LastEvaluatedTableName?: string }>(ctx, 'ListTables', { Limit: 100, ...(start ? { ExclusiveStartTableName: start } : {}) });
      names.push(...r.TableNames);
      start = r.LastEvaluatedTableName;
    } while (start);
    return names.sort();
  };

  /** Items scanned page by page, up to `limit` (or every item when none). */
  const scan = async (ctx: ConnectorContext, table: string, limit?: number): Promise<Record<string, unknown>[]> => {
    const items: Record<string, unknown>[] = [];
    let start: Record<string, AttributeValue> | undefined;
    do {
      const r = await call<{ Items: Record<string, AttributeValue>[]; LastEvaluatedKey?: Record<string, AttributeValue> }>(ctx, 'Scan', { TableName: table, ...(limit ? { Limit: Math.min(limit - items.length, 1000) } : {}), ...(start ? { ExclusiveStartKey: start } : {}) });
      items.push(...r.Items.map(plainItem));
      start = r.LastEvaluatedKey;
    } while (start && (!limit || items.length < limit));
    return limit ? items.slice(0, limit) : items;
  };

  const tables = async (ctx: ConnectorContext, sample: number): Promise<DynamoTableInfo[]> => {
    const out: DynamoTableInfo[] = [];
    for (const name of await tableNames(ctx)) {
      const { Table } = await call<{ Table: TableDescription }>(ctx, 'DescribeTable', { TableName: name });
      out.push({ description: Table, sample: await scan(ctx, name, sample) });
    }
    return out;
  };

  return {
    id: 'dynamodb',
    runsIn: ['browser', 'local', 'pi'],
    async test(ctx): Promise<TestOutcome> {
      try {
        const config = dynamoConfigFor(ctx);
        const names = await tableNames(ctx);
        return { ok: true, server: `DynamoDB in ${config.region}, ${names.length} ${names.length === 1 ? 'table' : 'tables'}` };
      } catch (e) {
        if (e instanceof ConnectorError) return { ok: false, reason: e.message };
        throw e;
      }
    },
    async catalog(ctx): Promise<Catalog> {
      return catalogFromTables(await tables(ctx, 100), dynamoConfigFor(ctx).depth);
    },
    async document(ctx): Promise<CatalogDetail> {
      return detailFromTables(await tables(ctx, 1000), new Date(), dynamoConfigFor(ctx).depth);
    },
    async read(ctx, req: ReadRequest): Promise<ReadResult> {
      if (!req.table && !req.query) throw new ConnectorError('Choose a table or write a query.');
      const config = dynamoConfigFor(ctx);
      const limit = req.limit ? Math.max(1, Math.floor(req.limit)) : undefined;
      let items: Record<string, unknown>[];
      if (req.table) items = await scan(ctx, req.table.name, limit);
      else {
        const problem = statementProblem(req.query!);
        if (problem) throw new ConnectorError(problem);
        items = [];
        let next: string | undefined;
        do {
          const r = await call<{ Items: Record<string, AttributeValue>[]; NextToken?: string }>(ctx, 'ExecuteStatement', { Statement: req.query!.trim().replace(/;\s*$/, ''), ...(limit ? { Limit: Math.min(limit - items.length, 1000) } : {}), ...(next ? { NextToken: next } : {}) });
          items.push(...r.Items.map(plainItem));
          next = r.NextToken;
        } while (next && (!limit || items.length < limit));
        if (limit) items = items.slice(0, limit);
      }
      const { columns, sqlTypes } = documentsToSheet(items, config.depth);
      return { ipc: sheetToIPC(columns), columns: columns.map((c, i) => ({ name: c.name, sqlType: sqlTypes[i]! })), rows: items.length };
    },
  };
}

export default dynamoConnector();
