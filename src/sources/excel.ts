import { useEffect } from 'react';
import { create } from 'zustand';
import { useEngineStore } from '../app/engine';
import { dropTable, sourceTableName } from '../compiler';
import type { EngineClient } from '../engine';
import { excelClient, type ExcelClient } from '../excel/client';
import type { SheetInfo, SheetReadOptions } from '../excel/types';
import { useProject, useProjectStore, type ParseOptions, type Project, type Source } from '../model';
import { sourceFile } from './add';
import { useAttachments } from './attachments';

/**
 * Excel sources (plan D8). DuckDB-WASM can't read .xlsx reliably, so SheetJS parses the workbook in a worker into an
 * Arrow table, which is loaded into DuckDB as a table named for the file and the read options (sourceTableName).
 * Unlike CSV, the whole workbook is read into memory. Changing the options (or undoing a change) reads the sheet
 * again; the last couple of tables per source are kept, so switching back is instant.
 */

/** Workbooks above this size get a warning: they are read into memory whole, several times over while parsing. */
export const LARGE_WORKBOOK_BYTES = 20 * 1024 * 1024;

export const isLargeWorkbook = (source: Source) => source.format === 'xlsx' && (source.file?.size ?? 0) > LARGE_WORKBOOK_BYTES;

/** "34 MB". */
export const formatBytes = (n: number) => (n >= 1024 * 1024 ? `${Math.round(n / (1024 * 1024))} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

export const isExcelSource = (s: Source) => s.format === 'xlsx' && s.kind === 'file';

/** The options SheetJS needs, from a source's parse options. */
export const sheetOptions = (o: ParseOptions): SheetReadOptions => ({ sheet: o.sheet, headerRow: o.headerRow, range: o.range });

export interface SheetRead {
  sheets: SheetInfo[];
  sheet: string;
  headerRow: number;
  range: string;
  rows: number;
}

/** What the latest read of each Excel source found. */
export type ExcelRead =
  | { state: 'reading'; table: string; sheets?: SheetInfo[] }
  | ({ state: 'ok'; table: string } & SheetRead)
  | { state: 'failed'; table: string; message: string; sheets?: SheetInfo[] };

export const useExcelReads = create<{ reads: Record<string, ExcelRead> }>(() => ({ reads: {} }));

const setRead = (id: string, read: ExcelRead | undefined) =>
  useExcelReads.setState((s) => {
    const reads = { ...s.reads };
    if (read) reads[id] = read;
    else delete reads[id];
    return { reads };
  });

/** Tables loaded into DuckDB for each source, oldest first: which file each was read from, and what it found. */
const loaded = new Map<string, Map<string, { file: File; read: SheetRead }>>();
const KEEP_TABLES = 2;

/** The read last started for each source; an older one finishing late doesn't overwrite it. */
const attempts = new Map<string, { table: string; file: File; token: number }>();
let tokens = 0;

/** A name per File object, so the worker parses each workbook once and never confuses two files. */
const bookIds = new WeakMap<File, string>();
let books = 0;
const bookId = (sourceId: string, file: File) => {
  let id = bookIds.get(file);
  if (!id) bookIds.set(file, (id = `${sourceId}#${++books}`));
  return id;
};

/** True when a source's data can be queried: anything but Excel, or an Excel sheet loaded for its current options. */
export function excelReady(project: Project, sourceId: string): boolean {
  const source = project.sources.find((s) => s.id === sourceId);
  if (!source || !isExcelSource(source)) return true;
  const file = sourceFile(sourceId);
  const table = loaded.get(sourceId)?.get(sourceTableName(source));
  return !!file && table?.file === file;
}

async function drop(engine: EngineClient, table: string) {
  await engine.query(dropTable(table), { priority: 'background' }).catch(() => undefined);
}

