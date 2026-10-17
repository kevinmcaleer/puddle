import type { ProviderId, SignInReturn } from './types';

/** The only permission Puddle asks for: the files it makes, and nothing else in the user's Drive. */
export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
export const GOOGLE_AUTH = 'https://accounts.google.com/o/oauth2/v2/auth';

/** The sign-in this tab started, kept in session storage across the visit to Google. */
const PENDING = 'puddle.signIn';

interface Pending extends SignInReturn {
  provider: ProviderId;
  state: string;
}

/** What the app picks up on coming back from Google: a credential for `connect` and what to do next, or why not. */
export type SignInResult = ({ provider: ProviderId; credential: string } & SignInReturn) | { error: string };

export function authUrl(clientId: string, redirectUri: string, state: string) {
  const params = new URLSearchParams({ client_id: clientId, redirect_uri: redirectUri, response_type: 'token', scope: DRIVE_SCOPE, state });
  return `${GOOGLE_AUTH}?${params}`;
}

const randomState = () => Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('');

/**
 * The one function that gets a Google access token: Google's OAuth token flow as a full-page visit. The page leaves
 * for Google's sign-in and comes back to the app's root with the token in the address's fragment.
 *
 * A full page rather than a popup: Puddle is cross-origin isolated (Cross-Origin-Opener-Policy: same-origin, so the
 * engine's threads can return), which cuts a popup off from the page that opened it, and Google Identity Services'
 * popup hands the token back through exactly that link. The caller saves the open project first.
 */
export function googleSignIn({
  clientId,
  storage = () => sessionStorage,
  go = (url) => location.assign(url),
  redirectUri = () => `${location.origin}/`,
}: {
  clientId: string;
  storage?: () => Storage;
  go?: (url: string) => void;
  redirectUri?: () => string;
}) {
  return (after: SignInReturn): Promise<void> => {
    const state = randomState();
    const pending: Pending = { provider: 'drive', state, ...after };
    try {
      storage().setItem(PENDING, JSON.stringify(pending));
    } catch {
      return Promise.reject(new Error('This browser window doesn’t allow session storage, which signing in to Google needs.'));
    }
    go(authUrl(clientId, redirectUri(), state));
    // The page is leaving.
    return new Promise(() => undefined);
  };
}

/**
 * Pick up a sign-in coming back from Google, and take the token out of the address straight away so it isn't left in
 * the history or seen by anything else on the page. Only an answer to the sign-in this tab started counts (its
 * `state` must match), so a link someone else made can't sign this tab in to their account.
 */
export function readSignInReturn({ location: loc = location, history: hist = history, storage = () => sessionStorage }: { location?: Pick<Location, 'hash' | 'pathname' | 'search'>; history?: Pick<History, 'replaceState' | 'state'>; storage?: () => Storage } = {}): SignInResult | null {
  const params = new URLSearchParams(loc.hash.replace(/^#/, ''));
  if (!params.has('state') || !(params.has('access_token') || params.has('error'))) return null;
  hist.replaceState(hist.state, '', loc.pathname + loc.search);
  let pending: Pending | null = null;
  try {
    const raw = storage().getItem(PENDING);
    storage().removeItem(PENDING);
    pending = raw ? (JSON.parse(raw) as Pending) : null;
  } catch {
    pending = null;
  }
  if (!pending || pending.state !== params.get('state')) return { error: 'Puddle ignored a Google sign-in it didn’t ask for.' };
  const error = params.get('error');
  if (error) return { error: error === 'access_denied' ? 'Google Drive wasn’t connected: access wasn’t allowed.' : `Google sign-in didn’t finish (${error}).` };
  params.delete('state');
  return { provider: pending.provider, credential: params.toString(), then: pending.then, projectId: pending.projectId };
}

let captured: SignInResult | null = null;

/** Read a sign-in coming back, once, as the app starts (main.tsx), before anything else looks at the address. */
export function captureSignInReturn() {
  if (typeof location === 'undefined') return;
  captured = readSignInReturn();
}

/** The sign-in captured on start, handed over once. */
export function takeSignInReturn() {
  const c = captured;
  captured = null;
  return c;
}
