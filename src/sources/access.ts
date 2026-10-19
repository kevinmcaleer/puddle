import { useEffect } from 'react';
import { create } from 'zustand';
import { accessClient, type AccessClient } from '../access/client';
import type { AccessTableInfo } from '../access/types';
import { useEngineStore } from '../app/engine';
import { compileAccessLoad, dropTable, sourceTableName } from '../compiler';
import type { EngineClient } from '../engine';
import { addSource, newId, useProject, useProjectStore, type Project, type Source } from '../model';
import { rememberFile, sourceFile } from './add';
import { markAttached, useAttachments } from './attachments';
import { loadHandles } from '../persistence/db';
import { keepHandle, supportsFileHandles, type FileHandle } from './handles';

/**
 * Access databases (.accdb and .mdb). DuckDB can't read them, so mdb-reader reads the chosen table in a worker into
 * an Arrow table, which is loaded into DuckDB as a table named for the file and the table (sourceTableName), with
 * each column given its Access type. As with Excel, the whole database is read into memory, and the last couple of
 * tables per source are kept, so switching back is instant. Each source reads one table; the other tables of the
 * same database can be added as sources of their own, which share the file.
 */

/** Databases above this size get a warning: they are read into memory whole. */
export const LARGE_DATABASE_BYTES = 200 * 1024 * 1024;

export const isAccessSource = (s: Source) => s.format === 'access' && s.kind === 'file';

export const isLargeDatabase = (source: Source) => isAccessSource(source) && (source.file?.size ?? 0) > LARGE_DATABASE_BYTES;

export interface TableRead {
  tables: AccessTableInfo[];
  /** The Access table read. */
  name: string;
  rows: number;
}

/** What the latest read of each Access source found. */
export type AccessRead =
  | { state: 'reading'; table: string; tables?: AccessTableInfo[] }
  | ({ state: 'ok'; table: string } & TableRead)
  | { state: 'failed'; table: string; message: string; tables?: AccessTableInfo[] };

/** `table` in each read is the DuckDB table it is loaded into. */
export const useAccessReads = create<{ reads: Record<string, AccessRead> }>(() => ({ reads: {} }));

const setRead = (id: string, read: AccessRead | undefined) =>
  useAccessReads.setState((s) => {
    const reads = { ...s.reads };
    if (read) reads[id] = read;
    else delete reads[id];
    return { reads };
  });

/** Tables loaded into DuckDB for each source, oldest first: which file each was read from, and what it found. */
const loaded = new Map<string, Map<string, { file: File; read: TableRead }>>();
const KEEP_TABLES = 2;

/** The read last started for each source; an older one finishing late doesn't overwrite it. */
const attempts = new Map<string, { table: string; file: File; token: number }>();
let tokens = 0;

/** A name per File object, so the worker opens each database once, however many sources read its tables. */
const dbIds = new WeakMap<File, string>();
let dbs = 0;
const dbId = (file: File) => {
  let id = dbIds.get(file);
  if (!id) dbIds.set(file, (id = `db#${++dbs}`));
  return id;
};

/** True when a source's data can be queried: anything but Access, or an Access table loaded for its current options. */
export function accessReady(project: Project, sourceId: string): boolean {
  const source = project.sources.find((s) => s.id === sourceId);
  if (!source || !isAccessSource(source)) return true;
  const file = sourceFile(sourceId);
  return !!file && loaded.get(sourceId)?.get(sourceTableName(source))?.file === file;
}

async function drop(engine: EngineClient, table: string) {
  await engine.query(dropTable(table), { priority: 'background' }).catch(() => undefined);
}

/** Record a loaded table, dropping the oldest beyond the few kept (never the one in use). */
function remember(engine: EngineClient, id: string, table: string, file: File, read: TableRead, inUse: () => string | undefined) {
  const tables = loaded.get(id) ?? new Map<string, { file: File; read: TableRead }>();
  tables.delete(table);
  tables.set(table, { file, read });
  loaded.set(id, tables);
  for (const name of [...tables.keys()]) {
    if (tables.size <= KEEP_TABLES) break;
    if (name === inUse() || name === table) continue;
    tables.delete(name);
    void drop(engine, name);
  }
}

async function read(engine: EngineClient, client: AccessClient, source: Source, file: File, table: string) {
  const id = source.id;
  const token = ++tokens;
  attempts.set(id, { table, file, token });
  const latest = () => attempts.get(id)?.token === token;
  const before = useAccessReads.getState().reads[id];
  const tables = before && before.state !== 'reading' ? before.tables : undefined;
  setRead(id, { state: 'reading', table, tables });
  const staging = `${table}_arrow`;
  try {
    const r = await client.call('read', { db: dbId(file), file, table: source.parseOptions.table });
    await drop(engine, staging);
    await engine.insertArrow(staging, r.ipc);
    await engine.query(compileAccessLoad(table, r.columns, { staging }));
    await drop(engine, staging);
    const info: TableRead = { tables: r.tables, name: r.table, rows: r.rows };
    remember(engine, id, table, file, info, () => {
      const now = useProjectStore.getState().history.present.sources.find((s) => s.id === id);
      return now && sourceTableName(now);
    });
    if (latest()) setRead(id, { state: 'ok', ...info, table });
  } catch (e) {
    await drop(engine, staging);
    if (latest()) setRead(id, { state: 'failed', table, message: e instanceof Error ? e.message : String(e), tables });
  }
}

