// OData feeds as sources (Add source › From OData feed), the way Power Query's OData Feed reads them: the service's
// $metadata (or, without it, its service document) lists the entity sets, and the chosen one is read as JSON page by
// page, following the server's next links, then handed to DuckDB as CSV with the column types $metadata declares.
// Straight from the browser, with no server of Puddle's own in between, so the service has to allow other sites to
// read it (CORS). Pure apart from DOMParser, which only reading $metadata needs: the runner reads feeds whose columns
// the project already knows, so it never does.
import type { ColumnSchema, Source } from '../model';
import { parseAddress, UrlSourceError } from './address';
import { headHash } from './hash';
import type { Fetched } from './url';

export type ODataVersion = 2 | 4;

/** What a source reads from its service: the entity set, the query options and the columns. */
export type FeedSpec = NonNullable<NonNullable<Source['url']>['odata']>;

/** A sign-in typed into the dialog. Kept in this tab only (odataSignIn.ts), never in the project. */
export type Credentials = { kind: 'basic'; user: string; password: string } | { kind: 'bearer'; token: string };

export interface Property {
  name: string;
  /** The type $metadata gives, such as Edm.Int32 or Trippin.Location. */
  edm: string;
  /** The DuckDB type it is read as. */
  type: string;
}

export interface EntitySet {
  name: string;
  /** Its columns, from $metadata; absent when the service has none. */
  properties?: Property[];
}

export interface Service {
  /** The service root: the address every entity set is under. */
  root: URL;
  version: ODataVersion;
  entitySets: EntitySet[];
}

export interface Connected {
  service: Service;
  /** The entity set the address named, when it named one. */
  entitySet?: string;
  /** Query options carried in the address. */
  select?: string[];
  filter?: string;
  top?: number;
}

export interface ReadOptions {
  credentials?: Credentials;
  fetchImpl?: typeof fetch;
  online?: () => boolean;
  signal?: AbortSignal;
  /** Called after each page, with the rows read so far. */
  onProgress?: (rows: number) => void;
}

export const CORS_MESSAGE =
  'This service doesn’t allow other sites to read it (CORS), so Puddle can’t reach it from your browser, and Puddle has no server of its own to fetch it through. Use a service that allows it, or ask its owner to allow this site.';

const CORS_SIGN_IN = ' With a sign-in, it must also allow the Authorization header.';

// ——— Types ———

const EDM: Record<string, string> = {
  'Edm.String': 'VARCHAR',
  'Edm.Boolean': 'BOOLEAN',
  'Edm.Byte': 'UTINYINT',
  'Edm.SByte': 'TINYINT',
  'Edm.Int16': 'SMALLINT',
  'Edm.Int32': 'INTEGER',
  'Edm.Int64': 'BIGINT',
  'Edm.Single': 'FLOAT',
  'Edm.Double': 'DOUBLE',
  'Edm.Guid': 'UUID',
  'Edm.Date': 'DATE',
  'Edm.TimeOfDay': 'TIME',
  // Version 2's time of day, written as a duration (PT13H20M).
  'Edm.Time': 'TIME',
  'Edm.DateTime': 'TIMESTAMP',
  // Read as the moment in UTC, so it needs no time zone data in the browser.
  'Edm.DateTimeOffset': 'TIMESTAMP',
  'Edm.Duration': 'VARCHAR',
  'Edm.Binary': 'VARCHAR',
};

export interface Facets {
  precision?: string | null;
  scale?: string | null;
}

/**
 * The DuckDB type an EDM type is read as, or undefined for one that isn't in a feed's rows (Edm.Stream). Anything
 * structured (complex types, collections, geography) is read as its JSON text; enums by their member names.
 */
export function duckType(edm: string, facets: Facets = {}, named: (name: string) => string | undefined = () => undefined): string | undefined {
  if (edm.startsWith('Collection(')) return 'VARCHAR';
  if (edm === 'Edm.Stream') return undefined;
  if (edm === 'Edm.Decimal') {
    const p = Number(facets.precision);
    const s = Number(facets.scale ?? 0);
    return Number.isInteger(p) && p >= 1 && p <= 38 && Number.isInteger(s) && s >= 0 && s <= p ? `DECIMAL(${p},${s})` : 'DOUBLE';
  }
  if (EDM[edm]) return EDM[edm];
  if (/^Edm\.(Geography|Geometry)/.test(edm)) return 'VARCHAR';
  return named(edm) ?? 'VARCHAR';
}

