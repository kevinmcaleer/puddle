import type { ColumnSchema } from '../model';

/**
 * Described schemas the compiler can read synchronously, keyed by upstreamKey. Most nodes compile without
 * knowing their columns, but a Join has to name them (to suffix clashing names and drop repeated keys), so
 * it reads its inputs' schemas from here. The SchemaCache writes every schema it describes into a book.
 */
export class SchemaBook {
  private readonly entries = new Map<string, ColumnSchema[]>();

  constructor(private readonly limit = 2000) {}

  get(key: string): ColumnSchema[] | undefined {
    const hit = this.entries.get(key);
    if (hit) {
      this.entries.delete(key);
      this.entries.set(key, hit);
    }
    return hit;
  }

  set(key: string, columns: ColumnSchema[]) {
    this.entries.delete(key);
    this.entries.set(key, columns);
    while (this.entries.size > this.limit) this.entries.delete(this.entries.keys().next().value!);
  }

  get size() {
    return this.entries.size;
  }

  clear() {
    this.entries.clear();
  }
}

/** The app's book: filled by the flow's schema cache, read by every compile that doesn't pass its own. */
export const knownSchemas = new SchemaBook();
