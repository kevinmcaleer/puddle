import { useEffect } from 'react';
import { create } from 'zustand';
import { useEngineStore } from '../app/engine';
import { sourceFileName } from '../compiler';
import type { EngineClient } from '../engine';
import { useProject, useProjectStore, type ParseOptions, type Project, type Source } from '../model';
import { expandCandidates, scanXml, tableToCsv, xmlToTable, type RecordCandidate, type XmlInput, type XmlShape } from '../xml';
import { sourceFile } from './add';
import { useAttachments } from './attachments';

/**
 * XML sources. DuckDB can't read XML, so Puddle reads it (src/xml): finds the repeating record elements, reads the
 * chosen one into rows and hands DuckDB that as CSV, which it types like any CSV. The CSV is registered under a
 * name that follows the file and the read options (sourceFileName), and the last couple are kept per source, so
 * switching back is instant. The XML comes from a chosen file, from a web address (kept here as the fetched bytes)
 * or from pasted text stored in the project.
 */

export const isXmlSource = (s: Source) => s.format === 'xml';

export interface XmlRead {
  /** The record elements found, likeliest first. */
  records: RecordCandidate[];
  record: string;
  /** Repeating elements inside the record that can be given a row each. */
  expandable: string[];
  expand?: string;
  rows: number;
  columns: number;
}

/** What the latest read of each XML source found. */
export type XmlReadState =
  | { state: 'reading'; file: string; records?: RecordCandidate[] }
  | ({ state: 'ok'; file: string } & XmlRead)
  | { state: 'failed'; file: string; message: string; records?: RecordCandidate[] };

export const useXmlReads = create<{ reads: Record<string, XmlReadState> }>(() => ({ reads: {} }));

const setRead = (id: string, read: XmlReadState | undefined) =>
  useXmlReads.setState((s) => {
    const reads = { ...s.reads };
    if (read) reads[id] = read;
    else delete reads[id];
    return { reads };
  });

/** XML fetched from each URL source's address in this tab. */
const fetched = new Map<string, Uint8Array>();

/** Counts fetches, so a fetch of the same bytes again (a refresh) is read again too. */
const useFetchedXml = create<{ version: number }>(() => ({ version: 0 }));

/** Keep the XML fetched for a URL source; it is read into rows by syncXmlSources. */
export const rememberXml = (sourceId: string, data: Uint8Array) => {
  fetched.set(sourceId, data);
  useFetchedXml.setState((s) => ({ version: s.version + 1 }));
};

/** The XML a source reads in this tab, if it is here: the chosen file, the fetched bytes, or the pasted text. */
export function xmlInput(source: Source): Blob | Uint8Array | string | undefined {
  if (source.kind === 'clipboard') return source.clipboard?.text;
  if (source.kind === 'url') return fetched.get(source.id);
  return sourceFile(source.id);
}

/** CSV files registered for each source, oldest first: which input each was read from, and what it found. */
const loaded = new Map<string, Map<string, { input: XmlInput; read: XmlRead }>>();
const KEEP_FILES = 2;

/** The read last started for each source; an older one finishing late doesn't overwrite it. */
const attempts = new Map<string, { file: string; input: XmlInput; token: number }>();
let tokens = 0;

/** The shape of each input, scanned once however many times its options change. Pasted text by source. */
const shapes = new WeakMap<object, Promise<XmlShape>>();
const textShapes = new Map<string, { text: string; shape: Promise<XmlShape> }>();

function shapeOf(id: string, input: XmlInput): Promise<XmlShape> {
  if (typeof input === 'string') {
    const have = textShapes.get(id);
    if (have?.text === input) return have.shape;
    const shape = scanXml(input);
    textShapes.set(id, { text: input, shape });
    return shape;
  }
  let shape = shapes.get(input);
  if (!shape) shapes.set(input, (shape = scanXml(input)));
  return shape;
}

/** True when a source's data can be queried: anything but XML, or XML read into rows for its current options. */
export function xmlReady(project: Project, sourceId: string): boolean {
  const source = project.sources.find((s) => s.id === sourceId);
  if (!source || !isXmlSource(source)) return true;
  const input = xmlInput(source);
  return input !== undefined && loaded.get(sourceId)?.get(sourceFileName(source))?.input === input;
}

