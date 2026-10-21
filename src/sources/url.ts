import { create } from 'zustand';
import { whenEngine } from '../app/engine';
import { sourceFileName } from '../compiler';
import { invalidateCaches } from '../flow/status';
import { addSource, newId, setSourceFormat, updateSource, useProjectStore, type Source, type SourceFormat } from '../model';
import { rememberFile } from './add';
import { markAttached } from './attachments';
import { isArchiveName, knownFormat } from './detect';
import { parseAddress, UrlSourceError, type UrlErrorKind } from './address';
import { HEAD_BYTES, headHash } from './hash';
import { sniff, TAIL_BYTES } from './sniff';
import { isSampleFile, isShippedFile, sampleAddress, sampleBase } from '../samples/catalog';
import type { HtmlTable } from './html';
import { fetchTable, tableFetched } from './webpage';
import { fetchFeed, type FeedSpec, type ReadOptions } from './odata';
import { rememberSignIn, signInFor } from './odataSignIn';
import { isRewrittenText } from './text';
import { rememberRewriteInput } from './rewrite';
import { rememberXml } from './xml';

/**
 * Sources read from a web address (plan D8). The browser fetches the file itself, so the server must allow
 * other sites to read it (CORS); nothing goes through a proxy. Parquet is read by HTTP range requests where the
 * server supports them; anything else is fetched once per session and handed to DuckDB.
 */

/** The brand book's wording for a server that doesn't send CORS headers. */
export const CORS_MESSAGE = 'This server doesn’t allow other sites to read the file. Download it and drop it here instead.';


export { parseAddress, UrlSourceError, type UrlErrorKind };

/** The address's last path segment, e.g. "orders.csv", or the host when the path has none. */
export function nameFromAddress(url: URL): string {
  const last = url.pathname.split('/').filter(Boolean).pop();
  if (!last) return url.hostname;
  try {
    return decodeURIComponent(last);
  } catch {
    return last;
  }
}

/** The host a source reads from, for the canvas: "data.example.org". */
export function hostOf(href: string): string {
  try {
    return new URL(href).host;
  } catch {
    return href;
  }
}

const BY_CONTENT_TYPE: Record<string, SourceFormat> = {
  'text/csv': 'csv',
  'application/csv': 'csv',
  'text/comma-separated-values': 'csv',
  'text/tab-separated-values': 'tsv',
  'application/json': 'json',
  'text/json': 'json',
  'application/x-ndjson': 'ndjson',
  'application/ndjson': 'ndjson',
  'application/jsonl': 'ndjson',
  'application/x-jsonlines': 'ndjson',
  'application/vnd.apache.parquet': 'parquet',
  'application/x-parquet': 'parquet',
  'application/parquet': 'parquet',
  'application/xml': 'xml',
  'application/yaml': 'yaml',
  'application/x-yaml': 'yaml',
  'text/yaml': 'yaml',
  'text/x-yaml': 'yaml',
  'application/toml': 'toml',
  'text/x-ini': 'ini',
  'application/geo+json': 'geojson',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'word',
  'application/pdf': 'pdf',
  'application/vnd.google-earth.kml+xml': 'xml',
  'application/gpx+xml': 'xml',
  'text/xml': 'xml',
  'application/atom+xml': 'xml',
  'application/rss+xml': 'xml',
};

/** The format a Content-Type names, ignoring parameters such as charset. */
export function formatFromContentType(contentType: string | null | undefined): SourceFormat | undefined {
  const type = contentType?.split(';')[0]?.trim().toLowerCase();
  return type ? BY_CONTENT_TYPE[type] : undefined;
}

/** The file's format: from the address's extension, else the server's Content-Type, or say how to choose one. */
export function formatFromAddress(url: URL, contentType?: string | null): SourceFormat {
  const name = nameFromAddress(url);
  if (isArchiveName(name)) throw new UrlSourceError('Puddle reads a compressed file or a zip archive from a chosen file, not from a web address yet. Download it and add the file.', 'format');
  const byName = knownFormat(name);
  if (byName) return byName;
  const byType = formatFromContentType(contentType);
  if (byType) return byType;
  throw new UrlSourceError('Puddle can’t tell this file’s format from its address or the server’s reply. Choose the format and add it again.', 'format');
}

/** What fetching an address found: either the bytes, or that DuckDB can read it by range requests. */
export interface Fetched {
  format: SourceFormat;
  headHash: string;
  /** Bytes in the file, when the server says. */
  size?: number;
  /** The whole file, when it was fetched. */
  data?: Uint8Array;
  /** True when DuckDB reads the address itself, by HTTP range requests. */
  ranged: boolean;
}

