// A zip archive read by its central directory: the entries it lists, and one entry's bytes, inflated with the
// browser's (and Node's) own DecompressionStream, so no library is needed. Pure, apart from that stream.

/** A file in a zip archive. */
export interface ZipEntry {
  name: string;
  /** Bytes once unpacked. */
  size: number;
  /** Bytes in the archive. */
  packed: number;
  /** 0 is stored, 8 is deflated. */
  method: number;
  /** Where its local header starts. */
  offset: number;
}

export class ZipError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ZipError';
  }
}

const SIG_EOCD = 0x06054b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_LOCAL = 0x04034b50;

const view = (bytes: Uint8Array) => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

/** Where the end-of-central-directory record starts: the last one in the final 64 KB (its comment can be that long). */
function findEnd(bytes: Uint8Array): number {
  const v = view(bytes);
  const from = Math.max(0, bytes.length - 22 - 65_535);
  for (let i = bytes.length - 22; i >= from; i--) if (v.getUint32(i, true) === SIG_EOCD) return i;
  throw new ZipError('This zip archive is incomplete: its directory is missing.');
}

/** The files in a zip, in directory order (folders left out). Needs the whole archive. */
export function listZip(bytes: Uint8Array): ZipEntry[] {
  const v = view(bytes);
  const end = findEnd(bytes);
  const count = v.getUint16(end + 10, true);
  let at = v.getUint32(end + 16, true);
  if (count === 0xffff || at === 0xffffffff) throw new ZipError('This zip archive is too large (zip64) to open in the browser.');
  const entries: ZipEntry[] = [];
  const names = new TextDecoder();
  for (let i = 0; i < count; i++) {
    if (at + 46 > bytes.length || v.getUint32(at, true) !== SIG_CENTRAL) throw new ZipError('This zip archive is damaged: its directory can’t be read.');
    const method = v.getUint16(at + 10, true);
    const packed = v.getUint32(at + 20, true);
    const size = v.getUint32(at + 24, true);
    const nameLength = v.getUint16(at + 28, true);
    const extraLength = v.getUint16(at + 30, true);
    const commentLength = v.getUint16(at + 32, true);
    const offset = v.getUint32(at + 42, true);
    const name = names.decode(bytes.subarray(at + 46, at + 46 + nameLength));
    at += 46 + nameLength + extraLength + commentLength;
    if (name.endsWith('/')) continue;
    entries.push({ name, size, packed, method, offset });
  }
  return entries;
}

/** The compressed bytes of an entry, found past its local header. */
function packedBytes(bytes: Uint8Array, entry: ZipEntry): Uint8Array {
  const v = view(bytes);
  if (entry.offset + 30 > bytes.length || v.getUint32(entry.offset, true) !== SIG_LOCAL) throw new ZipError(`${entry.name} can’t be found in this zip archive.`);
  const start = entry.offset + 30 + v.getUint16(entry.offset + 26, true) + v.getUint16(entry.offset + 28, true);
  if (start + entry.packed > bytes.length) throw new ZipError(`${entry.name} is cut short in this zip archive.`);
  return bytes.subarray(start, start + entry.packed);
}

/** Inflate raw deflate data with the platform's DecompressionStream. */
export async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as Uint8Array<ArrayBuffer>]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** One entry's bytes, unpacked. */
export async function readZipEntry(bytes: Uint8Array, entry: ZipEntry): Promise<Uint8Array> {
  const packed = packedBytes(bytes, entry);
  if (entry.method === 0) return packed.slice();
  if (entry.method === 8) {
    const out = await inflateRaw(packed);
    if (out.length !== entry.size) throw new ZipError(`${entry.name} is damaged: it unpacked to ${out.length} bytes, not ${entry.size}.`);
    return out;
  }
  throw new ZipError(`${entry.name} is packed with a method (${entry.method}) Puddle can’t unpack. Unpack the archive and add the file inside.`);
}

/** The entry named, or an error naming the archive's files. */
export function zipEntry(entries: ZipEntry[], name: string): ZipEntry {
  const entry = entries.find((e) => e.name === name);
  if (!entry) throw new ZipError(`${name} isn’t in this zip archive${entries.length ? ` (it holds ${entries.map((e) => e.name).join(', ')})` : ''}.`);
  return entry;
}
