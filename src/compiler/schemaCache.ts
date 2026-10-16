import { inputEdges, nodeById, topoSort, upstreamIds, type ColumnSchema, type Project } from '../model';
import { compile, upstreamKey, type Target } from './compile';
import { knownSchemas, type SchemaBook } from './schemaBook';

/**
 * Caches the schema after every node and step, keyed by upstreamKey, so step editors and wire popovers
 * know the columns without re-running DESCRIBE. A failed DESCRIBE is not cached. Every schema it learns
 * also goes in a SchemaBook, where Join nodes read their inputs' columns when they compile.
 */
export class SchemaCache {
  private readonly entries = new Map<string, Promise<ColumnSchema[]>>();

  constructor(
    private readonly describe: (sql: string) => Promise<ColumnSchema[]>,
    private readonly limit = 500,
    readonly book: SchemaBook = knownSchemas,
  ) {}

  get(project: Project, target: Target): Promise<ColumnSchema[]> {
    const key = upstreamKey(project, target);
    const hit = this.entries.get(key);
    if (hit) {
      this.entries.delete(key);
      this.entries.set(key, hit);
      hit.then(
        (columns) => this.book.set(key, columns),
        () => undefined,
      );
      return hit;
    }
    const pending = (async () => {
      await this.prepare(project, target);
      return this.describe(compile(project, target, { schemas: this.book }).sql);
    })();
    this.entries.set(key, pending);
    pending.then(
      (columns) => this.book.set(key, columns),
      () => this.entries.delete(key),
    );
    while (this.entries.size > this.limit) this.entries.delete(this.entries.keys().next().value!);
    return pending;
  }

  /**
   * Describe the inputs of every Join upstream of the target (both branches), so the target compiles. An
   * input that can't be described is left out: compiling then says what's wrong upstream.
   */
  async prepare(project: Project, target: Target): Promise<void> {
    let order: string[];
    try {
      order = topoSort(project, upstreamIds(project, target.nodeId));
    } catch {
      return;
    }
    for (const id of order) {
      if (nodeById(project, id)?.type !== 'join') continue;
      for (const e of inputEdges(project, id)) {
        const key = upstreamKey(project, { nodeId: e.from.nodeId });
        if (this.book.get(key)) continue;
        await this.get(project, { nodeId: e.from.nodeId }).catch(() => undefined);
      }
    }
  }

  get size() {
    return this.entries.size;
  }

  clear() {
    this.entries.clear();
    this.book.clear();
  }
}
