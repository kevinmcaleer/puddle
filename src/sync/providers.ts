import { deleteCredential, loadCredential, saveCredential } from '../persistence/db';
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

/** Every sync provider, by id. */
export const PROVIDERS: Record<ProviderId, SyncProvider> = {
  gist: createGistProvider({ credentials: idbCredentials }),
};

export const PROVIDER_IDS = Object.keys(PROVIDERS) as ProviderId[];
