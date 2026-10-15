import type { Project } from '../model';

const DB = 'puddle';
const VERSION = 1;
const PROJECTS = 'projects';

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
    };
    req.onsuccess = () => resolve(req.result);
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

function run<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return open().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(PROJECTS, mode);
        const req = fn(tx.objectStore(PROJECTS));
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