/**
 * Bring DuckDB's Access tables in step with the project: read each Access source whose file is chosen but whose
 * table isn't loaded, and let go of the tables of sources no longer in it.
 */
export function syncAccessSources(engine: EngineClient, project: Project, client: AccessClient = accessClient()): Promise<void> {
  const jobs: Promise<void>[] = [];
  const live = new Set(project.sources.filter(isAccessSource).map((s) => s.id));
  for (const [id, tables] of loaded) {
    if (live.has(id)) continue;
    for (const name of tables.keys()) void drop(engine, name);
    loaded.delete(id);
    attempts.delete(id);
    setRead(id, undefined);
  }
  for (const source of project.sources) {
    if (!isAccessSource(source)) continue;
    const file = sourceFile(source.id);
    if (!file) continue;
    const table = sourceTableName(source);
    const have = loaded.get(source.id)?.get(table);
    if (have?.file === file) {
      // Loaded before (switching back to an earlier table): use it again straight away.
      attempts.set(source.id, { table, file, token: ++tokens });
      const now = useAccessReads.getState().reads[source.id];
      if (now?.state !== 'ok' || now.table !== table) setRead(source.id, { state: 'ok', ...have.read, table });
      continue;
    }
    const tried = attempts.get(source.id);
    // Being read already, or failed with exactly this table and this file: wait for a change.
    if (tried?.table === table && tried.file === file) continue;
    jobs.push(read(engine, client, source, file, table));
  }
  return Promise.all(jobs).then(() => undefined);
}

/** Forget everything (tests, and a fresh engine). */
export function resetAccessSources() {
  loaded.clear();
  attempts.clear();
  useAccessReads.setState({ reads: {} });
}

/** Keep Access sources loaded while the editor is open. Runs before the flow is evaluated. */
export function useAccessSources() {
  const engine = useEngineStore((s) => s.engine);
  const sources = useProject().sources;
  const attachments = useAttachments((s) => s.sources);
  useEffect(() => {
    if (engine) void syncAccessSources(engine, useProjectStore.getState().history.present);
  }, [engine, sources, attachments]);
}

/** The Access table a source reads: the one chosen, else the one its read found (the first in the database). */
export const accessTableOf = (source: Source, read: AccessRead | undefined): string | undefined =>
  source.parseOptions.table ?? (read?.state === 'ok' ? read.name : undefined);

/** The database's tables that no source in the project reads from this same file yet. */
export function tablesNotAdded(project: Project, source: Source, tables: AccessTableInfo[], reads: Record<string, AccessRead>): AccessTableInfo[] {
  const file = sourceFile(source.id);
  const taken = new Set(project.sources.filter((s) => isAccessSource(s) && sourceFile(s.id) === file).map((s) => accessTableOf(s, reads[s.id])));
  return tables.filter((t) => !taken.has(t.name));
}

/**
 * Add a source for each of these tables of a source's database, below it on the canvas, as one undo step. They
 * share its file (and, where the browser gave one, its handle), so the database is opened once.
 */
export function addAccessTables(source: Source, tables: string[]): Source[] {
  const file = sourceFile(source.id);
  if (!file || !source.file) return [];
  const project = useProjectStore.getState().history.present;
  const node = project.nodes.find((n) => n.type === 'source' && n.sourceId === source.id);
  const at = node?.position ?? { x: 80, y: 80 };
  const added = tables.map(
    (table): Source => ({
      id: newId('s'),
      name: table,
      kind: 'file',
      format: 'access',
      file: { ...source.file! },
      parseOptions: { table },
      detectedSchema: [],
    }),
  );
  if (!added.length) return [];
  for (const s of added) {
    rememberFile(s.id, file);
    markAttached(s.id);
  }
  useProjectStore.getState().batch(() => {
    added.forEach((s, i) => useProjectStore.getState().apply((p) => addSource(p, s, { x: at.x, y: at.y + (i + 1) * 128 })));
  });
  void shareHandle(project.id, source.id, added.map((s) => s.id));
  return added;
}

/** Keep the file handle stored for a source for the sources added beside it, so they reconnect with it next time. */
async function shareHandle(projectId: string, from: string, to: string[]) {
  if (!supportsFileHandles()) return;
  const handle = (await loadHandles<FileHandle>(projectId).catch(() => undefined))?.get(from);
  for (const id of to) keepHandle(id, handle);
}

/** "Orders (1,204 rows, 9 columns)". */
export const tableLabel = (t: AccessTableInfo) =>
  `${t.name} (${t.rows.toLocaleString('en-GB')} ${t.rows === 1 ? 'row' : 'rows'}, ${t.columns} ${t.columns === 1 ? 'column' : 'columns'})`;