/** Record a registered file, dropping the oldest beyond the few kept (never the one in use). */
function remember(engine: EngineClient, id: string, file: string, input: XmlInput, read: XmlRead, inUse: () => string | undefined) {
  const files = loaded.get(id) ?? new Map<string, { input: XmlInput; read: XmlRead }>();
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

async function read(engine: EngineClient, source: Source, input: XmlInput, file: string) {
  const id = source.id;
  const token = ++tokens;
  attempts.set(id, { file, input, token });
  const latest = () => attempts.get(id)?.token === token;
  const before = useXmlReads.getState().reads[id];
  const records = before && before.state !== 'reading' ? before.records : undefined;
  setRead(id, { state: 'reading', file, records });
  try {
    const shape = await shapeOf(id, input);
    const o = source.parseOptions;
    const table = await xmlToTable(input, { record: o.record, expand: o.expand }, shape);
    await engine.dropFile(file).catch(() => undefined);
    await engine.registerText(file, tableToCsv(table));
    const info: XmlRead = {
      records: shape.candidates,
      record: table.record,
      expandable: expandCandidates(shape, table.record).map((c) => c.path),
      ...(table.expand ? { expand: table.expand } : {}),
      rows: table.rows.length,
      columns: table.columns.length,
    };
    remember(engine, id, file, input, info, () => {
      const now = useProjectStore.getState().history.present.sources.find((s) => s.id === id);
      return now && sourceFileName(now);
    });
    if (latest()) setRead(id, { state: 'ok', file, ...info });
  } catch (e) {
    const shape = await shapeOf(id, input).catch(() => undefined);
    if (latest()) setRead(id, { state: 'failed', file, message: e instanceof Error ? e.message : String(e), records: shape?.candidates ?? records });
  }
}

/**
 * Bring DuckDB's XML rows in step with the project: read each XML source whose input is here but whose rows for
 * the current options aren't registered, and let go of the files of sources no longer in it.
 */
export function syncXmlSources(engine: EngineClient, project: Project): Promise<void> {
  const jobs: Promise<void>[] = [];
  const live = new Set(project.sources.filter(isXmlSource).map((s) => s.id));
  for (const [id, files] of loaded) {
    if (live.has(id)) continue;
    for (const name of files.keys()) void engine.dropFile(name).catch(() => undefined);
    loaded.delete(id);
    attempts.delete(id);
    fetched.delete(id);
    textShapes.delete(id);
    setRead(id, undefined);
  }
  for (const source of project.sources) {
    if (!isXmlSource(source)) continue;
    const input = xmlInput(source);
    if (input === undefined) continue;
    const file = sourceFileName(source);
    const have = loaded.get(source.id)?.get(file);
    if (have?.input === input) {
      // Read before (switching back to earlier options): use it again straight away.
      attempts.set(source.id, { file, input, token: ++tokens });
      const now = useXmlReads.getState().reads[source.id];
      if (now?.state !== 'ok' || now.file !== file) setRead(source.id, { state: 'ok', file, ...have.read });
      continue;
    }
    const tried = attempts.get(source.id);
    // Being read already, or failed with exactly these options and this input: wait for a change.
    if (tried?.file === file && tried.input === input) continue;
    jobs.push(read(engine, source, input, file));
  }
  return Promise.all(jobs).then(() => undefined);
}

/** Forget everything (tests, and a fresh engine). */
export function resetXmlSources() {
  loaded.clear();
  attempts.clear();
  fetched.clear();
  textShapes.clear();
  useXmlReads.setState({ reads: {} });
}

/** Keep XML sources read while the editor is open. Runs before the flow is evaluated. */
export function useXmlSources() {
  const engine = useEngineStore((s) => s.engine);
  const sources = useProject().sources;
  const attachments = useAttachments((s) => s.sources);
  const version = useFetchedXml((s) => s.version);
  useEffect(() => {
    if (engine) void syncXmlSources(engine, useProjectStore.getState().history.present);
  }, [engine, sources, attachments, version]);
}

/** Choosing another record element starts afresh: the element given a row each belongs to the record it was set on. */
export const withRecord = (options: ParseOptions, record: string): ParseOptions => {
  const next: ParseOptions = { ...options, record };
  delete next.expand;
  return next;
};

/** "book (12)". */
export const recordLabel = (c: RecordCandidate) => `${c.path.split('/').join(' › ')} (${c.count.toLocaleString('en-GB')})`;
