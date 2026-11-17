// A database file (SQLite, DuckDB) added the way any file is: dropped on the canvas or chosen from the file picker.
// It becomes a connection with the file chosen for this tab, and the table picker opens so its tables can be read.
import { addConnection, useProjectStore, type DriverId } from '../model';
import { openTablePicker } from './dialog';
import { rememberConnectionFile } from './files';
import { newConnection } from './form';
import { useReach } from './service';

const DRIVER_BY_EXTENSION: Record<string, DriverId> = {
  sqlite: 'sqlite', sqlite3: 'sqlite', sqlitedb: 'sqlite', db: 'sqlite', db3: 'sqlite', s3db: 'sqlite', sl3: 'sqlite', gpkg: 'sqlite', mbtiles: 'sqlite',
  duckdb: 'duckdb', ddb: 'duckdb',
};

/** The file driver a database file's name says it is for, or undefined when it isn't a database file Puddle reads. */
export function databaseDriverFor(name: string): DriverId | undefined {
  const ext = name.toLowerCase().split('.').pop() ?? '';
  return DRIVER_BY_EXTENSION[ext];
}

/** How many bytes from the start of a file say whether it is a database file. */
export const DATABASE_HEAD_BYTES = 16;

/**
 * The file driver a database file's first bytes say it is for: SQLite's header string, or DuckDB's magic after the
 * checksum. A database file is often named without a known extension (a browser's History, an app's .data file).
 */
export function databaseDriverOf(head: Uint8Array): DriverId | undefined {
  const text = (from: number, length: number) => String.fromCharCode(...head.subarray(from, from + length));
  if (head.length >= 16 && text(0, 16) === 'SQLite format 3\0') return 'sqlite';
  if (head.length >= 12 && text(8, 4) === 'DUCK') return 'duckdb';
  return undefined;
}

/** The file driver for a file: by its name, else by its first bytes. Undefined for a file that isn't a database. */
export async function databaseDriverForFile(file: Blob & { name: string }): Promise<DriverId | undefined> {
  const byName = databaseDriverFor(file.name);
  if (byName) return byName;
  try {
    return databaseDriverOf(new Uint8Array(await file.slice(0, DATABASE_HEAD_BYTES).arrayBuffer()));
  } catch {
    // An unreadable file goes on to the usual source path, which says what is wrong with it.
    return undefined;
  }
}

/**
 * Add a database file as a connection (named after the file) and open the table picker on it. `driver` is the one
 * its content says, for a file whose name doesn't. Returns the connection's id, or undefined when the file isn't a
 * database file.
 */
export function addDatabaseFile(file: File, driver: DriverId | undefined = databaseDriverFor(file.name)): string | undefined {
  if (!driver) return undefined;
  const project = useProjectStore.getState().history.present;
  const base = file.name.replace(/\.[^.]+$/, '') || file.name;
  const connection = { ...newConnection(project, driver, useReach.getState()), settings: { file: file.name } };
  connection.name = project.connections.some((c) => c.name === base) ? connection.name : base;
  rememberConnectionFile(connection.id, file);
  useProjectStore.getState().apply((p) => addConnection(p, connection));
  openTablePicker(connection.id);
  return connection.id;
}
