// Checking a typed web address, and the errors a source read from the web reports. Pure (no engine, no DOM), so
// the runner can use it too.
import { SourceError } from './detect';

export type UrlErrorKind = 'address' | 'cors' | 'offline' | 'status' | 'format' | 'auth';

export class UrlSourceError extends SourceError {
  constructor(
    message: string,
    readonly kind: UrlErrorKind,
  ) {
    super(message);
    this.name = 'UrlSourceError';
  }
}

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
