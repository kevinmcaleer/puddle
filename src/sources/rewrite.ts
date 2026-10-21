import { useEffect } from 'react';
import { create } from 'zustand';
import { useEngineStore } from '../app/engine';
import { sourceFileName } from '../compiler';
import type { EngineClient } from '../engine';
import { useProject, useProjectStore, type Project, type Source } from '../model';
import { sourceFile } from './add';
import { useAttachments } from './attachments';
import { decodeText, isRewrittenText, readText, readWord, rewrittenCsv, rulerLines, type RewrittenFormat, type RewrittenTable } from './text';

/**
 * Fixed-width text, pipe tables, structured text (YAML, TOML, INI, GeoJSON) and Word tables. DuckDB reads none of them, so Puddle reads them (./fixedWidth, ./pipes, src/structured, src/word) and hands
 * DuckDB the rows as CSV, registered under a name that follows the file and the read options (sourceFileName), as
 * XML is (./xml). The text comes from a chosen file, from a web address (kept here as the fetched bytes) or from
 * pasted text stored in the project.
 */

export interface RewriteRead extends Pick<RewrittenTable, 'boundaries' | 'dropped' | 'record' | 'candidates' | 'table' | 'tables'> {
  rows: number;
  columns: number;
  /** The first lines of the table, for the ruler. */
  lines: string[];
}

/** While a source is read again for new options, the ruler keeps showing the lines of the last read. */
export type RewriteState = { state: 'reading'; file: string; lines?: string[] } | ({ state: 'ok'; file: string } & RewriteRead) | { state: 'failed'; file: string; message: string };

export const useRewrites = create<{ reads: Record<string, RewriteState> }>(() => ({ reads: {} }));

const setRead = (id: string, read: RewriteState | undefined) =>
  useRewrites.setState((s) => {
    const reads = { ...s.reads };
    if (read) reads[id] = read;
    else delete reads[id];
    return { reads };
  });

/** Bytes fetched from each URL source's address in this tab. */
const fetched = new Map<string, Uint8Array>();
const useFetched = create<{ version: number }>(() => ({ version: 0 }));

/** Keep the bytes fetched for a URL source; they are read into rows by syncRewrites. */
export const rememberRewriteInput = (sourceId: string, data: Uint8Array) => {
  fetched.set(sourceId, data);
  useFetched.setState((s) => ({ version: s.version + 1 }));
};

type Input = File | Uint8Array | string;

/** The text a source reads in this tab, if it is here: the chosen file, the fetched bytes, or the pasted text. */
export function rewriteInput(source: Source): Input | undefined {
  if (source.kind === 'clipboard') return source.clipboard?.text;
  if (source.kind === 'url') return fetched.get(source.id);
  return sourceFile(source.id);
}

/** CSV files registered for each source, oldest first: which input each was read from, and what it found. */
const loaded = new Map<string, Map<string, { input: Input; read: RewriteRead }>>();
const KEEP_FILES = 2;

/** The read last started for each source; an older one finishing late doesn't overwrite it. */
const attempts = new Map<string, { file: string; input: Input; token: number }>();
let tokens = 0;

/** True when a source's data can be queried: anything but these formats, or one read into rows for its current options. */
export function rewriteReady(project: Project, sourceId: string): boolean {
  const source = project.sources.find((s) => s.id === sourceId);
  if (!source || !isRewrittenText(source)) return true;
  const input = rewriteInput(source);
  return input !== undefined && loaded.get(sourceId)?.get(sourceFileName(source))?.input === input;
}

function remember(engine: EngineClient, id: string, file: string, input: Input, read: RewriteRead, inUse: () => string | undefined) {
  const files = loaded.get(id) ?? new Map<string, { input: Input; read: RewriteRead }>();
  files.delete(file);
  files.set(file, { input, read });
  loaded.set(id, files);
  for (const name of [...files.keys()]) {
    if (files.size <= KEEP_FILES) break;
    if (name === inUse() || name === file) continue;
    files.delete(name);
    void engine.dropFile(name).catch(() => undefined);
  }
}