export interface FetchOptions {
  /** Read as this format instead of detecting it. */
  format?: SourceFormat;
  fetchImpl?: typeof fetch;
  online?: () => boolean;
  /**
   * A small file shipped with Puddle (a sample): fetched with one plain same-origin GET, no Range header and the
   * default cache mode and credentials, the same shape as the service worker's precache request, so it is
   * answered from the precache offline in every browser. Read as a typed address (ranged, no-store, no
   * credentials), a sample failed to load offline in Firefox.
   */
  shipped?: boolean;
}

/** How a request is made: addresses typed in skip the HTTP cache and send no cookies; shipped files are plain GETs. */
export const requestInit = (init: RequestInit, opts: Pick<FetchOptions, 'shipped'>): RequestInit =>
  opts.shipped ? init : { ...init, cache: 'no-store', credentials: 'omit' };

const isAbort = (e: unknown) => e instanceof DOMException && e.name === 'AbortError';

async function request(url: URL, init: RequestInit, opts: FetchOptions): Promise<Response> {
  let res: Response;
  try {
    res = await (opts.fetchImpl ?? fetch)(url.href, requestInit(init, opts));
  } catch (e) {
    if (isAbort(e)) throw e;
    // The browser reports a CORS refusal as a bare network error, with no detail, by design.
    const online = opts.online ?? (() => typeof navigator === 'undefined' || navigator.onLine !== false);
    if (!online()) throw new UrlSourceError(`You’re offline, so ${url.host} can’t be reached. Reconnect, then refresh.`, 'offline');
    throw new UrlSourceError(CORS_MESSAGE, 'cors');
  }
  if (!res.ok) {
    const what = res.status === 404 ? 'There’s no file at this address' : `The server answered ${res.status}${res.statusText ? ` ${res.statusText}` : ''}`;
    throw new UrlSourceError(`${what} (${url.host}). Check the address and try again.`, 'status');
  }
  return res;
}

/** The total size from a Content-Range header ("bytes 0-99/1234"), when the server exposes it. */
export function totalFromContentRange(header: string | null): number | undefined {
  const m = header ? /\/(\d+)\s*$/.exec(header) : null;
  return m ? Number(m[1]) : undefined;
}

/**
 * Fetch an address once: the first megabyte by a range request (for the head hash, and to learn whether the
 * server supports ranges), then the rest of the file unless DuckDB can read it by ranges (Parquet). A shipped file
 * is fetched whole in one plain request.
 */
export async function fetchAddress(address: string | URL, opts: FetchOptions = {}): Promise<Fetched> {
  const url = typeof address === 'string' ? parseAddress(address) : address;
  const probe = await request(url, opts.shipped ? {} : { headers: { Range: `bytes=0-${HEAD_BYTES - 1}` } }, opts);
  const format = opts.format ?? formatFromAddress(url, probe.headers.get('content-type'));
  const head = new Uint8Array(await probe.arrayBuffer());
  const hash = await headHash(new Blob([head.slice(0, HEAD_BYTES)]));
  const ranged = probe.status === 206;
  const total = ranged ? totalFromContentRange(probe.headers.get('content-range')) : head.byteLength;
  // The server ignored the range and sent the whole file, or the file ended inside the first megabyte.
  const whole = !ranged || head.byteLength < HEAD_BYTES || (total != null && total <= head.byteLength);
  if (ranged && format === 'parquet') return { format, headHash: hash, size: total, ranged: true };
  if (whole) return { format, headHash: hash, size: head.byteLength, data: head, ranged: false };
  const full = new Uint8Array(await (await request(url, {}, opts)).arrayBuffer());
  return { format, headHash: hash, size: full.byteLength, data: full, ranged: false };
}

/** What happened the last time each URL source was fetched in this tab. */
export type UrlFetch =
  | { state: 'fetching' }
  | { state: 'ok'; at: number; ranged: boolean }
  | { state: 'failed'; kind: UrlErrorKind | 'engine'; message: string };

export const useUrlFetches = create<{ fetches: Record<string, UrlFetch> }>(() => ({ fetches: {} }));

const setFetch = (sourceId: string, f: UrlFetch) => useUrlFetches.setState((s) => ({ fetches: { ...s.fetches, [sourceId]: f } }));