// ——— $metadata and the service document ———

const children = (el: Element, name: string) => Array.from(el.children).filter((c) => c.localName === name);

/** The entity sets $metadata declares, each with its columns (inherited ones first) as DuckDB types. */
export function parseMetadata(xml: string): { version: ODataVersion; entitySets: EntitySet[] } {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  const edmx = doc.documentElement;
  if (!edmx || edmx.localName !== 'Edmx' || doc.getElementsByTagName('parsererror').length) throw new UrlSourceError('The service’s $metadata isn’t an OData metadata document.', 'format');
  const version: ODataVersion = edmx.getAttribute('Version')?.startsWith('4') ? 4 : 2;
  const types = new Map<string, Element>();
  const schemas = Array.from(doc.getElementsByTagNameNS('*', 'Schema'));
  for (const schema of schemas) {
    const prefixes = [schema.getAttribute('Namespace'), schema.getAttribute('Alias')].filter((p): p is string => !!p);
    for (const el of Array.from(schema.children)) {
      const name = el.getAttribute('Name');
      if (name && /^(EntityType|ComplexType|EnumType|TypeDefinition)$/.test(el.localName)) for (const p of prefixes) types.set(`${p}.${name}`, el);
    }
  }
  const named = (name: string, seen = new Set<string>()): string | undefined => {
    const el = types.get(name);
    if (!el || seen.has(name)) return undefined;
    seen.add(name);
    if (el.localName === 'TypeDefinition') {
      const under = el.getAttribute('UnderlyingType') ?? 'Edm.String';
      return duckType(under, { precision: el.getAttribute('Precision'), scale: el.getAttribute('Scale') }, (n) => named(n, seen));
    }
    return 'VARCHAR';
  };
  const properties = (typeName: string, seen = new Set<string>()): Property[] => {
    const el = types.get(typeName);
    if (!el || seen.has(typeName)) return [];
    seen.add(typeName);
    const base = el.getAttribute('BaseType');
    const own = children(el, 'Property').flatMap((p): Property[] => {
      const name = p.getAttribute('Name');
      const edm = p.getAttribute('Type') ?? 'Edm.String';
      const type = duckType(edm, { precision: p.getAttribute('Precision'), scale: p.getAttribute('Scale') }, named);
      return name && type ? [{ name, edm, type }] : [];
    });
    return [...(base ? properties(base, seen) : []), ...own];
  };
  const sets = new Map<string, EntitySet>();
  for (const container of Array.from(doc.getElementsByTagNameNS('*', 'EntityContainer')))
    for (const set of children(container, 'EntitySet')) {
      const name = set.getAttribute('Name');
      if (name && !sets.has(name)) sets.set(name, { name, properties: properties(set.getAttribute('EntityType') ?? '') });
    }
  return { version, entitySets: [...sets.values()] };
}

/** The entity sets a JSON service document lists (version 4's `value`, or version 2's `d.EntitySets`). */
export function parseServiceDocument(body: unknown): { version: ODataVersion; entitySets: EntitySet[] } | undefined {
  if (!body || typeof body !== 'object') return undefined;
  const b = body as Record<string, unknown>;
  const d = b.d as Record<string, unknown> | undefined;
  if (d && Array.isArray(d.EntitySets) && d.EntitySets.every((n) => typeof n === 'string')) return { version: 2, entitySets: (d.EntitySets as string[]).map((name) => ({ name })) };
  if (!Array.isArray(b.value)) return undefined;
  const entries = b.value as Record<string, unknown>[];
  // A feed's rows have a `value` too; only a service document's entries all have a name and an address.
  if (!entries.every((e) => e && typeof e.name === 'string' && typeof e.url === 'string')) return undefined;
  return {
    version: '@odata.context' in b ? 4 : 2,
    entitySets: entries.filter((e) => e.kind == null || e.kind === 'EntitySet').map((e) => ({ name: e.name as string })),
  };
}

// ——— Requests ———

const base64 = (text: string) => btoa(String.fromCharCode(...new TextEncoder().encode(text)));

/** The Authorization header a sign-in sends. */
export const authorization = (c: Credentials) => (c.kind === 'basic' ? `Basic ${base64(`${c.user}:${c.password}`)}` : `Bearer ${c.token}`);

const isAbort = (e: unknown) => e instanceof DOMException && e.name === 'AbortError';

