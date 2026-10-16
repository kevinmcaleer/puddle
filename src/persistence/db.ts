import type { Project } from '../model';

const DB = 'puddle';
/** 2 added the handles store; 3 the sync credentials and links. */
const VERSION = 3;
const PROJECTS = 'projects';
/**
 * Chromium's file handles, by project and source, so a reopened project's files reconnect with a permission click.
 * Kept apart from the project so `.puddle.json` stays portable and never carries them.
 */
const HANDLES = 'handles';

/** A stored file handle. The handle is whatever the browser gave (a FileSystemFileHandle on Chromium). */
export interface StoredHandle<H = unknown> {
  key: string;
  projectId: string;
  sourceId: string;
  handle: H;
}

/** Sync credentials (such as a GitHub token), by provider. On this device only: never in a project or a synced file. */
const CREDENTIALS = 'credentials';
/** Which remote copy each synced project keeps, and the revision last pulled or pushed, by project. */
const SYNC_LINKS = 'syncLinks';

const handleKey = (projectId: string, sourceId: string) => `${projectId}\u0000${sourceId}`;

/** What the home screen lists, without loading every project's graph. */
export interface ProjectSummary {
  id: string;
  name: string;
  updatedAt: string;
  sources: number;
  nodes: number;
}

let opening: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  opening ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(PROJECTS)) db.createObjectStore(PROJECTS, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(HANDLES)) db.createObjectStore(HANDLES, { keyPath: 'key' }).createIndex('projectId', 'projectId');
      if (!db.objectStoreNames.contains(CREDENTIALS)) db.createObjectStore(CREDENTIALS, { keyPath: 'provider' });
      if (!db.objectStoreNames.contains(SYNC_LINKS)) db.createObjectStore(SYNC_LINKS, { keyPath: 'projectId' });
    };
    req.onsuccess = () => {
      // Let a newer Puddle in another tab upgrade the database; this tab reopens it on its next save.
      req.result.onversionchange = () => {
        req.result.close();
        opening = null;
      };
      resolve(req.result);
    };
    req.onerror = () => {
      opening = null;
      reject(req.error ?? new Error('IndexedDB is unavailable.'));
    };
  });
  return opening;
}

/** Close the connection (tests reset the database between cases). */
export async function closeDb() {
  if (!opening) return;
  const db = await opening.catch(() => null);
  db?.close();
  opening = null;
}

function run<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>, name = PROJECTS): Promise<T> {
  return open().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(name, mode);
        const req = fn(tx.objectStore(name));
        tx.oncomplete = () => resolve(req.result);
        tx.onerror = () => reject(tx.error ?? req.error);
        tx.onabort = () => reject(tx.error ?? new Error('The save was interrupted.'));
      }),
  );
}

export const saveProject = (project: Project) => run('readwrite', (s) => s.put(project)).then(() => undefined);

export const loadProject = (id: string) => run<Project | undefined>('readonly', (s) => s.get(id) as IDBRequest<Project | undefined>);

export const deleteProject = (id: string) => run('readwrite', (s) => s.delete(id)).then(() => undefined);

/** Every saved project, most recently changed first. */
export async function listProjects(): Promise<ProjectSummary[]> {
  const all = await run<Project[]>('readonly', (s) => s.getAll() as IDBRequest<Project[]>);
  return all
    .map((p) => ({ id: p.id, name: p.name, updatedAt: p.updatedAt, sources: p.sources.length, nodes: p.nodes.length }))
    .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0));
}

/** Keep the handle for a source's file, replacing any earlier one. */
export const saveHandle = (projectId: string, sourceId: string, handle: unknown) =>
  run('readwrite', (s) => s.put({ key: handleKey(projectId, sourceId), projectId, sourceId, handle } satisfies StoredHandle), HANDLES).then(() => undefined);

/** A project's stored handles, by source id. */
export async function loadHandles<H = unknown>(projectId: string): Promise<Map<string, H>> {
  const rows = await run<StoredHandle<H>[]>('readonly', (s) => s.index('projectId').getAll(projectId) as IDBRequest<StoredHandle<H>[]>, HANDLES);
  return new Map(rows.map((r) => [r.sourceId, r.handle]));
}

/** Forget a project's handles: all of them, or those of sources it no longer has (`keep`). */
export async function deleteHandles(projectId: string, keep?: Iterable<string>): Promise<void> {
  const kept = new Set(keep ?? []);
  const rows = await run<StoredHandle[]>('readonly', (s) => s.index('projectId').getAll(projectId) as IDBRequest<StoredHandle[]>, HANDLES);
  for (const r of rows) if (!kept.has(r.sourceId)) await run('readwrite', (s) => s.delete(r.key), HANDLES);
}

/** Give a copied project the same handles as the original (its sources keep their ids). */
export async function copyHandles(fromProjectId: string, toProjectId: string): Promise<void> {
  const handles = await loadHandles(fromProjectId);
  for (const [sourceId, handle] of handles) await saveHandle(toProjectId, sourceId, handle);
}

/** A sync provider's stored credential. */
export interface StoredCredential {
  provider: string;
  secret: string;
  /** Who it signs in as, shown in the sync dialog. */
  account: string;
}

export const saveCredential = (c: StoredCredential) => run('readwrite', (s) => s.put(c), CREDENTIALS).then(() => undefined);

export const loadCredential = (provider: string) =>
  run<StoredCredential | undefined>('readonly', (s) => s.get(provider) as IDBRequest<StoredCredential | undefined>, CREDENTIALS);

export const deleteCredential = (provider: string) => run('readwrite', (s) => s.delete(provider), CREDENTIALS).then(() => undefined);

/** Where a project syncs to. Kept on this device, apart from the project, so its file never carries it. */
export interface StoredSyncLink {
  projectId: string;
  provider: string;
  /** The remote file's id; none until the first push creates it. */
  remoteId?: string;
  /** The remote revision last pulled or pushed: a push from any other revision is a conflict. */
  revision?: string;
  remoteUpdatedAt?: string;
  /** Hash of the synced text last pulled or pushed: the project has changes to push when it differs. */
  syncedHash?: string;
}

export const saveSyncLink = (link: StoredSyncLink) => run('readwrite', (s) => s.put(link), SYNC_LINKS).then(() => undefined);

export const loadSyncLink = (projectId: string) =>
  run<StoredSyncLink | undefined>('readonly', (s) => s.get(projectId) as IDBRequest<StoredSyncLink | undefined>, SYNC_LINKS);

export const listSyncLinks = () => run<StoredSyncLink[]>('readonly', (s) => s.getAll() as IDBRequest<StoredSyncLink[]>, SYNC_LINKS);

export const deleteSyncLink = (projectId: string) => run('readwrite', (s) => s.delete(projectId), SYNC_LINKS).then(() => undefined);
