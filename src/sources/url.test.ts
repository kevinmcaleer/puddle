import { headHash } from './hash';
import { rewriteInput } from './rewrite';
import {
  addUrlSource,
  CORS_MESSAGE,
  fetchAddress,
  formatFromAddress,
  formatFromContentType,
  hostOf,
  nameFromAddress,
  parseAddress,
  totalFromContentRange,
  urlProblem,
  UrlSourceError,
} from './url';

const MB = 1024 * 1024;

describe('checking an address', () => {
  it('accepts https and drops the fragment', () => {
    expect(parseAddress('  https://data.example.org/orders.csv?v=2#top ').href).toBe('https://data.example.org/orders.csv?v=2');
  });

  it('refuses plain http with the mixed-content reason', () => {
    expect(() => parseAddress('http://data.example.org/orders.csv')).toThrow(/only reads https addresses.*mixed content/);
    try {
      parseAddress('http://data.example.org/orders.csv');
    } catch (e) {
      expect(e).toBeInstanceOf(UrlSourceError);
      expect((e as UrlSourceError).kind).toBe('address');
    }
  });

  it('allows plain http on this machine, which browsers treat as secure', () => {
    expect(parseAddress('http://localhost:8080/a.csv').host).toBe('localhost:8080');
    expect(parseAddress('http://127.0.0.1:9/a.csv').hostname).toBe('127.0.0.1');
  });

  it.each([
    ['', /Paste the address/],
    ['orders.csv', /isn’t a web address/],
    ['ftp://example.org/a.csv', /not ftp:/],
    ['https://kev:secret@example.org/a.csv', /user name or password/],
  ])('refuses %j', (input, message) => {
    expect(() => parseAddress(input)).toThrow(message);
  });
});

describe('names and hosts', () => {
  it('names a source after the last part of the path', () => {
    expect(nameFromAddress(new URL('https://example.org/data/orders%202026.csv?x=1'))).toBe('orders 2026.csv');
    expect(nameFromAddress(new URL('https://example.org/data/'))).toBe('data');
    expect(nameFromAddress(new URL('https://example.org/'))).toBe('example.org');
  });

  it('shows the host on the canvas', () => {
    expect(hostOf('https://data.example.org:8443/a.csv')).toBe('data.example.org:8443');
    expect(hostOf('not a url')).toBe('not a url');
  });
});

describe('format', () => {
  it('comes from the extension first', () => {
    expect(formatFromAddress(new URL('https://x.org/a.parquet'), 'text/csv')).toBe('parquet');
    expect(formatFromAddress(new URL('https://x.org/events.jsonl?dl=1'))).toBe('ndjson');
  });

  it('falls back to the Content-Type', () => {
    expect(formatFromAddress(new URL('https://x.org/export?id=4'), 'text/csv; charset=utf-8')).toBe('csv');
    expect(formatFromContentType('application/vnd.apache.parquet')).toBe('parquet');
    expect(formatFromContentType('Application/JSON')).toBe('json');
    expect(formatFromContentType('application/x-ndjson')).toBe('ndjson');
    expect(formatFromContentType('text/tab-separated-values')).toBe('tsv');
    expect(formatFromContentType('application/atom+xml;type=feed')).toBe('xml');
    expect(formatFromContentType('text/xml; charset=utf-8')).toBe('xml');
    expect(formatFromContentType('text/html')).toBeUndefined();
    expect(formatFromContentType(null)).toBeUndefined();
  });

  it('asks for a format when neither says', () => {
    expect(() => formatFromAddress(new URL('https://x.org/download'), 'application/octet-stream')).toThrow(/Choose the format/);
  });

  it('reads every spreadsheet format from an address: .xlsx, old .xls, .ods, .numbers and .dbf alike', () => {
    for (const ext of ['xlsx', 'xls', 'xlsb', 'ods', 'numbers', 'dbf']) expect(formatFromAddress(new URL(`https://x.org/book.${ext}`))).toBe('xlsx');
  });
});

it('reads the total size from Content-Range', () => {
  expect(totalFromContentRange('bytes 0-1048575/5000000')).toBe(5_000_000);
  expect(totalFromContentRange('bytes */12')).toBe(12);
  expect(totalFromContentRange(null)).toBeUndefined();
});

/** A fake server: answers Range requests when `ranges` is on, and records each request. */
function fakeServer(body: Uint8Array<ArrayBuffer>, opts: { ranges?: boolean; type?: string; status?: number } = {}) {
  const calls: { range?: string; cache?: RequestCache; credentials?: RequestCredentials }[] = [];
  const fetchImpl = (async (_url: string, init?: RequestInit) => {
    const range = (init?.headers as Record<string, string> | undefined)?.Range;
    calls.push({ range, ...(init?.cache ? { cache: init.cache } : {}), ...(init?.credentials ? { credentials: init.credentials } : {}) });
    if (opts.status) return new Response('nope', { status: opts.status, statusText: 'Not Found' });
    const headers = { 'Content-Type': opts.type ?? 'application/octet-stream' };
    const m = opts.ranges && range ? /bytes=(\d+)-(\d+)/.exec(range) : null;
    if (m) {
      const start = Number(m[1]);
      const end = Math.min(Number(m[2]), body.length - 1);
      return new Response(body.slice(start, end + 1), { status: 206, headers: { ...headers, 'Content-Range': `bytes ${start}-${end}/${body.length}` } });
    }
    return new Response(body, { status: 200, headers });
  }) as typeof fetch;
  return { fetchImpl, calls };
}

const text = (s: string) => new TextEncoder().encode(s);

