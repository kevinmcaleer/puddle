import { create } from 'zustand';
import { whenEngine } from '../app/engine';
import { sourceFileName } from '../compiler';
import { invalidateCaches } from '../flow/status';
import { addSource, newId, updateSource, useProjectStore, type Source, type SourceFormat } from '../model';
import { markAttached } from './attachments';
import { formatFromName, knownFormat, SourceError } from './detect';
import { headHash } from './hash';

/**
 * Sources read from a web address (plan D8). The browser fetches the file itself, so the server must allow
 * other sites to read it (CORS); nothing goes through a proxy. Parquet is read by HTTP range requests where the
 * server supports them; anything else is fetched once per session and handed to DuckDB.
 */

export type UrlErrorKind = 'address' | 'cors' | 'offline' | 'status' | 'format';

export class UrlSourceError extends SourceError {
  constructor(
    message: string,
    readonly kind: UrlErrorKind,
  ) {
    super(message);
    this.name = 'UrlSourceError';
  }
}

/** The brand book's wording for a server that doesn't send CORS headers. */
export const CORS_MESSAGE = 'This server doesn’t allow other sites to read the file. Download it and drop it here instead.';

const HEAD_BYTES = 1024 * 1024;

/** Plain http is fine on this machine (browsers treat it as secure), and refused anywhere else. */
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/** Check a typed or pasted address: https only (plain http is mixed content), no credentials, no fragment. */
export function parseAddress(input: string): URL {
  const text = input.trim();
  if (!text) throw new UrlSourceError('Paste the address of a CSV, TSV, JSON, NDJSON or Parquet file.', 'address');
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    throw new UrlSourceError(`${text} isn’t a web address. Paste one that starts with https://.`, 'address');
  }
  if (url.protocol === 'http:' && !LOCAL_HOSTS.has(url.hostname))
    throw new UrlSourceError(
      'Puddle only reads https addresses. This page is secure, so the browser blocks plain http requests from it (mixed content). Use the https version of the address.',
      'address',
    );
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new UrlSourceError(`Puddle reads web addresses that start with https://, not ${url.protocol}.`, 'address');
  if (url.username || url.password) throw new UrlSourceError('Addresses with a user name or password in them can’t be read. Remove them, or download the file and drop it here instead.', 'address');
  url.hash = '';
  return url;
}

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
};

/** The format a Content-Type names, ignoring parameters such as charset. */
export function formatFromContentType(contentType: string | null | undefined): SourceFormat | undefined {
  const type = contentType?.split(';')[0]?.trim().toLowerCase();
  return type ? BY_CONTENT_TYPE[type] : undefined;
}

/** The file's format: from the address's extension, else the server's Content-Type, or say how to choose one. */
export function formatFromAddress(url: URL, contentType?: string | null): SourceFormat {
  const name = nameFromAddress(url);
  const byName = knownFormat(name);
  if (byName === 'xlsx') throw new UrlSourceError('Excel workbooks can’t be read from a web address yet. Download the file and drop it here instead.', 'format');
  if (byName) return byName;
  if (/\.xls$/i.test(name)) formatFromName(name);
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
}

const isAbort = (e: unknown) => e instanceof DOMException && e.name === 'AbortError';

async function request(url: URL, init: RequestInit, opts: FetchOptions): Promise<Response> {
  let res: Response;
  try {
    res = await (opts.fetchImpl ?? fetch)(url.href, { ...init, cache: 'no-store', credentials: 'omit' });
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
 * server supports ranges), then the rest of the file unless DuckDB can read it by ranges (Parquet).
 */
export async function fetchAddress(address: string | URL, opts: FetchOptions = {}): Promise<Fetched> {
  const url = typeof address === 'string' ? parseAddress(address) : address;
  const probe = await request(url, { headers: { Range: `bytes=0-${HEAD_BYTES - 1}` } }, opts);
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

/** Hand what was fetched to DuckDB under the source's file name, replacing what was there. */
async function register(source: Source, fetched: Fetched) {
  const engine = await whenEngine();
  const name = sourceFileName(source);
  await engine.dropFile(name).catch(() => undefined);
  if (fetched.ranged) await engine.registerUrl(name, source.url!.href);
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
      const fetched = await fetchAddress(source.url.href, { ...opts, format: source.format });
      await register(source, fetched);
      const current = useProjectStore.getState().history.present.sources.find((s) => s.id === source.id);
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
