// What connections sign in with, by connection id: kept in memory and in this tab's session storage, exactly as
// OData sign-ins are (src/sources/odataSignIn.ts). Never in the project, its file, a recipe or a sync (plan D25).
// puddle-connect's own token for the Pi route is kept the same way, under SERVICE_TOKEN_ID.
import { create } from 'zustand';

export const SERVICE_TOKEN_ID = 'service:pi';

const KEY = 'puddle.connection-secret.';
const secrets = new Map<string, string>();

function storage(): Storage | undefined {
  try {
    return typeof sessionStorage === 'undefined' ? undefined : sessionStorage;
  } catch {
    return undefined;
  }
}

/** The keys this tab's session storage holds secrets under. */
function storedKeys(): string[] {
  const s = storage();
  const keys: string[] = [];
  try {
    for (let i = 0; i < (s?.length ?? 0); i++) {
      const k = s!.key(i);
      if (k?.startsWith(KEY)) keys.push(k);
    }
  } catch {
    // Storage refused: nothing kept there.
  }
  return keys;
}

/** What the tab kept through a reload, so lists say who is signed in before anything asks for a secret. */
function loadKept() {
  for (const k of storedKeys()) {
    try {
      const v = storage()!.getItem(k);
      if (v !== null) secrets.set(k.slice(KEY.length), v);
    } catch {
      // Left out.
    }
  }
}
loadKept();

/** For React: which connection ids have a secret in this tab. */
export const useSecrets = create<{ ids: string[] }>(() => ({ ids: [...secrets.keys()] }));
const publish = () => useSecrets.setState({ ids: [...secrets.keys()] });

export function secretFor(id: string): string | undefined {
  const known = secrets.get(id);
  if (known !== undefined) return known;
  try {
    const kept = storage()?.getItem(KEY + id) ?? undefined;
    if (kept !== undefined) {
      secrets.set(id, kept);
      publish();
    }
    return kept;
  } catch {
    return undefined;
  }
}

export const hasSecret = (id: string) => secretFor(id) !== undefined;

export function rememberSecret(id: string, secret: string) {
  secrets.set(id, secret);
  try {
    storage()?.setItem(KEY + id, secret);
  } catch {
    // Storage refused (private mode, quota): kept in memory for this page only.
  }
  publish();
}

export function forgetSecret(id: string) {
  secrets.delete(id);
  try {
    storage()?.removeItem(KEY + id);
  } catch {
    // Nothing kept to remove.
  }
  publish();
}

/** Forget every connection's secret in this tab. */
export function forgetAllSecrets() {
  try {
    for (const k of storedKeys()) storage()!.removeItem(k);
  } catch {
    // Storage refused: the in-memory copies still go.
  }
  secrets.clear();
  publish();
}
