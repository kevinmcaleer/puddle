import type { Credentials } from './odata';

/**
 * The sign-ins OData sources use, by source id: in memory, and in this tab's session storage so a reload keeps
 * them. Never in the project, its file, a recipe or a sync, so a new tab (or anyone the project is shared with) is
 * asked again.
 */

const KEY = 'puddle.odata-sign-in.';
const signIns = new Map<string, Credentials>();

function storage(): Storage | undefined {
  try {
    return typeof sessionStorage === 'undefined' ? undefined : sessionStorage;
  } catch {
    return undefined;
  }
}

export function signInFor(sourceId: string): Credentials | undefined {
  const known = signIns.get(sourceId);
  if (known) return known;
  try {
    const text = storage()?.getItem(KEY + sourceId);
    const kept = text ? (JSON.parse(text) as Credentials) : undefined;
    if (kept) signIns.set(sourceId, kept);
    return kept;
  } catch {
    return undefined;
  }
}

export function rememberSignIn(sourceId: string, credentials: Credentials) {
  signIns.set(sourceId, credentials);
  try {
    storage()?.setItem(KEY + sourceId, JSON.stringify(credentials));
  } catch {
    // Storage refused (private mode, quota): kept in memory for this page only.
  }
}

export function forgetSignIn(sourceId: string) {
  signIns.delete(sourceId);
  try {
    storage()?.removeItem(KEY + sourceId);
  } catch {
    // Nothing kept to remove.
  }
}
