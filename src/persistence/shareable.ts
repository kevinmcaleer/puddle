// What leaves this browser when a project is shared (synced, or exported as a recipe) without its data: the pieces
// of a source that are data, or may be secrets, taken out. Sync and recipes both build on these.
import type { Connection, Source } from '../model';

/** A pasted source without its rows: pasted rows are data, and no data leaves the browser. */
export function withoutPastedRows(source: Source): Source {
  if (!source.clipboard) return source;
  const { clipboard: _, ...rest } = source;
  return rest;
}

/** A URL source's request headers by name, each with an empty value: a header value may be a credential. */
export function withoutHeaderValues(source: Source): Source {
  if (!source.url?.headers) return source;
  return { ...source, url: { ...source.url, headers: Object.fromEntries(Object.keys(source.url.headers).map((name) => [name, ''])) } };
}

/** Where a connection points is private too: a recipe keeps its driver, name and database, never its host, port, user or catalogue. */
export function withoutConnectionHost(connection: Connection): Connection {
  const { catalog: _c, catalogAt: _a, documentedAt: _d, settings, ...rest } = connection;
  const kept = Object.fromEntries(Object.entries(settings).filter(([k]) => k === 'database' || k === 'dataset' || k === 'keyspace' || k === 'namespace' || k === 'schema' || k === 'catalog' || k === 'ssl' || k === 'encrypt'));
  return { ...rest, settings: kept };
}
