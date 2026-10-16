import { create } from 'zustand';
import type { ProviderId } from './types';

/** Which sync dialog is open: the open project's sync settings, or "Open from" on the home screen. */
export type SyncDialog = { kind: 'project' | 'open'; provider: ProviderId } | null;

export const useSyncDialog = create<{ dialog: SyncDialog }>(() => ({ dialog: null }));

export const openSyncDialog = (dialog: SyncDialog) => useSyncDialog.setState({ dialog });

/** A sync time to the second, so two saves a minute apart still read differently in a conflict. */
export const syncTime = (iso: string) =>
  new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(new Date(iso));