const bytesOf = async (input: Input) => (typeof input === 'string' ? new TextEncoder().encode(input) : input instanceof Uint8Array ? input : new Uint8Array(await input.arrayBuffer()));
const textOf = async (input: Input, encoding?: string) => (typeof input === 'string' ? input : decodeText(await bytesOf(input), encoding));

async function read(engine: EngineClient, source: Source & { format: RewrittenFormat }, input: Input, file: string) {
  const id = source.id;
  const token = ++tokens;
  attempts.set(id, { file, input, token });
  const latest = () => attempts.get(id)?.token === token;
  const prev = useRewrites.getState().reads[id];
  setRead(id, { state: 'reading', file, ...(prev?.state === 'ok' || prev?.state === 'reading' ? { lines: prev.lines } : {}) });
  try {
    const o = source.parseOptions;
    // A Word document is read from its bytes; the ruler has no lines to show for it.
    const text = source.format === 'word' ? '' : await textOf(input, o.encoding);
    const table = source.format === 'word' ? await readWord(await bytesOf(input), o) : readText(source.format, text, o);
    await engine.dropFile(file).catch(() => undefined);
    await engine.registerText(file, rewrittenCsv(table));
    const info: RewriteRead = { rows: table.rows.length, columns: table.columns.length, lines: rulerLines(text, source.format === 'fixed' ? o.skip : 0), ...(table.boundaries ? { boundaries: table.boundaries } : {}), ...(table.dropped != null ? { dropped: table.dropped } : {}), ...(table.record != null ? { record: table.record, candidates: table.candidates } : {}), ...(table.table != null ? { table: table.table, tables: table.tables } : {}) };
    remember(engine, id, file, input, info, () => {
      const now = useProjectStore.getState().history.present.sources.find((s) => s.id === id);
      return now && sourceFileName(now);
    });
    if (latest()) setRead(id, { state: 'ok', file, ...info });
  } catch (e) {
    if (latest()) setRead(id, { state: 'failed', file, message: e instanceof Error ? e.message : String(e) });
  }
}

/**
 * Bring DuckDB's rows in step with the project: read each fixed-width or pipe source whose text is here but whose
 * rows for the current options aren't registered, and let go of the files of sources no longer in it.
 */
export function syncRewrites(engine: EngineClient, project: Project): Promise<void> {
  const jobs: Promise<void>[] = [];
  const live = new Set(project.sources.filter(isRewrittenText).map((s) => s.id));
  for (const [id, files] of loaded) {
    if (live.has(id)) continue;
    for (const name of files.keys()) void engine.dropFile(name).catch(() => undefined);
    loaded.delete(id);
    attempts.delete(id);
    fetched.delete(id);
    setRead(id, undefined);
  }
  for (const source of project.sources) {
    if (!isRewrittenText(source)) continue;
    const input = rewriteInput(source);
    if (input === undefined) continue;
    const file = sourceFileName(source);
    const have = loaded.get(source.id)?.get(file);
    if (have?.input === input) {
      attempts.set(source.id, { file, input, token: ++tokens });
      const now = useRewrites.getState().reads[source.id];
      if (now?.state !== 'ok' || now.file !== file) setRead(source.id, { state: 'ok', file, ...have.read });
      continue;
    }
    const tried = attempts.get(source.id);
    if (tried?.file === file && tried.input === input) continue;
    jobs.push(read(engine, source, input, file));
  }
  return Promise.all(jobs).then(() => undefined);
}

/** Forget everything (tests, and a fresh engine). */
export function resetRewrites() {
  loaded.clear();
  attempts.clear();
  fetched.clear();
  useRewrites.setState({ reads: {} });
}

/** Keep fixed-width and pipe sources read while the editor is open. Runs before the flow is evaluated. */
export function useRewrittenSources() {
  const engine = useEngineStore((s) => s.engine);
  const sources = useProject().sources;
  const attachments = useAttachments((s) => s.sources);
  const version = useFetched((s) => s.version);
  useEffect(() => {
    if (engine) void syncRewrites(engine, useProjectStore.getState().history.present);
  }, [engine, sources, attachments, version]);
}