/** The message an OData error reply carries: version 4's error.message, or version 2's error.message.value. */
async function serverMessage(res: Response): Promise<string | undefined> {
  try {
    const body = (await res.json()) as { error?: { message?: string | { value?: string } } };
    const m = body.error?.message;
    const text = typeof m === 'string' ? m : m?.value;
    return text?.trim().replace(/\.$/, '') || undefined;
  } catch {
    return undefined;
  }
}

/**
 * GET an address of the service. Credentials go only to the service's own origin, so a next link that points
 * elsewhere never carries them.
 */
async function get(url: URL, accept: string, origin: string, opts: ReadOptions): Promise<Response> {
  const headers: Record<string, string> = { Accept: accept };
  if (opts.credentials && url.origin === origin) headers.Authorization = authorization(opts.credentials);
  let res: Response;
  try {
    res = await (opts.fetchImpl ?? fetch)(url.href, { headers, cache: 'no-store', credentials: 'omit', signal: opts.signal });
  } catch (e) {
    if (isAbort(e)) throw e;
    // Outside a browser (the runner) there's no CORS: the network itself failed.
    if (typeof document === 'undefined') throw new UrlSourceError(`${url.host} can’t be reached: ${e instanceof Error ? e.message : String(e)}.`, 'offline');
    // The browser reports a CORS refusal as a bare network error, with no detail, by design.
    const online = opts.online ?? (() => typeof navigator === 'undefined' || navigator.onLine !== false);
    if (!online()) throw new UrlSourceError(`You’re offline, so ${url.host} can’t be reached. Reconnect, then try again.`, 'offline');
    throw new UrlSourceError(CORS_MESSAGE + (opts.credentials ? CORS_SIGN_IN : ''), 'cors');
  }
  if (res.status === 401 || res.status === 403) {
    const message = opts.credentials
      ? `The service turned down the sign-in (${res.status}). Check the ${opts.credentials.kind === 'basic' ? 'user name and password' : 'token'}, then try again.`
      : `This service needs a sign-in (${res.status}). Choose Basic or Bearer token under Sign-in, then try again.`;
    throw new UrlSourceError(message, 'auth');
  }
  return res;
}

async function fail(res: Response, url: URL): Promise<never> {
  const said = await serverMessage(res);
  const what = res.status === 404 ? 'There’s nothing at this address' : `The service answered ${res.status}${res.statusText ? ` ${res.statusText}` : ''}`;
  throw new UrlSourceError(`${what} (${url.host})${said ? `: ${said}` : ''}. Check the address and the query options, then try again.`, 'status');
}

const withPath = (root: URL, path: string) => new URL(root.href.replace(/\/?$/, '/') + path);

/**
 * Find the service at an address: its $metadata, or failing that its service document. The address may be the
 * service root, its $metadata, or one entity set with query options, as copied from a browser's address bar.
 */
export async function connect(address: string, opts: ReadOptions = {}): Promise<Connected> {
  const url = parseAddress(address);
  const q = url.searchParams;
  const select = q.get('$select')?.split(',').map((s) => s.trim()).filter(Boolean);
  const filter = q.get('$filter')?.trim() || undefined;
  const topText = q.get('$top');
  const top = topText && /^\d+$/.test(topText) && Number(topText) > 0 ? Number(topText) : undefined;
  url.search = '';
  url.pathname = url.pathname.replace(/\/\$metadata$/, '').replace(/\/+$/, '');
  const segments = url.pathname.split('/').filter(Boolean);
  const candidates = [url];
  if (segments.length) {
    const parent = new URL(url.href);
    parent.pathname = '/' + segments.slice(0, -1).join('/');
    candidates.push(parent);
  }
  const last = segments.length ? decodeURIComponent(segments[segments.length - 1]!) : undefined;
  const found = (root: URL, s: { version: ODataVersion; entitySets: EntitySet[] }): Connected => {
    const service: Service = { root, version: s.version, entitySets: s.entitySets };
    const entitySet = root !== url && last && s.entitySets.some((e) => e.name === last) ? last : undefined;
    return { service, ...(entitySet ? { entitySet } : {}), ...(select?.length ? { select } : {}), ...(filter ? { filter } : {}), ...(top ? { top } : {}) };
  };
  // A wrong guess (an entity set's own /$metadata, say) often gets an error page without CORS headers, which the
  // browser reports exactly as it reports a service that blocks other sites. So a refusal only counts once every
  // address has been tried.
  let refused: UrlSourceError | undefined;
  const ask = async (address: URL, accept: string) => {
    try {
      return await get(address, accept, url.origin, opts);
    } catch (e) {
      if (!(e instanceof UrlSourceError) || e.kind !== 'cors') throw e;
      refused ??= e;
      return undefined;
    }
  };
  for (const root of candidates) {
    const res = await ask(withPath(root, '$metadata'), 'application/xml');
    if (!res?.ok) continue;
    const xml = await res.text();
    try {
      const m = parseMetadata(xml);
      if (m.entitySets.length) return found(root, m);
    } catch {
      // Not metadata: the service document may still list the sets.
    }
  }
  for (const root of candidates) {
    const res = await ask(root, 'application/json');
    if (!res?.ok) continue;
    const doc = parseServiceDocument(await res.json().catch(() => undefined));
    if (doc?.entitySets.length) return found(root, doc);
  }
  if (refused) throw refused;
  throw new UrlSourceError(`There’s no OData service at this address (${url.host}): it has no $metadata or service document. Check the address; it’s usually the part before the entity set’s name.`, 'format');
}

