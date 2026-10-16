import { describe, expect, it } from 'vitest';
import { createProviders, PROVIDER_IDS, sessionTokens } from './providers';

describe('sync providers', () => {
  it('offers Google Drive only when the build has a client ID', () => {
    expect(Object.keys(createProviders(undefined))).toEqual(['gist']);
    expect(Object.keys(createProviders('  '))).toEqual(['gist']);
    expect(Object.keys(createProviders('id.apps.googleusercontent.com'))).toEqual(['gist', 'drive']);
    // The unit tests build without one.
    expect(PROVIDER_IDS).toEqual(['gist']);
  });

  it('keeps the Drive token in session storage, or in memory where storage is blocked', () => {
    const map = new Map<string, string>();
    const storage = { getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => void map.set(k, v), removeItem: (k: string) => void map.delete(k) } as Storage;
    const tokens = sessionTokens(() => storage);
    const token = { token: 't', expiresAt: 1, account: 'kev@example.com' };
    tokens.set(token);
    expect(JSON.parse(map.get('puddle.driveToken')!)).toEqual(token);
    expect(sessionTokens(() => storage).get()).toEqual(token);
    tokens.delete();
    expect(map.size).toBe(0);

    const blocked = sessionTokens(() => {
      throw new Error('blocked');
    });
    blocked.set(token);
    expect(blocked.get()).toEqual(token);
    blocked.delete();
    expect(blocked.get()).toBeUndefined();
  });
});
