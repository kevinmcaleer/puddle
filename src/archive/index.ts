// Compressed files and archives (#192): a gzip-compressed file holds one file, a zip archive any number. Both are
// unpacked with the platform's DecompressionStream (no library), in the browser and on the runner alike. What an
// archive holds is listed, and one entry read: its first bytes (to sniff its format) or the whole of it.
import { gunzip, gunzipHead } from './gzip';
import { listZip, readZipEntry, zipEntry, type ZipEntry } from './zip';

export type ArchiveKind = 'gzip' | 'zip';

/** A file inside an archive. A gzip file's one entry is named for the file, less its .gz. */
export interface ArchiveEntry {
  name: string;
  /** Bytes once unpacked, where the archive says. */
  size?: number;
}

export { ZipError } from './zip';

/** "orders.csv" for orders.csv.gz (or orders.csv.gzip); a .tgz is a tar, which isn't read. */
export const gzipEntryName = (name: string) => name.replace(/\.(gz|gzip)$/i, '');

/** Entries worth offering first: the data files, with the folder and resource junk some zips carry left out. */
export const isDataEntry = (name: string) => !/(^|\/)(__MACOSX\/|\.DS_Store$|Thumbs\.db$|\.)/i.test(name);

const bytesOf = async (data: Blob | Uint8Array) => (data instanceof Uint8Array ? data : new Uint8Array(await data.arrayBuffer()));

/** A zip's directory, read once per archive (the bytes are kept with it while it is open). */
const directories = new WeakMap<Blob | Uint8Array, Promise<{ bytes: Uint8Array; entries: ZipEntry[] }>>();
function directory(data: Blob | Uint8Array) {
  let d = directories.get(data);
  if (!d) directories.set(data, (d = bytesOf(data).then((bytes) => ({ bytes, entries: listZip(bytes) }))));
  return d;
}

/** The files in an archive: a zip's directory, or the one file a gzip holds. Data files come first. */
export async function listEntries(data: Blob | Uint8Array, kind: ArchiveKind, name: string): Promise<ArchiveEntry[]> {
  if (kind === 'gzip') return [{ name: gzipEntryName(name) }];
  const { entries } = await directory(data);
  return entries.map((e) => ({ name: e.name, size: e.size })).sort((a, b) => Number(isDataEntry(b.name)) - Number(isDataEntry(a.name)));
}

/** The first bytes of an entry, up to `limit`; `size` is the entry's unpacked size when known. */
export async function readEntryHead(data: Blob | Uint8Array, kind: ArchiveKind, entry: string, limit: number, tailLimit = limit): Promise<{ head: Uint8Array; size?: number; tail?: Uint8Array }> {
  if (kind === 'gzip') {
    const { bytes, complete } = await gunzipHead(data, limit);
    return complete ? { head: bytes, size: bytes.length } : { head: bytes };
  }
  const whole = await readEntry(data, kind, entry);
  return { head: whole.subarray(0, limit), size: whole.length, tail: whole.length > limit ? whole.subarray(whole.length - tailLimit) : undefined };
}

/** One entry, unpacked whole. */
export async function readEntry(data: Blob | Uint8Array, kind: ArchiveKind, entry: string): Promise<Uint8Array> {
  if (kind === 'gzip') return gunzip(data);
  const { bytes, entries } = await directory(data);
  return readZipEntry(bytes, zipEntry(entries, entry));
}
