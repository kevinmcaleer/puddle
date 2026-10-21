// AWS Signature Version 4, with WebCrypto so the same code signs in the page and in Node: how the DynamoDB driver
// signs each request with the access key id and secret access key (and a session token for temporary credentials).

export interface AwsCredentials {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
}

export interface SignInput {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: string;
  region: string;
  service: string;
  credentials: AwsCredentials;
  /** The signing time; now when left out. */
  now?: Date;
}

const encoder = new TextEncoder();
const hex = (bytes: ArrayBuffer | Uint8Array) => Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, '0')).join('');

export async function sha256Hex(text: string): Promise<string> {
  return hex(await crypto.subtle.digest('SHA-256', encoder.encode(text)));
}

async function hmac(key: ArrayBuffer | Uint8Array, text: string): Promise<ArrayBuffer> {
  const k = await crypto.subtle.importKey('raw', key as BufferSource, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return crypto.subtle.sign('HMAC', k, encoder.encode(text));
}

/** The date and time as the signature writes them: YYYYMMDD'T'HHMMSS'Z' and its day. */
export function amzDate(now: Date): { date: string; day: string } {
  const date = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  return { date, day: date.slice(0, 8) };
}

/** A URL's path and query as the canonical request writes them. */
export function canonicalParts(url: string): { host: string; path: string; query: string } {
  const u = new URL(url);
  const path = u.pathname.split('/').map((p) => encodeURIComponent(decodeURIComponent(p)).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)).join('/') || '/';
  const pairs = [...u.searchParams.entries()].map(([k, v]) => [encodeURIComponent(k), encodeURIComponent(v)] as const).sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0));
  return { host: u.host, path, query: pairs.map(([k, v]) => `${k}=${v}`).join('&') };
}

/** The headers with the signature added: x-amz-date, the session token, and Authorization (host is signed but left for fetch to send). */
export async function signRequest(input: SignInput): Promise<Record<string, string>> {
  const { date, day } = amzDate(input.now ?? new Date());
  const { host, path, query } = canonicalParts(input.url);
  const payloadHash = await sha256Hex(input.body);
  const headers: Record<string, string> = { ...input.headers, host, 'x-amz-date': date, ...(input.credentials.sessionToken ? { 'x-amz-security-token': input.credentials.sessionToken } : {}) };
  const names = Object.keys(headers).map((k) => k.toLowerCase()).sort();
  const lower = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v.trim().replace(/\s+/g, ' ')]));
  const canonical = [input.method.toUpperCase(), path, query, ...names.map((k) => `${k}:${lower[k]}`), '', names.join(';'), payloadHash].join('\n');
  const scope = `${day}/${input.region}/${input.service}/aws4_request`;
  const toSign = ['AWS4-HMAC-SHA256', date, scope, await sha256Hex(canonical)].join('\n');
  let key: ArrayBuffer | Uint8Array = encoder.encode(`AWS4${input.credentials.secretAccessKey}`);
  for (const part of [day, input.region, input.service, 'aws4_request']) key = await hmac(key, part);
  const signature = hex(await hmac(key, toSign));
  const { host: _h, ...rest } = headers;
  void _h;
  return { ...rest, Authorization: `AWS4-HMAC-SHA256 Credential=${input.credentials.accessKeyId}/${scope}, SignedHeaders=${names.join(';')}, Signature=${signature}` };
}
