import { useEffect } from 'react';
import { create } from 'zustand';
import { useEngineStore } from '../app/engine';
import { compileConnectionLoad, compileTableCount, compileTableSelect, dropTable, sourceTableName } from '../compiler';
import { connectorFor } from '../connect/browser';
import { contextFor } from '../connect/context';
import type { ReadResult } from '../connect/types';
import { connectionFile, useConnectionFiles } from '../connections/files';
import { driver, SECRET_LABEL } from '../connections/drivers';
import { secretFor, useSecrets } from '../connections/secrets';
import type { EngineClient } from '../engine';
import { addSource, newId, updateConnection, useProject, useProjectStore, type Catalog, type CatalogTable, type Connection, type ConnectionSource, type Project, type Source } from '../model';
import { invalidateCaches } from '../flow/status';
import { useSampleStore } from '../flow/sample';
import { markAttached } from './attachments';

/**
 * Sources read through a database connection (Add source › From database): a table of the database, or a query
 * it runs. The connector for the connection (src/connect) brings the rows back as Arrow, or as a relation when the
 * engine itself has the database attached (a DuckDB file), and they are loaded into a table named for the source
 * and what it reads (sourceTableName), with each column given the type the driver declared. The table is read
 * again when the source's table, query or limit changes, when Refresh is pressed, and in every new tab.
 */

export const isConnectionSource = (s: Source): s is Source & { connection: ConnectionSource } => s.kind === 'connection' && !!s.connection;

/** What the latest read of each connection source found. */
export type ConnectionRead =
  | { state: 'reading'; table: string }
  | { state: 'ok'; table: string; rows: number; columns: { name: string; sqlType: string }[]; at: number }
  | { state: 'failed'; table: string; message: string };

/** `table` in each read is the DuckDB table it is loaded into. */
export const useConnectionReads = create<{ reads: Record<string, ConnectionRead> }>(() => ({ reads: {} }));

const setRead = (id: string, read: ConnectionRead | undefined) =>
  useConnectionReads.setState((s) => {
    const reads = { ...s.reads };
    if (read) reads[id] = read;
    else delete reads[id];
    return { reads };
  });

/** The table loaded for each source, and what the read needed (the file and secret) when it was loaded. */
const loaded = new Map<string, { table: string; need: string }>();
/** The read last started for each source; an older one finishing late doesn't overwrite it. */
const attempts = new Map<string, { table: string; need: string; token: number }>();
let tokens = 0;
/** Sources whose next sync reads again whatever is loaded (Refresh). */
const stale = new Set<string>();

export const connectionOf = (project: Project, source: Source): Connection | undefined => project.connections.find((c) => c.id === source.connection?.connectionId);

/** What a read depends on besides the source: the file chosen and whether a secret is held. The values never leave the tab. */
function needOf(connection: Connection | undefined): string {
  if (!connection) return 'none';
  const file = connectionFile(connection.id);
  return [file ? `${file.name}:${file.size}:${file.lastModified}` : '', secretFor(connection.id) ? 'secret' : ''].join('|');
}

/** What a connection still needs from this tab before it can be read: its file, or its secret; nothing when it has both. */
export function connectionNeeds(connection: Connection): 'file' | 'secret' | undefined {
  const d = driver(connection.driver);
  const fileDriver = d.fields.some((f) => f.kind === 'file');
  const viaFile = fileDriver && (d.fields.some((f) => f.kind === 'file' && f.required) || !!connection.settings.file);
  if (viaFile && !connectionFile(connection.id)) return 'file';
  // A file needs no sign-in (a LibSQL file is read like SQLite); the service behind the same driver does.
  if (!viaFile && SECRET_LABEL[d.auth] && !secretFor(connection.id)) return 'secret';
  return undefined;
}

/** The card's line for a connection source that can't be read yet, or undefined while it is being read. */
export const connectionNeedsMessage = (connection: Connection | undefined, read: ConnectionRead | undefined): string | undefined => {
  if (!connection) return 'Its connection was removed from the project.';
  const need = connectionNeeds(connection);
  if (need === 'file') return 'Choose the database file in the inspector.';
  if (need === 'secret') return 'Sign in to the database in the inspector.';
  return read?.state === 'failed' ? read.message : undefined;
};

/** True when a source's data can be queried: anything but a connection source, or one whose table is loaded for what it reads now. */
export function connectionReady(project: Project, sourceId: string): boolean {
  const source = project.sources.find((s) => s.id === sourceId);
  if (!source || !isConnectionSource(source)) return true;
  return loaded.get(sourceId)?.table === sourceTableName(source);
}

async function drop(engine: EngineClient, table: string) {
  await engine.query(dropTable(table), { priority: 'background' }).catch(() => undefined);
}

/** Load a read's rows into `table`: from the Arrow stream through a staging table, or straight from the relation. What was loaded. */
async function load(engine: EngineClient, table: string, r: ReadResult): Promise<{ rows: number; columns: { name: string; sqlType: string }[] }> {
  if ('ipc' in r) {
    const staging = `${table}_arrow`;
    try {
      await drop(engine, staging);
      await engine.insertArrow(staging, r.ipc);
      await engine.query(compileConnectionLoad(table, r.columns, { staging }));
    } finally {
      await drop(engine, staging);
    }
    return { rows: r.rows, columns: r.columns };
  }
  await engine.query(compileConnectionLoad(table, r.columns ?? [], { relation: r.relation, database: r.database }));
  const columns = r.columns ?? (await engine.describe(compileTableSelect(table))).map((c) => ({ name: c.name, sqlType: c.type }));
  const rows = r.rows ?? Number((await engine.query(compileTableCount(table))).table.get(0)?.n ?? 0);
  return { rows, columns };
}

