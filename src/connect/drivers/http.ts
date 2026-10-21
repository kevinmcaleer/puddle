// What the HTTP drivers (ClickHouse, Trino, BigQuery, Snowflake) share: a fetch they can be handed (the page's, the
// service's, or a test's replay), plain-words failures, the exchange shape the tests record and replay with the
// secrets taken out, and a signed JWT for the warehouses that sign in with a key, made with WebCrypto so the same
// code runs in the browser and in Node.
import { ConnectorError } from '../types';

export type Fetch = typeof fetch;

/** One request and its answer, as the recorder keeps it and the tests replay it. Secrets never appear: see `redact`. */
export interface Exchange {
  method: string;
  url: string;
  body?: string;
  status: number;
  response: string;
}

const SECRET_PARAMS = ['password', 'access_token'];
const SECRET_HEADERS = ['authorization', 'x-clickhouse-key', 'x-trino-password'];

/** A request's URL and body without its secrets, so a recording holds none and a replay matches without them. */
export function redact(url: string, body?: string): { url: string; body?: string } {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return { url, ...(body !== undefined ? { body } : {}) };
  }
  for (const p of SECRET_PARAMS) if (u.searchParams.has(p)) u.searchParams.set(p, 'secret');
  let b = body;
  if (b && /assertion=|"password"|"private_key"|"token"/.test(b)) {
    b = b.replace(/assertion=[^&]*/g, 'assertion=secret').replace(/"(password|private_key|token)":"(?:[^"\\]|\\.)*"/g, '"$1":"secret"');
  }
  return { url: u.toString(), ...(b !== undefined ? { body: b } : {}) };
}

/** Whether a header carries a secret, for the recorder. */
export const isSecretHeader = (name: string) => SECRET_HEADERS.includes(name.toLowerCase());

/** fetch's own failures in plain words: nothing answering, a refused certificate, a cancelled read. */
export function fetchProblem(e: unknown, where: string, signal?: AbortSignal): ConnectorError {
  if (e instanceof ConnectorError) return e;
  if (signal?.aborted) return new ConnectorError('The read was cancelled.');
  const message = e instanceof Error ? `${e.message}${e.cause instanceof Error ? ` (${e.cause.message})` : ''}` : String(e);
  if (/certificate|CERT_|self[- ]signed/i.test(message)) return new ConnectorError(`${where}’s certificate isn’t trusted.`);
  if (/ECONNREFUSED|ENOTFOUND|EAI_AGAIN|Failed to fetch|NetworkError|fetch failed|ECONNRESET|timed out/i.test(message)) return new ConnectorError(`Nothing answers at ${where}, or it doesn’t let this page in.`);
  return new ConnectorError(`${where} answered: ${message}`);
}

/** The host of an address setting, for messages. */
export function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

/** An address setting checked and trimmed of its trailing slash. */
export function baseUrl(value: unknown, what = 'address'): string {
  const text = String(value ?? '').trim().replace(/\/+$/, '');
  if (!text) throw new ConnectorError(`Give the ${what}.`);
  if (!/^https?:\/\//i.test(text)) throw new ConnectorError(`The ${what} should start with http:// or https://.`);
  return text;
}

const encoder = new TextEncoder();

export function base64url(bytes: Uint8Array | string): string {
  const b = typeof bytes === 'string' ? encoder.encode(bytes) : bytes;
  let s = '';
  for (const x of b) s += String.fromCharCode(x);
  return btoa(s).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

export function base64Bytes(text: string): Uint8Array {
  const s = atob(text.replaceAll('-', '+').replaceAll('_', '/').replace(/\s+/g, ''));
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

/** A PEM private key (PKCS#8, "BEGIN PRIVATE KEY") as its DER bytes. */
export function pemBytes(pem: string): Uint8Array {
  const m = /-----BEGIN ([A-Z ]+)-----([\s\S]*?)-----END \1-----/.exec(pem.replaceAll('\\n', '\n'));
  if (!m) throw new ConnectorError('The private key should be PEM text, from "-----BEGIN PRIVATE KEY-----" to "-----END PRIVATE KEY-----".');
  if (m[1] === 'ENCRYPTED PRIVATE KEY') throw new ConnectorError('The private key is encrypted; give an unencrypted PKCS#8 key.');
  if (m[1] === 'RSA PRIVATE KEY') throw new ConnectorError('The private key is in the old PKCS#1 form; convert it with "openssl pkcs8 -topk8 -nocrypt".');
  return base64Bytes(m[2]!);
}

async function privateKey(pem: string): Promise<CryptoKey> {
  const der = pemBytes(pem);
  try {
    return await crypto.subtle.importKey('pkcs8', der as BufferSource, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, true, ['sign']);
  } catch {
    throw new ConnectorError('The private key couldn’t be read as an RSA key.');
  }
}

/** A JWT signed RS256 with a PEM private key: how BigQuery (a service account) and Snowflake (key-pair) sign in. */
export async function signJwt(claims: Record<string, unknown>, pem: string, header: Record<string, unknown> = {}): Promise<string> {
  const key = await privateKey(pem);
  const signing = `${base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT', ...header }))}.${base64url(JSON.stringify(claims))}`;
  const signature = new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, encoder.encode(signing)));
  return `${signing}.${base64url(signature)}`;
}

/** The SHA-256 of the public key (DER, SubjectPublicKeyInfo) of a PEM private key, as Snowflake names a key: "SHA256:<base64>". */
export async function publicKeyFingerprint(pem: string): Promise<string> {
  const key = await privateKey(pem);
  const jwk = await crypto.subtle.exportKey('jwk', key);
  const pub = await crypto.subtle.importKey('jwk', { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: 'RS256', ext: true }, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, true, ['verify']);
  const spki = await crypto.subtle.exportKey('spki', pub);
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', spki));
  let s = '';
  for (const x of digest) s += String.fromCharCode(x);
  return `SHA256:${btoa(s)}`;
}

/** The seconds since 1970, for JWT claims. */
export const nowSeconds = () => Math.floor(Date.now() / 1000);