describe('fetching an address', () => {
  it('takes the whole file in one request when the server ignores ranges', async () => {
    const body = text('a,b\n1,2\n');
    const { fetchImpl, calls } = fakeServer(body);
    const f = await fetchAddress('https://x.org/a.csv', { fetchImpl });
    expect(f).toMatchObject({ format: 'csv', ranged: false, size: body.length });
    expect(f.data).toEqual(body);
    expect(f.headHash).toBe(await headHash(new Blob([body])));
    expect(calls).toEqual([{ range: `bytes=0-${MB - 1}`, cache: 'no-store', credentials: 'omit' }]);
  });

  // Regression: a sample fetched like a typed address (ranged, no-store, no credentials) wasn't answered from the
  // service worker's precache in Firefox, so samples couldn't be read offline there.
  it('fetches a file shipped with Puddle in one plain GET, the way the service worker precached it', async () => {
    const body = text('a,b\n1,2\n');
    const { fetchImpl, calls } = fakeServer(body, { ranges: true });
    const f = await fetchAddress(new URL('https://puddle.example/samples/contacts.csv'), { fetchImpl, format: 'csv', shipped: true });
    expect(f).toMatchObject({ format: 'csv', ranged: false, size: body.length });
    expect(f.data).toEqual(body);
    expect(calls).toEqual([{ range: undefined }]);
  });

  it('stops after the first request when a ranged file ends inside the first megabyte', async () => {
    const { fetchImpl, calls } = fakeServer(text('x\n1\n'), { ranges: true });
    const f = await fetchAddress('https://x.org/a.csv', { fetchImpl });
    expect(f.data).toEqual(text('x\n1\n'));
    expect(calls).toHaveLength(1);
  });

  it('fetches the rest of a large CSV, hashing only its first megabyte', async () => {
    const body = new Uint8Array(MB + 500).fill(65);
    const { fetchImpl, calls } = fakeServer(body, { ranges: true });
    const f = await fetchAddress('https://x.org/big.csv', { fetchImpl });
    expect(f.data?.byteLength).toBe(MB + 500);
    expect(f.size).toBe(MB + 500);
    expect(f.headHash).toBe(await headHash(new Blob([body])));
    expect(calls.map((c) => c.range)).toEqual([`bytes=0-${MB - 1}`, undefined]);
  });

  it('leaves Parquet to DuckDB’s range requests when the server supports them', async () => {
    const body = new Uint8Array(3 * MB).fill(1);
    const { fetchImpl, calls } = fakeServer(body, { ranges: true });
    const f = await fetchAddress('https://x.org/big.parquet', { fetchImpl });
    expect(f).toMatchObject({ format: 'parquet', ranged: true, size: 3 * MB });
    expect(f.data).toBeUndefined();
    expect(calls).toHaveLength(1);
  });

  it('fetches Parquet whole when the server doesn’t support ranges', async () => {
    const body = new Uint8Array(10).fill(1);
    const { fetchImpl } = fakeServer(body);
    const f = await fetchAddress('https://x.org/a.parquet', { fetchImpl });
    expect(f).toMatchObject({ format: 'parquet', ranged: false });
    expect(f.data).toEqual(body);
  });

  it('detects the format from the Content-Type, or uses the one chosen', async () => {
    expect((await fetchAddress('https://x.org/export', { fetchImpl: fakeServer(text('{"a":1}'), { type: 'application/json' }).fetchImpl })).format).toBe('json');
    expect((await fetchAddress('https://x.org/a.csv', { format: 'tsv', fetchImpl: fakeServer(text('a\tb')).fetchImpl })).format).toBe('tsv');
  });

  // Regression: a YAML file from an address was handed to DuckDB as it was, never read into rows.
  it('keeps a structured text file fetched from an address for the rewrite path, as fixed-width text is kept', async () => {
    const body = text('servers:\n  - name: alpha\n    ip: 10.0.0.1\n');
    const { fetchImpl } = fakeServer(body, { type: 'application/yaml' });
    const source = await addUrlSource('https://x.org/servers.yaml', { fetchImpl });
    expect(source.format).toBe('yaml');
    expect(rewriteInput(source)).toEqual(body);
  });

  it('explains a CORS refusal, which the browser reports as a bare network error', async () => {
    const fetchImpl = (async () => {
      throw new TypeError('Failed to fetch');
    }) as typeof fetch;
    await expect(fetchAddress('https://x.org/a.csv', { fetchImpl, online: () => true })).rejects.toMatchObject({ kind: 'cors', message: CORS_MESSAGE });
    await expect(fetchAddress('https://x.org/a.csv', { fetchImpl, online: () => false })).rejects.toMatchObject({ kind: 'offline', message: expect.stringContaining('offline') });
  });

  it('says what the server answered', async () => {
    await expect(fetchAddress('https://x.org/a.csv', { fetchImpl: fakeServer(text(''), { status: 404 }).fetchImpl })).rejects.toMatchObject({
      kind: 'status',
      message: 'There’s no file at this address (x.org). Check the address and try again.',
    });
  });

  it('refuses plain http before sending anything', async () => {
    const { fetchImpl, calls } = fakeServer(text('a'));
    await expect(fetchAddress('http://x.org/a.csv', { fetchImpl })).rejects.toMatchObject({ kind: 'address' });
    expect(calls).toHaveLength(0);
  });
});

describe('describing a URL source that can’t be read', () => {
  it('says it is fetching, or why it failed', () => {
    expect(urlProblem({ state: 'fetching' }, 'https://x.org/a.csv').message).toBe('Fetching the file from x.org…');
    expect(urlProblem({ state: 'failed', kind: 'cors', message: CORS_MESSAGE }, 'https://x.org/a.csv')).toEqual({ title: 'The server blocked this', message: CORS_MESSAGE });
    expect(urlProblem({ state: 'failed', kind: 'status', message: 'm' }, 'https://x.org/a.csv').title).toBe('This address can’t be read');
  });
});
