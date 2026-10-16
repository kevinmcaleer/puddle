// Kept results (pinned node results): a node's output materialised as a DuckDB table, so previews downstream
// read the table instead of re-running everything upstream. The compiler reads a table only while its key
// matches the node's upstream key (see compiler/keptBook.ts); this module builds, rebuilds and drops them.
import { create } from 'zustand';
import { compile, keptTable, keptTableName, knownKept, upstreamKey } from '../compiler';
import { tableRows, toEngineError, type EngineClient } from '../engine';
import { nodeById, topoSort, type Project } from '../model';
import { formatBytes } from '../ui/format';
import { schemaCacheFor, useFlowStore } from './status';

export interface KeptEntry {
  /** The upstream key the node's table was last built for; none until its first build. */
  key?: string;
  /** What the table takes up in the engine's memory, in bytes. */
  bytes?: number;
  /** The upstream key being built now. */
  building?: string;
  /** Why the last build failed, for which key: it isn't retried until something upstream changes. */
  error?: { key: string; message: string };
}

interface KeptState {
  nodes: Record<string, KeptEntry>;
  /** The engine's memory limit in bytes, once known. */
  limit: number | null;
}

export const useKeptStore = create<KeptState>(() => ({ nodes: {}, limit: null }));

/** Above this share of the engine's memory, keeping another result asks first. */
export const KEPT_WARN_SHARE = 0.5;

export type KeptView = { state: 'ready'; bytes: number } | { state: 'stale' } | { state: 'failed'; message: string };

/** How a kept node's table stands against the node's current upstream key. */
export function keptView(entry: KeptEntry | undefined, key: string): KeptView {
  if (entry?.key === key) return { state: 'ready', bytes: entry.bytes ?? 0 };
  if (entry?.error?.key === key) return { state: 'failed', message: entry.error.message };
  return { state: 'stale' };
}

/** How a kept result reads on its node: its memory once built, otherwise that it's out of date or failed. */
export function keptLabel(view: KeptView): string {
  if (view.state === 'ready') return `${formatBytes(view.bytes)} kept`;
  return view.state === 'failed' ? 'Kept · couldn’t build' : 'Kept · out of date';
}

export const keptTotal = (nodes: Record<string, KeptEntry>) => Object.values(nodes).reduce((n, e) => n + (e.bytes ?? 0), 0);

/** Whether keeping another result should warn first: the kept tables already use more than the share. */
export const keptNearLimit = (total: number, limit: number | null) => limit != null && limit > 0 && total > limit * KEPT_WARN_SHARE;

// Selectors return stored values or primitives only: a fresh object per call would re-render forever.
export const useKeptEntry = (nodeId: string): KeptEntry | undefined => useKeptStore((s) => s.nodes[nodeId]);
export const useKeptTotal = (): number => useKeptStore((s) => keptTotal(s.nodes));

const UNITS: Record<string, number> = { b: 1, bytes: 1, kb: 1e3, mb: 1e6, gb: 1e9, tb: 1e12, kib: 2 ** 10, mib: 2 ** 20, gib: 2 ** 30, tib: 2 ** 40 };

/** DuckDB's memory_limit setting ("3.1 GiB", "512.0 MiB", "1GB") in bytes; null when it can't be read. */
export function parseMemoryLimit(text: string): number | null {
  const m = /^\s*([\d.]+)\s*([a-z]*)\s*$/i.exec(text);
  if (!m) return null;
  const unit = UNITS[(m[2] || 'b').toLowerCase()];
  const n = Number(m[1]);
  return unit && Number.isFinite(n) ? Math.round(n * unit) : null;
}

let engineOf: EngineClient | null = null;
/** The key each kept node should have a table for, from the last sync. */
const wanted = new Map<string, string>();
/** The project of the last sync, to catch up with once a build that has since gone out of date finishes. */
let latest: Project | null = null;
/** Builds and drops run one at a time, so the memory measured around a build is that build's own. */
let queue: Promise<unknown> = Promise.resolve();

function serial<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(fn, fn);
  queue = run.catch(() => undefined);
  return run;
}

function setEntry(nodeId: string, update: (e: KeptEntry | undefined) => KeptEntry | undefined) {
  useKeptStore.setState((s) => {
    const nodes = { ...s.nodes };
    const next = update(nodes[nodeId]);
    if (next) nodes[nodeId] = next;
    else delete nodes[nodeId];
    return { nodes };
  });
}

/** Bytes held by in-memory tables: only kept results make tables, and they're built one at a time. */
async function tableBytes(engine: EngineClient): Promise<number> {
  const r = await engine.query(`SELECT CAST(coalesce(sum(memory_usage_bytes), 0) AS BIGINT) AS b FROM duckdb_memory() WHERE tag = 'IN_MEMORY_TABLE'`, { priority: 'background' });
  return Number(tableRows(r.table)[0]?.b ?? 0);
}

async function readLimit(engine: EngineClient) {
  try {
    const r = await engine.query(`SELECT current_setting('memory_limit') AS l`, { priority: 'background' });
    if (engine === engineOf) useKeptStore.setState({ limit: parseMemoryLimit(String(tableRows(r.table)[0]?.l ?? '')) });
  } catch {
    // Without a limit there's simply no warning.
  }
}