/** Record a loaded table, dropping the oldest beyond the few kept (never the one in use). */
function remember(engine: EngineClient, id: string, table: string, file: File, read: SheetRead, inUse: () => string | undefined) {
  const tables = loaded.get(id) ?? new Map<string, { file: File; read: SheetRead }>();
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

async function read(engine: EngineClient, client: ExcelClient, source: Source, file: File, table: string) {
  const id = source.id;
  const token = ++tokens;
  attempts.set(id, { table, file, token });
  const latest = () => attempts.get(id)?.token === token;
  const before = useExcelReads.getState().reads[id];
  setRead(id, { state: 'reading', table, sheets: before && before.state !== 'reading' ? before.sheets : undefined });
  try {
    const r = await client.call('read', { book: bookId(id, file), file, options: sheetOptions(source.parseOptions) });
    // The table may be left from an earlier read of the same file and options that was let go.
    await drop(engine, table);
    await engine.insertArrow(table, r.ipc);
    const info: SheetRead = { sheets: r.sheets, sheet: r.sheet, headerRow: r.headerRow, range: r.range, rows: r.rows };
    remember(engine, id, table, file, info, () => {
      const now = useProjectStore.getState().history.present.sources.find((s) => s.id === id);
      return now && sourceTableName(now);
    });
    if (latest()) setRead(id, { state: 'ok', table, ...info });
  } catch (e) {
    if (latest()) setRead(id, { state: 'failed', table, message: e instanceof Error ? e.message : String(e), sheets: before && before.state !== 'reading' ? before.sheets : undefined });
  }
}

/**
 * Bring DuckDB's Excel tables in step with the project: read each Excel source whose file is chosen but whose table
 * for the current options isn't loaded, and let go of the tables and workbooks of sources no longer in it.
 */
export function syncExcelSources(engine: EngineClient, project: Project, client: ExcelClient = excelClient()): Promise<void> {
  const jobs: Promise<void>[] = [];
  const live = new Set(project.sources.filter(isExcelSource).map((s) => s.id));
  for (const [id, tables] of loaded) {
    if (live.has(id)) continue;
    for (const name of tables.keys()) void drop(engine, name);
    loaded.delete(id);
    attempts.delete(id);
    setRead(id, undefined);
  }
  for (const source of project.sources) {
    if (!isExcelSource(source)) continue;
    const file = sourceFile(source.id);
    if (!file) continue;
    const table = sourceTableName(source);
    const have = loaded.get(source.id)?.get(table);
    if (have?.file === file) {
      // Loaded before (switching back to earlier options): use it again straight away.
      attempts.set(source.id, { table, file, token: ++tokens });
      const now = useExcelReads.getState().reads[source.id];
      if (now?.state !== 'ok' || now.table !== table) setRead(source.id, { state: 'ok', table, ...have.read });
      continue;
    }
    const tried = attempts.get(source.id);
    // Being read already, or failed with exactly these options and this file: wait for a change.
    if (tried?.table === table && tried.file === file) continue;
    jobs.push(read(engine, client, source, file, table));
  }
  return Promise.all(jobs).then(() => undefined);
}

/** Forget everything (tests, and a fresh engine). */
export function resetExcelSources() {
  loaded.clear();
  attempts.clear();
  useExcelReads.setState({ reads: {} });
}

/** Keep Excel sources loaded while the editor is open. Runs before the flow is evaluated. */
export function useExcelSources() {
  const engine = useEngineStore((s) => s.engine);
  const sources = useProject().sources;
  const attachments = useAttachments((s) => s.sources);
  useEffect(() => {
    if (engine) void syncExcelSources(engine, useProjectStore.getState().history.present);
  }, [engine, sources, attachments]);
}

/** Changing the sheet starts it afresh: header row and range belong to the sheet they were set on. */
export const withSheet = (options: ParseOptions, sheet: string): ParseOptions => {
  const next: ParseOptions = { ...options, sheet };
  delete next.headerRow;
  delete next.range;
  return next;
};

/** "Sales (120 rows, 6 columns)". */
export const sheetLabel = (s: SheetInfo) => (s.rows ? `${s.name} (${s.rows.toLocaleString('en-GB')} ${s.rows === 1 ? 'row' : 'rows'}, ${s.columns} ${s.columns === 1 ? 'column' : 'columns'})` : `${s.name} (empty)`);

/** A typed header row: empty means detect it, 0 means none. Anything else that isn't a whole number is refused. */
export function parseHeaderRow(text: string): number | 'auto' | undefined {
  const t = text.trim();
  if (!t) return 'auto';
  if (!/^\d+$/.test(t)) return undefined;
  const n = Number(t);
  return n <= 1_048_576 ? n : undefined;
}
