export const HEAD_BYTES = 1024 * 1024;

/** SHA-256 of the first 1 MB, so a re-selected file can be checked against the one the project was built on. */
export async function headHash(blob: Blob): Promise<string> {
  return hashBytes(await blob.slice(0, HEAD_BYTES).arrayBuffer());
}

/** SHA-256 of bytes already read (the head, when it was read to sniff the format too). */
export async function hashBytes(bytes: ArrayBuffer | Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes as ArrayBuffer);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}
