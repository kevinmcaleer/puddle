import { useEngineStore } from '../app/engine';
import { isRewritten, sourceFileName } from '../compiler';
import type { EngineClient } from '../engine';
import { invalidateCaches } from '../flow/status';
import { addSource, newId, setSourceFormat, useProjectStore, type ParseOptions, type Source, type SourceFormat } from '../model';
import { SourceError, sourceName } from './detect';
import { markAttached } from './attachments';
import { openFormatDialog } from './formatDialog';
import { keepHandle, type FileHandle } from './handles';
import { HEAD_BYTES, hashBytes } from './hash';
import { sniff, sniffPasted, TAIL_BYTES } from './sniff';

/** Files picked this session, by source id. Projects store references, never the data (plan D6). */
const files = new Map<string, File>();

export const sourceFile = (sourceId: string) => files.get(sourceId);

/** Remember the file now registered for a source (used when a file is chosen again on reopen). */
export const rememberFile = (sourceId: string, file: File) => files.set(sourceId, file);

function engineOrThrow() {
  const engine = useEngineStore.getState().engine;
  if (!engine) throw new SourceError('DuckDB is still starting. Try again in a moment.');
  return engine;
}

/**
 * Register a file with DuckDB (by handle, never copied) and add a Source node for it. A file system handle, where
 * the browser gave one, is kept so the file reconnects with a permission click next time.
 */
export async function addFileSource(file: File, position = { x: 80, y: 80 }, handle?: FileHandle): Promise<Source> {
  const head = new Uint8Array(await file.slice(0, HEAD_BYTES).arrayBuffer());
  const tail = file.size > HEAD_BYTES ? new Uint8Array(await file.slice(Math.max(0, file.size - TAIL_BYTES)).arrayBuffer()) : undefined;
  // The bytes say what the file is (plan D24); the name only breaks a tie. A file that could be two things opens the
  // Format picker once it is on the canvas, with the best guess already read.
  const sniffed = sniff({ name: file.name, head, size: file.size, tail });
  const engine = engineOrThrow();
  const source: Source = {
    id: newId('s'),
    name: sourceName(file.name),
    kind: 'file',
    format: sniffed.format,
    file: { originalName: file.name, size: file.size, lastModified: file.lastModified, headHash: await hashBytes(head) },
    parseOptions: sniffed.parseOptions,
    detectedSchema: [],
  };
  await registerFile(engine, source, file);
  files.set(source.id, file);
  markAttached(source.id);
  useProjectStore.getState().apply((p) => addSource(p, source, position));
  keepHandle(source.id, handle);
  if (sniffed.confidence === 'unsure') openFormatDialog(source.id, sniffed.reason);
  return source;
}

/** Excel is read by SheetJS into a table (see ./excel), Access by mdb-reader (see ./access), and XML, fixed-width text and pipe tables into rows (see ./xml, ./rewrite), not by DuckDB from the file. */
const readByDuckDb = (format: SourceFormat) => format !== 'xlsx' && format !== 'access' && !isRewritten(format);

/** Hand a source's file to DuckDB under the name its format reads, straight from the file handle (never copied). */
export async function registerSourceFile(engine: Pick<EngineClient, 'registerFile'>, source: Source, file: File) {
  if (readByDuckDb(source.format)) await engine.registerFile(sourceFileName(source), file);
}
const registerFile = registerSourceFile;

/**
 * Read a file source as another format (the Format picker, or the Format field in Read options): the file is
 * registered under the name the new format reads, and every result downstream is computed again.
 */
export async function changeSourceFormat(sourceId: string, format: SourceFormat, parseOptions: ParseOptions = {}): Promise<void> {
  const project = useProjectStore.getState().history.present;
  const source = project.sources.find((s) => s.id === sourceId);
  if (!source || (source.format === format && JSON.stringify(source.parseOptions) === JSON.stringify(parseOptions))) return;
  const next = { ...source, format, parseOptions };
  const file = files.get(sourceId);
  if (file && source.kind === 'file') {
    const engine = engineOrThrow();
    if (readByDuckDb(source.format)) await engine.dropFile(sourceFileName(source)).catch(() => undefined);
    await registerFile(engine, next, file);
  } else if (source.kind === 'clipboard' && source.clipboard) {
    const engine = engineOrThrow();
    if (readByDuckDb(source.format)) await engine.dropFile(sourceFileName(source)).catch(() => undefined);
    if (readByDuckDb(format)) await engine.registerText(sourceFileName(next), source.clipboard.text);
  }
  invalidateCaches();
  useProjectStore.getState().apply((p) => setSourceFormat(p, sourceId, format, parseOptions));
}

/** Add pasted text as a source. Clipboard text is small, so it is stored in the project itself. */
export async function addClipboardSource(text: string, position = { x: 80, y: 80 }, name = 'Pasted data'): Promise<Source> {
  if (!text.trim()) throw new SourceError('The clipboard is empty. Copy some rows from a spreadsheet or a file, then paste again.');
  const engine = engineOrThrow();
  const { format, parseOptions } = sniffPasted(text);
  const source: Source = {
    id: newId('s'),
    name,
    kind: 'clipboard',
    format,
    clipboard: { text },
    parseOptions,
    detectedSchema: [],
  };
  // Pasted XML is read into rows by ./xml, a pasted pipe table or fixed-width text by ./rewrite.
  if (readByDuckDb(format)) await engine.registerText(sourceFileName(source), text);
  markAttached(source.id);
  useProjectStore.getState().apply((p) => addSource(p, source, position));
  return source;
}
