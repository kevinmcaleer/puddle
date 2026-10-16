// Kept apart from service.ts so the main thread can use it without loading SheetJS.

/** Buffers in a result or request (its top-level byte arrays) that can be handed to the other thread instead of copied. */
export function transferables(value: unknown): Transferable[] {
  if (!value || typeof value !== 'object') return [];
  return Object.values(value).flatMap((v) => (v instanceof Uint8Array && v.buffer instanceof ArrayBuffer ? [v.buffer] : []));
}
