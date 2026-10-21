// A gzip-compressed file read with the platform's DecompressionStream: its first bytes (streamed, so a large file
// is never read whole) or the whole of it.

/** The unpacked bytes, or as many as `limit` from the start. `complete` says the whole file was read. */
export async function gunzipHead(data: Blob | Uint8Array, limit: number): Promise<{ bytes: Uint8Array; complete: boolean }> {
  const blob = data instanceof Blob ? data : new Blob([data as Uint8Array<ArrayBuffer>]);
  const reader = blob.stream().pipeThrough(new DecompressionStream('gzip')).getReader();
  const chunks: Uint8Array[] = [];
  let got = 0;
  let complete = false;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      complete = true;
      break;
    }
    chunks.push(value);
    got += value.length;
    if (got >= limit) break;
  }
  if (!complete) await reader.cancel().catch(() => undefined);
  const out = new Uint8Array(Math.min(got, limit));
  let at = 0;
  for (const c of chunks) {
    const take = Math.min(c.length, out.length - at);
    out.set(c.subarray(0, take), at);
    at += take;
    if (at >= out.length) break;
  }
  return { bytes: out, complete };
}

/** The whole file, unpacked. */
export async function gunzip(data: Blob | Uint8Array): Promise<Uint8Array> {
  const blob = data instanceof Blob ? data : new Blob([data as Uint8Array<ArrayBuffer>]);
  return new Uint8Array(await new Response(blob.stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer());
}