// ——— Reading a feed ———

const enc = encodeURIComponent;

/** The address of an entity set with the source's query options. Spaces are written %20, which every server reads. */
export function feedUrl(root: URL, spec: Pick<FeedSpec, 'entitySet' | 'select' | 'filter' | 'top'>): URL {
  const query = [
    spec.select?.length ? `$select=${spec.select.map(enc).join(',')}` : '',
    spec.filter?.trim() ? `$filter=${enc(spec.filter.trim())}` : '',
    spec.top != null ? `$top=${spec.top}` : '',
  ].filter(Boolean);
  const url = withPath(root, enc(spec.entitySet));
  url.search = query.join('&');
  return url;
}

type Row = Record<string, unknown>;

/** One page of a feed: version 4's `value` and `@odata.nextLink` (or 3's `odata.nextLink`), version 2's `d.results` and `__next`. */
export function pageOf(body: unknown): { rows: Row[]; next?: string } {
  const b = body && typeof body === 'object' ? (body as Record<string, unknown>) : undefined;
  const text = (v: unknown) => (typeof v === 'string' && v ? v : undefined);
  if (b && 'd' in b) {
    const d = b.d as Record<string, unknown> | Row[] | null;
    if (Array.isArray(d)) return { rows: d };
    if (d && Array.isArray(d.results)) return { rows: d.results as Row[], next: text(d.__next) };
  }
  if (b && Array.isArray(b.value)) return { rows: b.value as Row[], next: text(b['@odata.nextLink']) ?? text(b['odata.nextLink']) };
  throw new UrlSourceError('The service’s answer isn’t a list of rows. Check that the entity set’s name is right.', 'format');
}

const DATE_V2 = /^\/Date\((-?\d+)(?:[+-]\d{4})?\)\/$/;
const ISO = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}(?::\d{2})?)(\.\d+)?(Z|[+-]\d{2}:?\d{2})?$/;

/** A date and time as DuckDB reads a TIMESTAMP: "2024-03-01 09:30:00.5", in UTC when the value carries an offset. */
export function timestampText(value: string): string {
  const v2 = DATE_V2.exec(value);
  // Version 2 writes milliseconds since 1970 in UTC; the offset after them only says where the value was written.
  if (v2) return new Date(Number(v2[1])).toISOString().replace('T', ' ').replace(/\.000Z$|Z$/, '');
  const m = ISO.exec(value);
  if (!m) return value;
  const [, date, time, frac = '', zone] = m;
  const seconds = time!.length === 5 ? `${time}:00` : time!;
  const fraction = frac.slice(0, 7);
  if (!zone || zone === 'Z') return `${date} ${seconds}${fraction}`;
  const utc = new Date(`${date}T${seconds}${zone.length === 5 ? `${zone.slice(0, 3)}:${zone.slice(3)}` : zone}`);
  return Number.isNaN(utc.getTime()) ? value : `${utc.toISOString().slice(0, 10)} ${utc.toISOString().slice(11, 19)}${fraction}`;
}

/** Version 2's Edm.Time (PT13H20M30S) as a time of day; anything else as it is. */
export function timeText(value: string): string {
  const m = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?$/.exec(value);
  if (!m || value === 'PT') return value;
  const [h = '0', min = '0', s = '0'] = [m[1], m[2], m[3]];
  const [whole, frac] = s.split('.');
  const pad = (n: string) => n.padStart(2, '0');
  return `${pad(h)}:${pad(min)}:${pad(whole!)}${frac ? `.${frac}` : ''}`;
}

