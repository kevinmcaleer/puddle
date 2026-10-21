// DuckDB's native Node build behind the calls the runner makes: rows of a query, the columns a query would have,
// and a driver's Arrow stream appended into a staging table (the browser engine's insertArrow, done row by row).
import { DuckDBConnection, DuckDBDateValue, DuckDBInstance, DuckDBTimestampValue } from '@duckdb/node-api';
import { compileStagingTable } from '../compiler';
import type { ColumnSchema } from '../model';
import { stagingOf, stagingRows } from './arrow';

export interface RunnerDb {
  query(sql: string): Promise<Record<string, unknown>[]>;
  describe(sql: string): Promise<ColumnSchema[]>;
  /** A driver's Arrow IPC stream as a table named `name`, with the types the stream carries. */
  insertArrow(name: string, ipc: Uint8Array): Promise<void>;
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
    async insertArrow(name, ipc) {
      const { table, columns } = stagingOf(ipc);
      await conn.run(compileStagingTable(name, columns));
      if (!columns.length) return;
      const appender = await conn.createAppender(name);
      try {
        for (const row of stagingRows(table, columns)) {
          row.forEach((v, j) => {
            if (v === null) return appender.appendNull();
            switch (columns[j]!.sqlType) {
              case 'BIGINT':
                return appender.appendBigInt(v as bigint);
              case 'DOUBLE':
                return appender.appendDouble(v as number);
              case 'DATE':
                return appender.appendDate(new DuckDBDateValue(v as number));
              case 'TIMESTAMP':
                return appender.appendTimestamp(new DuckDBTimestampValue(v as bigint));
              case 'BOOLEAN':
                return appender.appendBoolean(v as boolean);
              case 'BLOB':
                return appender.appendBlob(v as Uint8Array);
              default:
                return appender.appendVarchar(v as string);
            }
          });
          appender.endRow();
        }
        appender.flushSync();
      } finally {
        appender.closeSync();
      }
    },
    async close() {
      conn.closeSync();
      instance.closeSync();
    },
  };
}
