// The bearer token puddle-connect asks for (plan section 4): compared in constant time, so a wrong token takes as
// long to refuse as a nearly right one. Pure.
import { createHash, timingSafeEqual } from 'node:crypto';

/** The token in an Authorization header, or undefined. */
export function bearer(header: string | string[] | undefined): string | undefined {
  const h = Array.isArray(header) ? header[0] : header;
  const m = /^\s*Bearer\s+(\S+)\s*$/i.exec(h ?? '');
  return m?.[1];
}

/** Whether the given token is the expected one, taking the same time whatever was given. */
export function tokenMatches(given: string | undefined, expected: string): boolean {
  if (!expected) return false;
  const a = createHash('sha256').update(given ?? '').digest();
  const b = createHash('sha256').update(expected).digest();
  return timingSafeEqual(a, b) && given !== undefined;
}
