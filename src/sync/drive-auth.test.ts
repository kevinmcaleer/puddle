import { describe, expect, it } from 'vitest';
import { authUrl, DRIVE_SCOPE, googleSignIn, readSignInReturn } from './drive-auth';

function memoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (k) => map.get(k) ?? null,
    key: (i) => [...map.keys()][i] ?? null,
    removeItem: (k) => void map.delete(k),
    setItem: (k, v) => void map.set(k, v),
  };
}

/** Start a sign-in, and come back with what Google would put in the fragment. */
function signInAndReturn(fragment: (state: string) => Record<string, string>) {
  const storage = memoryStorage();
  let went = '';
  void googleSignIn({ clientId: 'client-1', storage: () => storage, go: (u) => void (went = u), redirectUri: () => 'https://puddle.test/' })({ then: 'link', projectId: 'p_1' });
  const url = new URL(went);
  const state = url.searchParams.get('state')!;
  const replaced: string[] = [];
  const back = (hash: string) =>
    readSignInReturn({ location: { hash, pathname: '/', search: '' }, history: { state: null, replaceState: (_s, _t, u) => void replaced.push(String(u)) }, storage: () => storage });
  return { url, state, storage, replaced, result: back(`#${new URLSearchParams(fragment(state))}`), back };
}

describe('Google sign-in', () => {
  it('asks for an access token with the drive.file scope only, coming back to the app', () => {
    const url = new URL(authUrl('client-1', 'https://puddle.test/', 'abc'));
    expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(Object.fromEntries(url.searchParams)).toEqual({ client_id: 'client-1', redirect_uri: 'https://puddle.test/', response_type: 'token', scope: DRIVE_SCOPE, state: 'abc' });
    expect(DRIVE_SCOPE).toBe('https://www.googleapis.com/auth/drive.file');
  });

  it('picks up the token for the sign-in this tab started, and clears it from the address at once', () => {
    const t = signInAndReturn((state) => ({ access_token: 'tok', token_type: 'Bearer', expires_in: '3599', scope: DRIVE_SCOPE, state }));
    expect(t.state).toMatch(/^[0-9a-f]{32}$/);
    expect(t.replaced).toEqual(['/']);
    expect(t.result).toEqual({ provider: 'drive', then: 'link', projectId: 'p_1', credential: new URLSearchParams({ access_token: 'tok', token_type: 'Bearer', expires_in: '3599', scope: DRIVE_SCOPE }).toString() });
    // Used once: the same answer again counts for nothing.
    expect(t.back(`#access_token=tok&state=${t.state}`)).toEqual({ error: expect.stringContaining('didn’t ask for') });
  });

  it('ignores a token for a sign-in this tab didn’t start', () => {
    const t = signInAndReturn(() => ({ access_token: 'someone-elses', state: 'forged' }));
    expect(t.result).toEqual({ error: expect.stringContaining('didn’t ask for') });
    expect(t.replaced).toEqual(['/']);
  });

  it('says so when access wasn’t allowed', () => {
    const t = signInAndReturn((state) => ({ error: 'access_denied', state }));
    expect(t.result).toEqual({ error: 'Google Drive wasn’t connected: access wasn’t allowed.' });
  });

  it('leaves any other address alone', () => {
    let replaced = false;
    const read = (hash: string) => readSignInReturn({ location: { hash, pathname: '/', search: '' }, history: { state: null, replaceState: () => void (replaced = true) }, storage: memoryStorage });
    expect(read('')).toBeNull();
    expect(read('#section')).toBeNull();
    expect(read('#state=x')).toBeNull();
    expect(replaced).toBe(false);
  });
});
