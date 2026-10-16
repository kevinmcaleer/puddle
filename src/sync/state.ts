import { create } from 'zustand';
import type { ProviderId } from './types';

/**
 * The open project's sync state. `off`: not synced. `synced`: the remote copy matches. `pending`: changes are
 * waiting for autosave to settle or being pushed. `offline`: changes are queued until the network is back.
 * `conflict`: the remote copy changed as well, and the user chooses which to keep. `error`: the provider refused.
 */
export type SyncStatus = 'off' | 'synced' | 'pending' | 'offline' | 'conflict' | 'error';

/** Both sides of a conflict: when each version was saved, and the remote revision a "keep mine" pushes over. */
export interface SyncConflict {
  projectId: string;
  localAt: string;
  remoteAt: string;
  remoteRevision: string;
}

export interface SyncState {
  /** Who each connected provider signs in as. */
  accounts: Partial<Record<ProviderId, string>>;
  /** The open project the rest describes. */
  projectId: string | null;
  provider: ProviderId | null;
  status: SyncStatus;
  conflict: SyncConflict | null;
  error: string | null;
}

export const initialSyncState = (): SyncState => ({ accounts: {}, projectId: null, provider: null, status: 'off', conflict: null, error: null });

export const useSync = create<SyncState>(initialSyncState);
