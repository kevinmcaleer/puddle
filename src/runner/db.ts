// DuckDB's native Node build behind the two calls the runner makes: rows of a query, and the columns a query would have.
import { DuckDBConnection, DuckDBInstance } from '@duckdb/node-api';
import type { ColumnSchema } from '../model';

export interface RunnerDb {
  query(sql: string): Promise<Record<string, unknown>[]>;
  describe(sql: string): Promise<ColumnSchema[]>;
  close(): Promise<void>;
}

/**
 * An in-memory database. A run points DuckDB's relative file names (the compiler's `src_<id>.csv`) at the folder
 * where it has placed each source. Extensions DuckDB doesn't ship built in (json on some builds) load on first use.
 */
export async function openDb(): Promise<RunnerDb> {
  const instance = await DuckDBInstance.create(':memory:');
  const conn: DuckDBConnection = await instance.connect();
  return {
    async query(sql) {
      const result = await conn.runAndReadAll(sql);
      return result.getRowObjectsJS() as Record<string, unknown>[];
    },
    async describe(sql) {
      const result = await conn.runAndReadAll(`DESCRIBE ${sql}`);
      return result.getRowObjectsJS().map((r) => ({ name: String(r.column_name), type: String(r.column_type) }));
    },
    async close() {
      conn.closeSync();
      instance.closeSync();
    },
  };
}
