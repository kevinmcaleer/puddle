import { findTables, parseHtml, pickTable, tableToCsv, type HtmlTable, type TableRef } from './html';
import { parseAddress, requestInit, UrlSourceError, type FetchOptions, type Fetched } from './url';
import { headHash } from './hash';

/**
 * Reading a web page for its tables, straight from the browser: nothing goes through a server of Puddle's own, so
 * the site has to let other sites read its pages (CORS). Most don't. Wikipedia's pages don't either, but its API
 * does, so a Wikipedia article is read through that. For any other site that refuses, the way in is to copy the
 * table from the page and paste it into the same dialog.
 */

export const BLOCKED_MESSAGE =
  'This site doesn’t let other sites read its pages, so Puddle can’t fetch it from your browser. Select the table on the page, copy it, and paste it here instead.';

export type PageRoute = 'direct' | 'wikipedia';

export interface Page {
  html: string;
  route: PageRoute;
}

/** For a Wikipedia article, the API address that returns its HTML with CORS headers; undefined for any other page. */
export function wikipediaApi(url: URL): URL | undefined {
  const host = url.hostname.replace(/\.m\.wikipedia\.org$/, '.wikipedia.org');
  if (!/^[a-z-]+\.wikipedia\.org$/.test(host)) return undefined;
  let title: string | null = null;
  if (url.pathname.startsWith('/wiki/')) title = decodeURIComponent(url.pathname.slice('/wiki/'.length));
  else if (url.pathname === '/w/index.php') title = url.searchParams.get('title');
  if (!title) return undefined;
  const api = new URL(`https://${host}/w/api.php`);
  for (const [k, v] of Object.entries({ action: 'parse', page: title, prop: 'text', format: 'json', formatversion: '2', redirects: '1', origin: '*' }))
    api.searchParams.set(k, v);
  return api;
}

async function get(href: string, init: RequestInit, opts: FetchOptions): Promise<Response | undefined> {
  try {
    return await (opts.fetchImpl ?? fetch)(href, requestInit(init, {}));
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') throw e;
    const online = opts.online ?? (() => typeof navigator === 'undefined' || navigator.onLine !== false);
    if (!online()) throw new UrlSourceError(`You’re offline, so ${new URL(href).host} can’t be reached. Reconnect, then try again.`, 'offline');
    return undefined;
  }
}

function checkStatus(res: Response, url: URL) {
  if (res.ok) return;
  const what = res.status === 404 ? 'There’s no page at this address' : `The server answered ${res.status}${res.statusText ? ` ${res.statusText}` : ''}`;
  throw new UrlSourceError(`${what} (${url.host}). Check the address and try again.`, 'status');
}

export type PageOptions = FetchOptions;

/** Fetch a page's HTML: Wikipedia through its API, anything else directly. */
export async function fetchPage(address: string | URL, opts: PageOptions = {}): Promise<Page> {
  const url = typeof address === 'string' ? parseAddress(address) : address;
  const api = wikipediaApi(url);
  if (api) {
    const res = await get(api.href, {}, opts);
    if (!res) throw new UrlSourceError(BLOCKED_MESSAGE, 'cors');
    checkStatus(res, url);
    const body = (await res.json()) as { parse?: { text?: string }; error?: { info?: string } };
    if (body.error || typeof body.parse?.text !== 'string')
      throw new UrlSourceError(`Wikipedia has no article at this address${body.error?.info ? ` (${body.error.info})` : ''}. Check the address and try again.`, 'status');
    return { html: body.parse.text, route: 'wikipedia' };
  }
  const direct = await get(url.href, {}, opts);
  if (!direct) throw new UrlSourceError(BLOCKED_MESSAGE, 'cors');
  checkStatus(direct, url);
  return { html: await direct.text(), route: 'direct' };
}

/** The tables found at an address, and how the page was reached. */
export async function tablesAt(address: string | URL, opts: PageOptions = {}): Promise<{ url: URL; tables: HtmlTable[]; route: PageRoute }> {
  const url = typeof address === 'string' ? parseAddress(address) : address;
  const page = await fetchPage(url, opts);
  const tables = findTables(parseHtml(page.html));
  if (!tables.length) throw new UrlSourceError(`There are no tables on this page (${url.host}). Check the address, or use From URL for a CSV, JSON or Parquet file.`, 'format');
  return { url, tables, route: page.route };
}

/** A table, ready for DuckDB: its CSV and the hash that notices when it changes. */
export async function tableFetched(table: HtmlTable): Promise<Fetched> {
  const data = new TextEncoder().encode(tableToCsv(table));
  return { format: 'csv', headHash: await headHash(new Blob([data.slice(0, 1024 * 1024)])), size: data.byteLength, data, ranged: false };
}

/** Fetch a page again and read the table a source was made from. */
export async function fetchTable(address: string | URL, ref: TableRef, opts: PageOptions = {}): Promise<Fetched> {
  const { url, tables } = await tablesAt(address, opts);
  const table = pickTable(tables, ref);
  if (!table) throw new UrlSourceError(`The table “${ref.label}” is no longer on this page (${url.host}).`, 'format');
  return tableFetched(table);
}
