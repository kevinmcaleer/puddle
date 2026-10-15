import type { ColumnSchema, Project } from '../model';
import { compile, upstreamKey, type Target } from './compile';

/**
 * Caches the schema after every node and step, keyed by upstreamKey, so step editors and wire popovers
 * know the columns without re-running DESCRIBE. A failed DESCRIBE is not cached.
 */
export class SchemaCache {
  private readonly entries = new Map<string, Promise<ColumnSchema[]>>();

  constructor(
    private readonly describe: (sql: string) => Promise<ColumnSchema[]>,
    private readonly limit = 500,
  ) {}

  get(project: Project, target: Target): Promise<ColumnSchema[]> {
    const key = upstreamKey(project, target);
    const hit = this.entries.get(key);
    if (hit) {
      this.entries.delete(key);
      this.entries.set(key, hit);
      return hit;
    }
    const pending = (async () => this.describe(compile(project, target).sql))();
    this.entries.set(key, pending);
    pending.catch(() => this.entries.delete(key));
    while (this.entries.size > this.limit) this.entries.delete(this.entries.keys().next().value!);
    return pending;
  }

  get size() {
    return this.entries.size;
  }

  clear() {
    this.entries.clear();
  }
}