function build(engine: EngineClient, project: Project, nodeId: string, key: string): Promise<void> {
  setEntry(nodeId, (e) => ({ ...e, building: key }));
  return serial(async () => {
    const current = () => engine === engineOf && wanted.get(nodeId) === key;
    if (!current()) {
      setEntry(nodeId, (e) => (e && e.building === key ? { ...e, building: undefined } : e));
      // Superseded before it started: build for the project as it is now instead.
      if (engine === engineOf && wanted.has(nodeId) && latest) void syncKept(engine, latest);
      return;
    }
    try {
      // Compiled now, not when queued: a kept node upstream that was rebuilt just before is read from its table.
      const { sql } = compile(project, { nodeId }, { rebuild: true, schemas: schemaCacheFor(engine).book });
      // The table is about to change: nothing compiled from here on reads it until it's recorded again.
      knownKept.delete(nodeId);
      const before = await tableBytes(engine);
      await engine.query(`CREATE OR REPLACE TABLE ${keptTable(nodeId)} AS ${sql}`, { priority: 'background' });
      const after = await tableBytes(engine);
      if (engine !== engineOf || !wanted.has(nodeId)) return; // dropped meanwhile; its DROP is queued behind this
      knownKept.set(nodeId, { key, table: keptTableName(nodeId) });
      // The replaced table's memory was freed by the same statement.
      setEntry(nodeId, (e) => ({ key, bytes: Math.max(0, after - before + (e?.key != null ? (e.bytes ?? 0) : 0)) }));
    } catch (err) {
      if (engine !== engineOf || !wanted.has(nodeId)) return;
      const message = toEngineError(err).message;
      // A failed CREATE OR REPLACE leaves the old table as it was, still keyed for its old upstream.
      setEntry(nodeId, (e) => ({ ...e, building: undefined, error: { key, message } }));
    }
    // Upstream changed again while this was building: build for the project as it is now.
    if (wanted.has(nodeId) && wanted.get(nodeId) !== key && latest) void syncKept(engine, latest);
  });
}

function drop(engine: EngineClient, nodeId: string): Promise<void> {
  wanted.delete(nodeId);
  knownKept.delete(nodeId);
  setEntry(nodeId, () => undefined);
  return serial(() => engine.query(`DROP TABLE IF EXISTS ${keptTable(nodeId)}`, { priority: 'background' }).then(
    () => undefined,
    () => undefined,
  ));
}

/**
 * Bring kept tables in line with the project, after the flow has been evaluated: build or rebuild (at
 * background priority) each kept node that works and whose table is missing or out of date, and drop the
 * tables of nodes no longer kept or deleted. Resolves once this sync's builds and drops are done.
 */
export function syncKept(engine: EngineClient, project: Project): Promise<void> {
  if (engine !== engineOf) {
    engineOf = engine;
    wanted.clear();
    knownKept.clear();
    useKeptStore.setState({ nodes: {}, limit: null });
    void readLimit(engine);
  }
  latest = project;
  let order: string[];
  try {
    order = topoSort(project);
  } catch {
    return Promise.resolve();
  }
  const want = new Map<string, string>();
  for (const id of order) {
    const n = nodeById(project, id)!;
    if (n.pinnedResult && n.type !== 'output') want.set(id, upstreamKey(project, { nodeId: id }));
  }
  const jobs: Promise<void>[] = [];
  for (const id of new Set([...wanted.keys(), ...Object.keys(useKeptStore.getState().nodes)])) if (!want.has(id)) jobs.push(drop(engine, id));
  const statuses = useFlowStore.getState().nodes;
  for (const [id, key] of want) {
    wanted.set(id, key);
    const e = useKeptStore.getState().nodes[id];
    if (!e) setEntry(id, () => ({}));
    if (e?.building) {
      // One build per node at a time; when it finishes it catches up with the latest project.
      continue;
    }
    if (e?.key === key || e?.error?.key === key) continue;
    // A node that doesn't work (yet) keeps its old table, unused, until it does.
    const status = statuses[id];
    if (status?.key !== key || status.status.state !== 'ok') continue;
    jobs.push(build(engine, project, id, key));
  }
  return Promise.all(jobs).then(() => undefined);
}

/** Resolves once every queued build and drop has finished, including catch-up builds they started. */
export async function keptSettled(): Promise<void> {
  let q: Promise<unknown>;
  do {
    q = queue;
    await q;
  } while (q !== queue);
}

/** Drop every kept table, e.g. when the project closes. */
export function dropAllKept(engine: EngineClient | null): Promise<void> {
  const ids = new Set([...wanted.keys(), ...knownKept.ids(), ...Object.keys(useKeptStore.getState().nodes)]);
  wanted.clear();
  knownKept.clear();
  useKeptStore.setState({ nodes: {} });
  if (!engine || engine !== engineOf) return Promise.resolve();
  return Promise.all([...ids].map((id) => drop(engine, id))).then(() => undefined);
}
