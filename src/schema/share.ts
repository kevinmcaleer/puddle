// Share links without a server: the DBML (and the diagram views) compressed into the link's #fragment, which browsers
// never send to the server. The page that opens the link reads the schema back from it.
import { z } from 'zod';
import { DetailZ, PositionZ, SchemaViewZ, type Detail, type Position, type SchemaView } from '../model/schema';

/** The schema: its text, and the diagram as laid out (All tables' places and detail, and the views). */
export type SharePayload = { dbml: string; positions?: Record<string, Position>; detail?: Detail; views?: SchemaView[] };

/** The format of what follows: bump it, and keep reading the old one, when the payload changes. */
const VERSION = '1';

/** Longer links than this get cut off by some browsers, chat apps and mail clients. */
export const SHARE_LIMIT = 32 * 1024;

/** A link that unpacks to more than this is refused rather than read. */
const MAX_DECODED = 16 * 1024 * 1024;

const SharePayloadZ = z.object({ dbml: z.string(), positions: z.record(z.string(), PositionZ).optional(), detail: DetailZ.optional(), views: z.array(SchemaViewZ).optional() });

/** The payload without its empty parts, so a link is no longer than it needs to be. */
const compact = (p: SharePayload): SharePayload => ({
  dbml: p.dbml,
  ...(p.positions && Object.keys(p.positions).length ? { positions: p.positions } : {}),
  ...(p.detail && p.detail !== 'full' ? { detail: p.detail } : {}),
  ...(p.views?.length ? { views: p.views } : {}),
});

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

/** Bytes as base64url, without padding. */
function toBase64Url(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i]! << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    out += ALPHABET[(n >> 18) & 63]! + ALPHABET[(n >> 12) & 63]!;
    if (i + 1 < bytes.length) out += ALPHABET[(n >> 6) & 63]!;
    if (i + 2 < bytes.length) out += ALPHABET[n & 63]!;
  }
  return out;
}

/** base64url back to bytes, or undefined when it isn't base64url. */
function fromBase64Url(text: string): Uint8Array | undefined {
  if (!/^[A-Za-z0-9_-]*$/.test(text) || text.length % 4 === 1) return undefined;
  const out = new Uint8Array(Math.floor((text.length * 3) / 4));
  let o = 0;
  for (let i = 0; i < text.length; i += 4) {
    const c = [0, 1, 2, 3].map((k) => (i + k < text.length ? ALPHABET.indexOf(text[i + k]!) : 0));
    const n = (c[0]! << 18) | (c[1]! << 12) | (c[2]! << 6) | c[3]!;
    out[o++] = (n >> 16) & 255;
    if (i + 2 < text.length) out[o++] = (n >> 8) & 255;
    if (i + 3 < text.length) out[o++] = n & 255;
  }
  return out.subarray(0, o);
}

async function deflate(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([bytes as Uint8Array<ArrayBuffer>]).stream().pipeThrough(new CompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Inflated bytes, stopping at MAX_DECODED so a crafted link can't fill memory. */
async function inflate(bytes: Uint8Array): Promise<Uint8Array> {
  const reader = new Blob([bytes as Uint8Array<ArrayBuffer>]).stream().pipeThrough(new DecompressionStream('deflate-raw')).getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > MAX_DECODED) {
      await reader.cancel();
      throw new Error('too large');
    }
    chunks.push(value);
  }
  const out = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}

/** The schema as text for a link: a version mark, then the payload as JSON, compressed and base64url-encoded. */
export async function encodeShare(payload: SharePayload): Promise<string> {
  const json = JSON.stringify(compact(payload));
  return VERSION + toBase64Url(await deflate(new TextEncoder().encode(json)));
}

const BROKEN = 'This share link is broken or incomplete. Ask for the link again, or for the DBML file instead.';

/** The schema a link carries. Throws an Error that reads well when the link is cut short, mangled or from a newer Puddle. */
export async function decodeShare(text: string): Promise<SharePayload> {
  const trimmed = text.trim();
  if (!trimmed) throw new Error(BROKEN);
  if (trimmed[0] !== VERSION) {
    if (/^[2-9]/.test(trimmed)) throw new Error('This share link was made by a newer version of Puddle. Reload the page to update, then open the link again.');
    throw new Error(BROKEN);
  }
  const bytes = fromBase64Url(trimmed.slice(1));
  if (!bytes) throw new Error(BROKEN);
  let json: unknown;
  try {
    json = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await inflate(bytes)));
  } catch {
    throw new Error(BROKEN);
  }
  const parsed = SharePayloadZ.safeParse(json);
  if (!parsed.success) throw new Error(BROKEN);
  return compact(parsed.data);
}

/** The link: the page's address with the schema in its fragment, and `embed=1` for the diagram alone. */
export function shareUrl(base: string, encoded: string, options: { embed?: boolean } = {}): string {
  const page = base.replace(/#.*$/, '');
  return `${page}#schema=${encoded}${options.embed ? '&embed=1' : ''}`;
}

/** The schema text and embed flag from a location's hash, or null when it carries no schema. */
export function readShareHash(hash: string): { encoded: string; embed: boolean } | null {
  const params = new URLSearchParams(hash.replace(/^#/, ''));
  const encoded = params.get('schema');
  if (!encoded) return null;
  return { encoded, embed: params.get('embed') === '1' };
}

/** A link's length in bytes. */
export const shareSize = (url: string) => new TextEncoder().encode(url).length;

const kb = (bytes: number) => `${(bytes / 1024).toFixed(1).replace(/\.0$/, '')} KB`;

/** What to tell someone about a link before they share it: how long it is, and whether it is too long to rely on. */
export function shareNotice(url: string): { tooLong: boolean; message: string } {
  const size = shareSize(url);
  if (size > SHARE_LIMIT)
    return {
      tooLong: true,
      message: `This link is ${kb(size)}, longer than the ${kb(SHARE_LIMIT)} that browsers and chat apps reliably keep. Share the schema as a file instead: export the DBML or the docs.`,
    };
  return { tooLong: false, message: `This link is ${kb(size)}. It carries the schema itself, so the server never sees it: anyone with the link can read the schema.` };
}

const attr = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/** HTML to embed the diagram in another page. */
export function embedSnippet(url: string, title = 'Schema diagram'): string {
  return `<iframe src="${attr(url)}" title="${attr(title)}" width="100%" height="600" style="border: 0" loading="lazy"></iframe>`;
}
