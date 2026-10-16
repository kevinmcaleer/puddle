// The sync layer's contract: every provider (GitHub Gist now, Google Drive next) keeps one remote file per
// project behind this interface, and the controller (controller.ts) gives them all the same states, offline
// queue and conflict handling.

export type ProviderId = 'gist' | 'drive';

/**
 * What to carry on with after signing in on the provider's own page: start syncing the project, show "Open from", or
 * resume a project that stopped on an expired sign-in.
 */
export interface SignInReturn {
  then: 'link' | 'open' | 'resume';
  projectId: string | null;
}

/** A remote project file as the provider reports it. */
export interface RemoteFile {
  id: string;
  /** The project's name, as stored next to the file. */
  title: string;
  /** The file's name, e.g. orders-clean-up.puddle.json. */
  fileName: string;
  updatedAt: string;
  /** Changes on every write; a push names the revision it starts from, so a write in between is a conflict. */
  revision: string;
}

export interface PulledFile extends RemoteFile {
  text: string;
}

/** What a push writes: one project file. */
export interface PushFile {
  title: string;
  fileName: string;
  text: string;
}

export interface SyncProvider {
  id: ProviderId;
  /** "GitHub Gist", used in sentences such as "Sync to GitHub Gist". */
  label: string;
  /**
   * Check the credential, keep it on this device and say who it signs in as. GitHub Gist takes a pasted token; Google
   * Drive the answer its sign-in page sends back.
   */
  connect(credential: string): Promise<string>;
  /**
   * Providers that sign in on their own page (Google Drive) leave for it here; the app comes back to `connect` and
   * `after`. Providers without it take a credential pasted into the dialog.
   */
  signIn?(after: SignInReturn): Promise<void>;
  /** Forget the credential. Remote files stay where they are. */
  disconnect(): Promise<void>;
  /** Who the stored credential signs in as, or null when not connected. */
  account(): Promise<string | null>;
  /** The user's Puddle project files, newest first. */
  list(): Promise<RemoteFile[]>;
  /** A file's revision and time, without its text. */
  head(id: string): Promise<RemoteFile>;
  pull(id: string): Promise<PulledFile>;
  /**
   * Write the file: a new one without `base`, else over `base.id`, but only while it is still at `base.revision`
   * (otherwise SyncConflictError). A file deleted remotely is written again as a new one.
   */
  push(file: PushFile, base?: { id: string; revision: string }): Promise<RemoteFile>;
}

export class SyncError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SyncError';
  }
}

/** No network: the change waits in the queue. */
export class SyncOfflineError extends SyncError {
  constructor() {
    super('You’re offline.');
    this.name = 'SyncOfflineError';
  }
}

/** The credential was refused or has expired. */
export class SyncAuthError extends SyncError {
  constructor(message: string) {
    super(message);
    this.name = 'SyncAuthError';
  }
}

/** The remote file is gone. */
export class SyncMissingError extends SyncError {
  constructor() {
    super('The remote copy no longer exists.');
    this.name = 'SyncMissingError';
  }
}

/** The remote file changed since the revision a push started from. */
export class SyncConflictError extends SyncError {
  constructor(readonly remote: RemoteFile) {
    super('The remote copy changed since this browser last synced.');
    this.name = 'SyncConflictError';
  }
}

/** Where a provider keeps its credential (IndexedDB in the app, a Map in tests). */
export interface CredentialStore {
  get(provider: ProviderId): Promise<{ secret: string; account: string } | undefined>;
  set(provider: ProviderId, secret: string, account: string): Promise<void>;
  delete(provider: ProviderId): Promise<void>;
}