const SPECIAL: Record<string, string> = { INF: 'inf', '-INF': '-inf', NaN: 'nan' };

/** One value as CSV text for its DuckDB type, or null. */
export function cellText(value: unknown, type: string | undefined): string | null {
  if (value == null) return null;
  if (typeof value === 'object') return JSON.stringify(value);
  const text = String(value);
  if (type === 'TIMESTAMP' || (type === undefined && DATE_V2.test(text))) return timestampText(text);
  if (type === 'TIME') return timeText(text);
  if ((type === 'DOUBLE' || type === 'FLOAT') && SPECIAL[text]) return SPECIAL[text]!;
  return text;
}

/** A key of a row that is a column: not an annotation (@odata.etag, Name@odata.type) or version 2's __metadata. */
const isColumnKey = (k: string, v: unknown) => !k.includes('@') && !k.startsWith('__') && !(v && typeof v === 'object' && '__deferred' in v);

// Empty strings are quoted, so DuckDB (with allow_quoted_nulls off) keeps them apart from nulls, which are left empty.
const csvField = (v: string | null) => (v == null ? '' : v === '' || /[",\r\n]/.test(v) || v !== v.trim() ? `"${v.replace(/"/g, '""')}"` : v);

/** Rows as CSV with a header row. Without known columns, the columns are every key the rows have, in order of first sight. */
export function rowsToCsv(rows: Row[], columns?: ColumnSchema[]): string {
  let cols = columns;
  if (!cols) {
    const names = new Set<string>();
    for (const r of rows) for (const [k, v] of Object.entries(r)) if (isColumnKey(k, v)) names.add(k);
    cols = [...names].map((name) => ({ name, type: '' }));
  }
  const lines = [cols.map((c) => csvField(c.name)).join(',')];
  for (const r of rows) lines.push(cols.map((c) => csvField(cellText(r[c.name], c.type || undefined))).join(','));
  return lines.join('\n') + '\n';
}

/** The columns a source reads: those $metadata gives the entity set, cut to $select (in its order) when there is one. */
export function feedColumns(set: EntitySet, select?: string[]): ColumnSchema[] | undefined {
  if (!set.properties) return undefined;
  if (!select?.length) return set.properties.map(({ name, type }) => ({ name, type }));
  return select.map((name) => ({ name, type: set.properties!.find((p) => p.name === name)?.type ?? 'VARCHAR' }));
}

/** Read every row of a feed, following next links until the last page or $top rows. */
export async function readFeed(root: URL, spec: FeedSpec, opts: ReadOptions = {}): Promise<{ csv: string; rows: number }> {
  if (spec.auth && !opts.credentials)
    throw new UrlSourceError('Sign in to read this feed. Sign-ins are kept only in the tab they were typed in, never in the project, so they’re asked for again in a new tab.', 'auth');
  const rows: Row[] = [];
  const seen = new Set<string>();
  let url: URL | undefined = feedUrl(root, spec);
  while (url && !seen.has(url.href)) {
    seen.add(url.href);
    const res = await get(url, 'application/json', root.origin, opts);
    if (!res.ok) await fail(res, url);
    const body: unknown = await res.json().catch(() => {
      throw new UrlSourceError('The service didn’t answer with JSON. Check that the address is an OData service.', 'format');
    });
    const page = pageOf(body);
    for (const r of page.rows) rows.push(r);
    if (spec.top != null && rows.length >= spec.top) {
      rows.length = spec.top;
      url = undefined;
    } else url = page.next ? new URL(page.next, url) : undefined;
    opts.onProgress?.(rows.length);
  }
  if (!rows.length && !spec.columns)
    throw new UrlSourceError(`${spec.entitySet} has no rows${spec.filter ? ' that match the filter' : ''}, and the service doesn’t say what its columns are, so there’s nothing to read.`, 'format');
  return { csv: rowsToCsv(rows, spec.columns), rows: rows.length };
}

/** A feed, ready for DuckDB: its CSV and the hash that notices when it changes. */
export async function fetchFeed(root: URL, spec: FeedSpec, opts: ReadOptions = {}): Promise<Fetched & { rows: number }> {
  const { csv, rows } = await readFeed(root, spec, opts);
  const data = new TextEncoder().encode(csv);
  return { format: 'csv', headHash: await headHash(new Blob([data.slice(0, 1024 * 1024)])), size: data.byteLength, data, ranged: false, rows };
}
