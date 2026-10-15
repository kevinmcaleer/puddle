import { useEngineStore } from '../app/engine';
import { sourceFileName } from '../compiler';
import { addSource, newId, useProjectStore, type Source } from '../model';
import { formatFromName, formatFromText, SourceError, sourceName } from './detect';
import { headHash } from './hash';

/** Files picked this session, by source id. Projects store references, never the data (plan D6). */
const files = new Map<string, File>();

export const sourceFile = (sourceId: string) => files.get(sourceId);

function engineOrThrow() {
  const engine = useEngineStore.getState().engine;
  if (!engine) throw new SourceError('DuckDB is still starting. Try again in a moment.');
  return engine;
}

/** Register a file with DuckDB (by handle, never copied) and add a Source node for it. */
export async function addFileSource(file: File, position = { x: 80, y: 80 }): Promise<Source> {
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
  await engine.registerFile(sourceFileName(source), file);
  files.set(source.id, file);
  useProjectStore.getState().apply((p) => addSource(p, source, position));
  return source;
}

/** Add pasted text as a source. Clipboard text is small, so it is stored in the project itself. */
export async function addClipboardSource(text: string, position = { x: 80, y: 80 }): Promise<Source> {
  if (!text.trim()) throw new SourceError('The clipboard is empty. Copy some rows from a spreadsheet or a file, then paste again.');
  const engine = engineOrThrow();
  const source: Source = {
    id: newId('s'),
    name: 'Pasted data',
    kind: 'clipboard',
    format: formatFromText(text),
    clipboard: { text },
    parseOptions: {},
    detectedSchema: [],
  };
  await engine.registerText(sourceFileName(source), text);
  useProjectStore.getState().apply((p) => addSource(p, source, position));
  return source;
}