/** True once a URL source's file has been fetched and registered in this tab. */
export const urlFetched = (sourceId: string) => useUrlFetches.getState().fetches[sourceId]?.state === 'ok';

/**
 * Where a URL source is read from: its address, or for a sample shipped with Puddle, the sample next to the app
 * wherever it is served now (so a sample project still reads after a move, and offline from the service worker).
 * Already checked, so it skips parseAddress (a sample on a plain-http LAN host is still same-origin).
 */
export function addressOf(source: Source): URL | string {
  const sample = source.url?.sample;
  if (!isSampleFile(sample)) return source.url?.href ?? '';
  const base = typeof document !== 'undefined' ? document.baseURI : sampleBase(sample, source.url!.href);
  return sampleAddress(sample, base);
}

/**
 * Hand what was fetched to DuckDB under the source's file name, replacing what was there. XML is read into rows
 * first (./xml); a workbook, fetched whole, goes to the Excel worker as a chosen file would (./excel).
 */
async function register(source: Source, fetched: Fetched) {
  if (source.format === 'xml') return void rememberXml(source.id, fetched.data!);
  if (source.format === 'xlsx') return void rememberFile(source.id, new File([fetched.data! as Uint8Array<ArrayBuffer>], source.name));
  // Fixed-width text, pipe tables and structured text are read into rows first too (./rewrite).
  if (isRewrittenText(source)) return void rememberRewriteInput(source.id, fetched.data!);
  const engine = await whenEngine();
  const name = sourceFileName(source);
  await engine.dropFile(name).catch(() => undefined);
  if (fetched.ranged) await engine.registerUrl(name, String(addressOf(source)));
  else await engine.registerBuffer(name, fetched.data!);
}

const failure = (e: unknown): UrlFetch => ({
  state: 'failed',
  kind: e instanceof UrlSourceError ? e.kind : 'engine',
  message: e instanceof Error ? e.message : String(e),
});

/** Add a source from a web address. Throws UrlSourceError, in plain words, when it can't be read. */
export async function addUrlSource(address: string, opts: FetchOptions & { position?: { x: number; y: number } } = {}): Promise<Source> {
  const url = parseAddress(address);
  const fetched = await fetchAddress(url, opts);
  const source: Source = {
    id: newId('s'),
    name: nameFromAddress(url),
    kind: 'url',
    format: fetched.format,
    url: { href: url.href, headHash: fetched.headHash, ...(fetched.size != null ? { size: fetched.size } : {}) },
    parseOptions: {},
    detectedSchema: [],
  };
  await register(source, fetched);
  setFetch(source.id, { state: 'ok', at: Date.now(), ranged: fetched.ranged });
  markAttached(source.id);
  useProjectStore.getState().apply((p) => addSource(p, source, opts.position ?? { x: 80, y: 80 }));
  return source;
}

/** Add a source from a table on a web page, already fetched and read by the From web page dialog. */
export async function addWebTableSource(address: string | URL, table: HtmlTable, opts: { position?: { x: number; y: number } } = {}): Promise<Source> {
  const url = typeof address === 'string' ? parseAddress(address) : address;
  const fetched = await tableFetched(table);
  const page = nameFromAddress(url).replace(/_/g, ' ');
  const source: Source = {
    id: newId('s'),
    name: /^Table \d+$/.test(table.label) ? `${page} ${table.label.toLowerCase()}` : table.label,
    kind: 'url',
    format: 'csv',
    url: { href: url.href, headHash: fetched.headHash, size: fetched.size, table: { index: table.index, label: table.label } },
    parseOptions: {},
    detectedSchema: [],
  };
  await register(source, fetched);
  setFetch(source.id, { state: 'ok', at: Date.now(), ranged: false });
  markAttached(source.id);
  useProjectStore.getState().apply((p) => addSource(p, source, opts.position ?? { x: 80, y: 80 }));
  return source;
}

/**
 * Add a source from an entity set of an OData service, chosen in the From OData feed dialog: every page is read now.
 * A sign-in is kept for this tab only, under the new source's id.
 */
