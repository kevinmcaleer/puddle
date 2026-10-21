import { addSource, newId, useProjectStore, type Project, type Source } from '../model';
import type { WordTableInfo } from '../word';
import { shareHandle } from './access';
import { engineOrThrow, rememberFile, sourceFile } from './add';
import { attachArchive, isArchiveSource, sourceArchive } from './archive';
import { markAttached } from './attachments';
import { useRewrites } from './rewrite';

/**
 * Word documents (#193). A .docx is read for its tables (src/word) through the rewrite path (./rewrite): the source
 * reads one table, the biggest unless the read options name another, and the document's other tables can be added
 * as sources of their own, which share the file, as the tables of an Access database do.
 */

export const isWordSource = (s: Source) => s.format === 'word' && s.kind === 'file';

/** The table a source reads, as its last read found it. */
export const wordTableOf = (source: Source): number | undefined => {
  const read = useRewrites.getState().reads[source.id];
  return source.parseOptions.table ? Number.parseInt(source.parseOptions.table, 10) : read?.state === 'ok' ? read.table : undefined;
};

/** The tables of a source's document that no source in the project reads yet (from this same file). */
export function tablesNotAdded(project: Project, source: Source, tables: WordTableInfo[]): WordTableInfo[] {
  const file = sourceFile(source.id);
  const taken = new Set(project.sources.filter((s) => isWordSource(s) && sourceFile(s.id) === file && s.archive?.entry === source.archive?.entry).map(wordTableOf));
  return tables.filter((t) => !taken.has(t.index));
}

/**
 * Add a source for each of these tables of a source's document, below it on the canvas, as one undo step. They
 * share its file (and, where the browser gave one, its handle), so it is chosen once.
 */
export async function addWordTables(source: Source, tables: WordTableInfo[]): Promise<Source[]> {
  const file = sourceFile(source.id);
  if (!file || !source.file || !tables.length) return [];
  const project = useProjectStore.getState().history.present;
  const node = project.nodes.find((n) => n.type === 'source' && n.sourceId === source.id);
  const at = node?.position ?? { x: 80, y: 80 };
  const added = tables.map(
    (t): Source => ({
      id: newId('s'),
      name: t.label,
      kind: 'file',
      format: 'word',
      file: { ...source.file! },
      ...(source.archive ? { archive: { ...source.archive } } : {}),
      parseOptions: { ...(source.parseOptions.header != null ? { header: source.parseOptions.header } : {}), table: String(t.index) },
      detectedSchema: [],
    }),
  );
  for (const s of added) {
    const archive = sourceArchive(source.id);
    if (isArchiveSource(s) && archive) await attachArchive(engineOrThrow(), s, archive);
    else rememberFile(s.id, file);
    markAttached(s.id);
  }
  useProjectStore.getState().batch(() => {
    added.forEach((s, i) => useProjectStore.getState().apply((p) => addSource(p, s, { x: at.x, y: at.y + (i + 1) * 128 })));
  });
  void shareHandle(project.id, source.id, added.map((s) => s.id));
  return added;
}