async function read(engine: EngineClient, source: Source & { connection: ConnectionSource }, connection: Connection, table: string, need: string, again: boolean) {
  const id = source.id;
  const token = ++tokens;
  attempts.set(id, { table, need, token });
  const latest = () => attempts.get(id)?.token === token;
  setRead(id, { state: 'reading', table });
  const before = loaded.get(id);
  try {
    const connector = await connectorFor(connection);
    const c = source.connection;
    const r = await connector.read(contextFor(connection), { table: c.table, query: c.query, limit: c.limit });
    const got = await load(engine, table, r);
    if (before && before.table !== table) void drop(engine, before.table);
    loaded.set(id, { table, need });
    if (again) {
      // The same table holds new rows: nothing counted or previewed from the old ones is kept.
      invalidateCaches();
      useSampleStore.setState((s) => {
        const counts = { ...s.counts };
        delete counts[id];
        return { counts };
      });
    }
    if (latest()) setRead(id, { state: 'ok', table, rows: got.rows, columns: got.columns, at: Date.now() });
  } catch (e) {
    if (latest()) setRead(id, { state: 'failed', table, message: e instanceof Error ? e.message : String(e) });
  }
}

/**
 * Bring DuckDB's connection tables in step with the project: read each connection source whose table isn't loaded
 * for what it reads now (and has what it needs: the file, the secret), and let go of the tables of sources no
 * longer in it.
 */
export function syncConnectionSources(engine: EngineClient, project: Project): Promise<void> {
  const jobs: Promise<void>[] = [];
  const live = new Set(project.sources.filter(isConnectionSource).map((s) => s.id));
  for (const [id, have] of loaded) {
    if (live.has(id)) continue;
    void drop(engine, have.table);
    loaded.delete(id);
    attempts.delete(id);
    setRead(id, undefined);
  }
  for (const source of project.sources) {
    if (!isConnectionSource(source)) continue;
    const connection = connectionOf(project, source);
    // Without the file or the secret the read can't start; the inspector asks for it, and the sync runs again when it is given.
    if (!connection || connectionNeeds(connection)) continue;
    const table = sourceTableName(source);
    const need = needOf(connection);
    const have = loaded.get(source.id);
    const again = stale.delete(source.id);
    if (have?.table === table && !again) continue;
    const tried = attempts.get(source.id);
    // Being read already, or failed with exactly this table and these means: wait for a change.
    if (tried?.table === table && tried.need === need) continue;
    jobs.push(read(engine, source, connection, table, need, again));
  }
  return Promise.all(jobs).then(() => undefined);
}

/** Read a source again (its database may have changed). */
export function refreshConnectionSource(sourceId: string) {
  stale.add(sourceId);
  attempts.delete(sourceId);
  useConnectionReads.setState((s) => ({ reads: { ...s.reads } }));
}

/** Forget everything (tests, and a fresh engine). */
export function resetConnectionSources() {
  loaded.clear();
  attempts.clear();
  stale.clear();
  useConnectionReads.setState({ reads: {} });
}

/** Keep connection sources loaded while the editor is open. Runs before the flow is evaluated. */
export function useConnectionSources() {
  const engine = useEngineStore((s) => s.engine);
  const project = useProject();
  const files = useConnectionFiles((s) => s.ids);
  const secrets = useSecrets((s) => s.ids);
  const reads = useConnectionReads((s) => s.reads);
  useEffect(() => {
    if (engine) void syncConnectionSources(engine, useProjectStore.getState().history.present);
  }, [engine, project.sources, project.connections, files, secrets, reads]);
}

/** Read the connection's catalogue and keep it on the connection, so the table picker and the runner have it without connecting. */
export async function readCatalog(connection: Connection): Promise<Catalog> {
  const catalog = await (await connectorFor(connection)).catalog(contextFor(connection));
  useProjectStore.getState().amend((p) => updateConnection(p, connection.id, { catalog, catalogAt: new Date().toISOString() }));
  return catalog;
}

/** "orders", or "public.orders" when its schema is not the default. */
export const tableName = (t: Pick<CatalogTable, 'schema' | 'name'>) => (t.schema ? `${t.schema}.${t.name}` : t.name);

/** What a source reads, for lists: its table, or "a query". */
export const readsLabel = (c: ConnectionSource) => (c.table ? tableName(c.table) : 'a query');

export interface ConnectionPick {
  tables?: CatalogTable[];
  query?: string;
  limit?: number;
}

/** Add a source for each table picked, and one for the query, below the existing sources, as one undo step. */
export function addConnectionSources(connection: Connection, pick: ConnectionPick): Source[] {
  const project = useProjectStore.getState().history.present;
  const sources = project.nodes.filter((n) => n.type === 'source');
  const at = sources.length ? { x: Math.min(...sources.map((n) => n.position.x)), y: Math.max(...sources.map((n) => n.position.y)) + 128 } : { x: 80, y: 80 };
  const base = { kind: 'connection' as const, format: 'connection' as const, parseOptions: {}, detectedSchema: [] };
  const added: Source[] = (pick.tables ?? []).map((t) => ({
    ...base,
    id: newId('s'),
    name: t.name,
    connection: { connectionId: connection.id, table: { schema: t.schema, name: t.name }, limit: pick.limit, columns: t.columns.map((c) => ({ name: c.name, type: c.type })) },
  }));
  const query = pick.query?.trim();
  if (query) added.push({ ...base, id: newId('s'), name: `${connection.name} query`, connection: { connectionId: connection.id, query, limit: pick.limit, columns: [] } });
  if (!added.length) return [];
  for (const s of added) markAttached(s.id);
  useProjectStore.getState().batch(() => {
    added.forEach((s, i) => useProjectStore.getState().apply((p) => addSource(p, s, { x: at.x, y: at.y + i * 128 })));
  });
  return added;
}
