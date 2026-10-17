import { deleteCredential, loadCredential, saveCredential } from '../persistence/db';
import { createDriveProvider, type DriveToken, type TokenStore } from './drive';
import { googleSignIn } from './drive-auth';
import { createGistProvider } from './gist';
import type { CredentialStore, ProviderId, SyncProvider } from './types';

/** Credentials in IndexedDB, on this device only. */
export const idbCredentials: CredentialStore = {
  get: async (provider) => {
    const c = await loadCredential(provider);
    return c && { secret: c.secret, account: c.account };
  },
  set: (provider, secret, account) => saveCredential({ provider, secret, account }),
  delete: (provider) => deleteCredential(provider),
};

const DRIVE_TOKEN = 'puddle.driveToken';

/**
 * Google's short-lived access token in this tab's session storage (and memory, where storage is blocked): it survives
 * a reload and the visit to Google's sign-in, and goes when the tab closes or the token runs out.
 */
export function sessionTokens(storage: () => Storage = () => sessionStorage): TokenStore {
  let memory: DriveToken | undefined;
  return {
    get() {
      try {
        const raw = storage().getItem(DRIVE_TOKEN);
        return raw ? (JSON.parse(raw) as DriveToken) : memory;
      } catch {
        return memory;
      }
    },
    set(token) {
      memory = token;
      try {
        storage().setItem(DRIVE_TOKEN, JSON.stringify(token));
      } catch {
        // Kept in memory only.
      }
    },
    delete() {
      memory = undefined;
      try {
        storage().removeItem(DRIVE_TOKEN);
      } catch {
        // Nothing stored.
      }
    },
  };
}

/** The sync providers this build offers: Google Drive only with an OAuth client ID set at build time. */
export function createProviders(googleClientId: string | undefined): Partial<Record<ProviderId, SyncProvider>> {
  const clientId = googleClientId?.trim();
  return {
    gist: createGistProvider({ credentials: idbCredentials }),
    ...(clientId ? { drive: createDriveProvider({ tokens: sessionTokens(), signIn: googleSignIn({ clientId }) }) } : {}),
  };
}

/** Every sync provider, by id. */
export const PROVIDERS = createProviders(import.meta.env.VITE_GOOGLE_CLIENT_ID);

export const PROVIDER_IDS = Object.keys(PROVIDERS) as ProviderId[];
