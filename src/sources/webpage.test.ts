// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { UrlSourceError } from './url';
import { BLOCKED_MESSAGE, fetchPage, fetchTable, tablesAt, wikipediaApi } from './webpage';

const BOND = readFileSync(join(__dirname, '../../tests/fixtures/bond-films.html'), 'utf8');

type Call = { href: string; headers: Record<string, string> };

/** A fetch that answers by address; a function answer of undefined is the browser's bare refusal (CORS). */
function fakeFetch(answers: Record<string, () => Response | undefined>) {
  const calls: Call[] = [];
  const impl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const href = String(input);
    calls.push({ href, headers: (init?.headers ?? {}) as Record<string, string> });
    const key = Object.keys(answers).find((k) => href.startsWith(k));
    const res = key ? answers[key]!() : undefined;
    if (!res) throw new TypeError('Failed to fetch');
    return res;
  }) as typeof fetch;
  return { impl, calls };
}

const html = (body: string, headers: Record<string, string> = {}) => () => new Response(body, { headers: { 'content-type': 'text/html', ...headers } });

describe('Wikipedia', () => {
  it('reads an article through the API, which allows other sites (origin=*)', () => {
    const api = wikipediaApi(new URL('https://en.m.wikipedia.org/wiki/List_of_James_Bond_films'))!;
    expect(api.origin).toBe('https://en.wikipedia.org');
    expect(Object.fromEntries(api.searchParams)).toMatchObject({ action: 'parse', page: 'List_of_James_Bond_films', prop: 'text', origin: '*', redirects: '1' });
    expect(wikipediaApi(new URL('https://de.wikipedia.org/w/index.php?title=Liste_der_James-Bond-Filme'))!.searchParams.get('page')).toBe('Liste_der_James-Bond-Filme');
    expect(wikipediaApi(new URL('https://en.wikipedia.org/wiki/Caf%C3%A9'))!.searchParams.get('page')).toBe('Café');
    expect(wikipediaApi(new URL('https://example.org/wiki/Thing'))).toBeUndefined();
    expect(wikipediaApi(new URL('https://en.wikipedia.org/'))).toBeUndefined();
  });

  it('finds the Bond films in the article’s HTML', async () => {
    const { impl, calls } = fakeFetch({ 'https://en.wikipedia.org/w/api.php': () => Response.json({ parse: { title: 'List of James Bond films', text: BOND } }) });
    const { tables, route } = await tablesAt('https://en.wikipedia.org/wiki/List_of_James_Bond_films', { fetchImpl: impl });
    expect(route).toBe('wikipedia');
    expect(calls).toHaveLength(1);
    expect(tables.find((t) => t.label === 'Eon Productions films')!.rows).toHaveLength(25);
  });

  it('says when there is no such article', async () => {
    const { impl } = fakeFetch({ 'https://en.wikipedia.org/w/api.php': () => Response.json({ error: { code: 'missingtitle', info: 'The page you specified doesn’t exist.' } }) });
    await expect(fetchPage('https://en.wikipedia.org/wiki/Nope', { fetchImpl: impl })).rejects.toThrow('Wikipedia has no article at this address');
  });
});

describe('other sites', () => {
  it('fetches the page directly when the site allows it', async () => {
    const { impl, calls } = fakeFetch({ 'https://open.example/': html('<table><tr><th>a</th></tr><tr><td>1</td></tr></table>') });
    expect(await fetchPage('https://open.example/page', { fetchImpl: impl })).toMatchObject({ route: 'direct' });
    expect(calls.map((c) => c.href)).toEqual(['https://open.example/page']);
  });

  it('says when the site refuses, and how to get the table in anyway', async () => {
    const { impl, calls } = fakeFetch({});
    const e = await fetchPage('https://closed.example/prices', { fetchImpl: impl }).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(UrlSourceError);
    expect(e).toMatchObject({ kind: 'cors', message: BLOCKED_MESSAGE });
    // Nothing else is tried: no server of Puddle's own.
    expect(calls.map((c) => c.href)).toEqual(['https://closed.example/prices']);
  });

  it('passes on the site’s own errors', async () => {
    const { impl } = fakeFetch({ 'https://open.example/': () => new Response('gone', { status: 404 }) });
    await expect(fetchPage('https://open.example/old', { fetchImpl: impl })).rejects.toThrow('There’s no page at this address (open.example)');
  });

  it('says so when offline, rather than blaming the site', async () => {
    const { impl } = fakeFetch({});
    await expect(fetchPage('https://open.example/', { fetchImpl: impl, online: () => false })).rejects.toMatchObject({ kind: 'offline' });
  });

  it('says when a page has no tables', async () => {
    const { impl } = fakeFetch({ 'https://open.example/': html('<p>No tables here</p>') });
    await expect(tablesAt('https://open.example/', { fetchImpl: impl })).rejects.toThrow('There are no tables on this page (open.example)');
  });
});

describe('reading a source’s table again', () => {
  it('finds the table by its label and hands DuckDB its CSV', async () => {
    const { impl } = fakeFetch({ 'https://en.wikipedia.org/w/api.php': () => Response.json({ parse: { text: BOND } }) });
    const fetched = await fetchTable('https://en.wikipedia.org/wiki/List_of_James_Bond_films', { index: 1, label: 'Eon Productions films' }, { fetchImpl: impl });
    const csv = new TextDecoder().decode(fetched.data);
    expect(csv.split('\n')[0]).toBe('Title,Year,Bond actor,Director,Box office (US$ millions) Actual');
    expect(csv).toContain("On Her Majesty's Secret Service,1969,George Lazenby,Peter R. Hunt,82");
    expect(fetched).toMatchObject({ format: 'csv', ranged: false, size: fetched.data!.byteLength });
  });

  it('says when the table has gone', async () => {
    const { impl } = fakeFetch({ 'https://open.example/': html('<p>moved</p><table><tr><th>a</th></tr><tr><td>1</td></tr></table>') });
    await expect(fetchTable('https://open.example/', { index: 3, label: 'Prices' }, { fetchImpl: impl })).rejects.toThrow('The table “Prices” is no longer on this page');
  });
});
