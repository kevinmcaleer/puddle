// A database file (SQLite, DuckDB) added the way any file is: dropped on the canvas or chosen from the file picker.
// It becomes a connection with the file chosen for this tab, and the table picker opens so its tables can be read.
import { addConnection, useProjectStore, type DriverId } from '../model';
import { openTablePicker } from './dialog';
import { rememberConnectionFile } from './files';
import { newConnection } from './form';
import { useReach } from './service';

const DRIVER_BY_EXTENSION: Record<string, DriverId> = { sqlite: 'sqlite', sqlite3: 'sqlite', db: 'sqlite', db3: 'sqlite', s3db: 'sqlite', duckdb: 'duckdb', ddb: 'duckdb' };

/** The file driver a database file's name says it is for, or undefined when it isn't a database file Puddle reads. */
export function databaseDriverFor(name: string): DriverId | undefined {
  const ext = name.toLowerCase().split('.').pop() ?? '';
  return DRIVER_BY_EXTENSION[ext];
}

/**
 * Add a database file as a connection (named after the file) and open the table picker on it. Returns the
 * connection's id, or undefined when the file isn't a database file.
 */
export function addDatabaseFile(file: File): string | undefined {
  const driver = databaseDriverFor(file.name);
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
