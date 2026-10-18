import { useEngineStore } from '../app/engine';
import { sourceFileName } from '../compiler';
import { addSource, newId, useProjectStore, type Source } from '../model';
import { formatFromName, formatFromText, SourceError, sourceName } from './detect';
import { markAttached } from './attachments';
import { keepHandle, type FileHandle } from './handles';
import { headHash } from './hash';

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
  const format = formatFromName(file.name);
  const engine = engineOrThrow();
  const source: Source = {
    id: newId('s'),
    name: sourceName(file.name),
    kind: 'file',
    format,
    file: { originalName: file.name, size: file.size, lastModified: file.lastModified, headHash: await headHash(file) },
    parseOptions: {},
    detectedSchema: [],
  };
  // Excel is read by SheetJS into a table (see ./excel), and XML into rows (see ./xml), not by DuckDB from the file.
  if (format !== 'xlsx' && format !== 'xml') await engine.registerFile(sourceFileName(source), file);
  files.set(source.id, file);
  markAttached(source.id);
  useProjectStore.getState().apply((p) => addSource(p, source, position));
  keepHandle(source.id, handle);
  return source;
}

/** Add pasted text as a source. Clipboard text is small, so it is stored in the project itself. */
export async function addClipboardSource(text: string, position = { x: 80, y: 80 }, name = 'Pasted data'): Promise<Source> {
  if (!text.trim()) throw new SourceError('The clipboard is empty. Copy some rows from a spreadsheet or a file, then paste again.');
  const engine = engineOrThrow();
  const format = formatFromText(text);
  const source: Source = {
    id: newId('s'),
    name,
    kind: 'clipboard',
    format,
    clipboard: { text },
    parseOptions: {},
    detectedSchema: [],
  };
  // Pasted XML is read into rows by ./xml.
  if (format !== 'xml') await engine.registerText(sourceFileName(source), text);
  markAttached(source.id);
  useProjectStore.getState().apply((p) => addSource(p, source, position));
  return source;
}