export async function addODataSource(root: URL, spec: FeedSpec, opts: ReadOptions & { position?: { x: number; y: number } } = {}): Promise<Source> {
  const fetched = await fetchFeed(root, spec, opts);
  const source: Source = {
    id: newId('s'),
    name: spec.entitySet,
    kind: 'url',
    format: 'csv',
    url: { href: root.href, headHash: fetched.headHash, size: fetched.size, odata: spec },
    parseOptions: {},
    detectedSchema: [],
  };
  if (opts.credentials) rememberSignIn(source.id, opts.credentials);
  await register(source, fetched);
  setFetch(source.id, { state: 'ok', at: Date.now(), ranged: false });
  markAttached(source.id);
  useProjectStore.getState().apply((p) => addSource(p, source, opts.position ?? { x: 80, y: 80 }));
  return source;
}

/**
 * A sample read for the first time is sniffed as a chosen file is (src/sources/sniff.ts), so a sample with a
 * banner, a footer or semicolons opens with the read options that suit it, and the issues its note describes.
 */
function sniffSample(source: Source, fetched: Fetched) {
  const data = fetched.data;
  if (!data || !source.url?.sample || Object.keys(source.parseOptions).length || (source.format !== 'csv' && source.format !== 'tsv')) return;
  const tail = data.length > HEAD_BYTES ? data.subarray(data.length - TAIL_BYTES) : undefined;
  const sniffed = sniff({ name: source.name, head: data.subarray(0, HEAD_BYTES), size: data.length, tail });
  const text = sniffed.format === 'csv' || sniffed.format === 'tsv' || sniffed.format === 'fixed' || sniffed.format === 'pipes';
  if (!text || sniffed.confidence === 'unsure') return;
  if (sniffed.format === source.format && !Object.keys(sniffed.parseOptions).length) return;
  useProjectStore.getState().amend((p) => setSourceFormat(p, source.id, sniffed.format, sniffed.parseOptions));
}

const inFlight = new Map<string, Promise<void>>();

/**
 * Fetch a URL source again: on reopening a project (no re-attach step) or from its Refresh button. A file whose
 * first megabyte changed since the project last read it is marked, as for files chosen again.
 */
export function loadUrlSource(source: Source, opts: FetchOptions & { refresh?: boolean } = {}): Promise<void> {
  const running = inFlight.get(source.id);
  if (running) return running;
  const job = (async () => {
    if (!source.url) return;
    // A refresh keeps the current data on screen until the new file is in.
    if (!opts.refresh) markAttached(source.id, 'detached');
    setFetch(source.id, { state: 'fetching' });
    try {
      const fetched = source.url.odata
        ? await fetchFeed(new URL(source.url.href), source.url.odata, { ...opts, credentials: signInFor(source.id) })
        : source.url.table
        ? await fetchTable(addressOf(source), source.url.table, opts)
        : await fetchAddress(addressOf(source), { ...opts, format: source.format, shipped: isShippedFile(source.url.sample) });
      // Sniffed before the bytes go to the engine, which takes the buffer with them.
      sniffSample(source, fetched);
      // Registered as the sniff left it: a sample read as a pipe table goes to Puddle's reader, not to DuckDB as CSV.
      const current = useProjectStore.getState().history.present.sources.find((s) => s.id === source.id);
      await register(current ?? source, fetched);
      const before = current?.url?.headHash ?? source.url.headHash;
      const changed = before != null && before !== fetched.headHash;
      if (current?.url && (current.url.headHash !== fetched.headHash || current.url.size !== fetched.size))
        useProjectStore.getState().amend((p) => updateSource(p, source.id, { url: { ...current.url!, headHash: fetched.headHash, size: fetched.size } }));
      setFetch(source.id, { state: 'ok', at: Date.now(), ranged: fetched.ranged });
      // Bytes past the first megabyte may have changed too, so nothing cached about the old file is kept.
      if (opts.refresh) invalidateCaches();
      markAttached(source.id, changed ? 'mismatch' : 'attached');
    } catch (e) {
      setFetch(source.id, failure(e));
      markAttached(source.id, 'detached');
    }
  })().finally(() => inFlight.delete(source.id));
  inFlight.set(source.id, job);
  return job;
}

/** Open an address in a new tab, where the browser downloads it without needing CORS. */
export const openAddress = (href: string) => void window.open(href, '_blank', 'noopener,noreferrer');

/** How a URL source that can't be read right now is described on the canvas and in the results. */
export function urlProblem(f: UrlFetch | undefined, href: string): { title: string; message: string } {
  if (!f || f.state === 'fetching') return { title: 'Reading from the web', message: `Fetching the file from ${hostOf(href)}…` };
  if (f.state === 'failed') return { title: f.kind === 'cors' ? 'The server blocked this' : 'This address can’t be read', message: f.message };
  return { title: 'Read', message: '' };
}
