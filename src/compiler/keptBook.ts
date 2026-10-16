import { ident } from './sql';

/** A node's result kept as a table, and the upstream key it was built for. */
export interface KeptTable {
  key: string;
  table: string;
}

/**
 * Kept results (pinned node results): tables holding a node's output, by node id. The compiler reads a kept
 * node from its table, instead of compiling everything upstream of it, while the table's key matches the node's
 * upstream key. A stale table is simply not used. The flow's kept-results sync (flow/kept.ts) writes here.
 */
export class KeptBook {
  private readonly entries = new Map<string, KeptTable>();

  get(nodeId: string): KeptTable | undefined {
    return this.entries.get(nodeId);
  }

  set(nodeId: string, table: KeptTable) {
    this.entries.set(nodeId, table);
  }

  delete(nodeId: string) {
    this.entries.delete(nodeId);
  }

  ids(): string[] {
    return [...this.entries.keys()];
  }

  clear() {
    this.entries.clear();
  }
}

/** The app's book, read by every compile that doesn't pass its own. */
export const knownKept = new KeptBook();

/** The table a node's kept result lives in. */
export const keptTableName = (nodeId: string) => `kept_${nodeId}`;

/** The table name quoted for SQL. */
export const keptTable = (nodeId: string) => ident(keptTableName(nodeId));
