import { useEffect } from 'react';
import { create } from 'zustand';
import { tableToIPC } from 'apache-arrow';
import { readArrowFile } from '../arrow/read';
import { useEngineStore } from '../app/engine';
import { dropTable, sourceTableName } from '../compiler';
import type { EngineClient } from '../engine';
import { useProject, useProjectStore, type Project, type Source } from '../model';
import { sourceFile } from './add';
import { useAttachments } from './attachments';

/**
 * Arrow IPC files (.arrow, .feather, .ipc). DuckDB-WASM has no Arrow reader built in, so the file is read by the
 * Arrow library into a table, which is handed to DuckDB as an IPC stream and becomes a table named for the file
 * (sourceTableName), with each column keeping its Arrow type. The whole file is read into memory, as a workbook is.
 */

export const isArrowSource = (s: Source) => s.format === 'arrow' && s.kind === 'file';

/** What the latest read of each Arrow source found; `table` is the DuckDB table it is loaded into. */
export type ArrowRead = { state: 'reading'; table: string } | { state: 'ok'; table: string; rows: number; columns: number } | { state: 'failed'; table: string; message: string };

export const useArrowReads = create<{ reads: Record<string, ArrowRead> }>(() => ({ reads: {} }));

const setRead = (id: string, read: ArrowRead | undefined) =>
  useArrowReads.setState((s) => {
    const reads = { ...s.reads };
    if (read) reads[id] = read;
    else delete reads[id];
    return { reads };
  });

/** Tables loaded into DuckDB for each source, oldest first: which file each was read from, and what it found. */
const loaded = new Map<string, Map<string, { file: File; read: { rows: number; columns: number } }>>();
const KEEP_TABLES = 2;

/** The read last started for each source; an older one finishing late doesn't overwrite it. */
const attempts = new Map<string, { table: string; file: File; token: number }>();
let tokens = 0;

/** True when a source's data can be queried: anything but Arrow, or an Arrow file loaded for its current file. */
export function arrowReady(project: Project, sourceId: string): boolean {
  const source = project.sources.find((s) => s.id === sourceId);
  if (!source || !isArrowSource(source)) return true;
  const file = sourceFile(sourceId);
  return !!file && loaded.get(sourceId)?.get(sourceTableName(source))?.file === file;
}

async function drop(engine: EngineClient, table: string) {
  await engine.query(dropTable(table), { priority: 'background' }).catch(() => undefined);
}

function remember(engine: EngineClient, id: string, table: string, file: File, read: { rows: number; columns: number }, inUse: () => string | undefined) {
  const tables = loaded.get(id) ?? new Map<string, { file: File; read: { rows: number; columns: number } }>();
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

async function read(engine: EngineClient, source: Source, file: File, table: string) {
  const id = source.id;
  const token = ++tokens;
  attempts.set(id, { table, file, token });
  const latest = () => attempts.get(id)?.token === token;
  setRead(id, { state: 'reading', table });
  try {
    const arrow = readArrowFile(new Uint8Array(await file.arrayBuffer()));
    await drop(engine, table);
    await engine.insertArrow(table, tableToIPC(arrow, 'stream'));
    const info = { rows: arrow.numRows, columns: arrow.numCols };
    remember(engine, id, table, file, info, () => {
      const now = useProjectStore.getState().history.present.sources.find((s) => s.id === id);
      return now && sourceTableName(now);
    });
    if (latest()) setRead(id, { state: 'ok', table, ...info });
  } catch (e) {
    if (latest()) setRead(id, { state: 'failed', table, message: e instanceof Error ? e.message : String(e) });
  }
}

/** Bring DuckDB's Arrow tables in step with the project: load each Arrow source whose file is chosen but not loaded, and let go of the rest. */
export function syncArrowSources(engine: EngineClient, project: Project): Promise<void> {
  const jobs: Promise<void>[] = [];
  const live = new Set(project.sources.filter(isArrowSource).map((s) => s.id));
  for (const [id, tables] of loaded) {
    if (live.has(id)) continue;
    for (const name of tables.keys()) void drop(engine, name);
    loaded.delete(id);
    attempts.delete(id);
    setRead(id, undefined);
  }
  for (const source of project.sources) {
    if (!isArrowSource(source)) continue;
    const file = sourceFile(source.id);
    if (!file) continue;
    const table = sourceTableName(source);
    const have = loaded.get(source.id)?.get(table);
    if (have?.file === file) {
      attempts.set(source.id, { table, file, token: ++tokens });
      const now = useArrowReads.getState().reads[source.id];
      if (now?.state !== 'ok' || now.table !== table) setRead(source.id, { state: 'ok', table, ...have.read });
      continue;
    }
    const tried = attempts.get(source.id);
    if (tried?.table === table && tried.file === file) continue;
    jobs.push(read(engine, source, file, table));
  }
  return Promise.all(jobs).then(() => undefined);
}

/** Forget everything (tests, and a fresh engine). */
export function resetArrowSources() {
  loaded.clear();
  attempts.clear();
  useArrowReads.setState({ reads: {} });
}

/** Keep Arrow sources loaded while the editor is open. Runs before the flow is evaluated. */
export function useArrowSources() {
  const engine = useEngineStore((s) => s.engine);
  const sources = useProject().sources;
  const attachments = useAttachments((s) => s.sources);
  useEffect(() => {
    if (engine) void syncArrowSources(engine, useProjectStore.getState().history.present);
  }, [engine, sources, attachments]);
}
