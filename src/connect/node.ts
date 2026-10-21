// The drivers as puddle-connect and the runner run them in Node: the same Connector interface, with a database
// file read from a path on this computer (inside the folders the service may read) rather than picked in a page.
// Drivers that need a database protocol (#206 onwards) register here as they land.
import { readFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import type { Connection, DriverId } from '../model';
import { inProcessClient } from '../sqlite/client';
import { SqliteService } from '../sqlite/service';
import { sqliteConnector } from './drivers/sqlite';
import { ConnectorError, type Connector, type ConnectorContext } from './types';

export interface NodeOptions {
  /** Folders a file driver may read from. Empty reads no file at all. */
  files: string[];
}

/** Whether a path is inside one of the folders, after resolving it (so `..` can't leave). */
export function insideFolders(path: string, folders: string[]): boolean {
  const full = resolve(path);
  return folders.some((f) => {
    const root = resolve(f);
    return full === root || full.startsWith(root.endsWith(sep) ? root : root + sep);
  });
}

/** The file a connection names, read from disk when the service may read there. */
export async function fileFor(connection: Pick<Connection, 'settings'>, options: NodeOptions): Promise<Blob> {
  const path = String(connection.settings.path ?? '').trim();
  if (!path) throw new ConnectorError('Give the path of the database file on the computer running puddle-connect.');
  if (!insideFolders(path, options.files)) throw new ConnectorError(options.files.length ? 'That file is outside the folders puddle-connect may read (PUDDLE_CONNECT_FILES).' : 'puddle-connect may read no files: set PUDDLE_CONNECT_FILES to the folders it may.');
  try {
    return new Blob([await readFile(resolve(path))]);
  } catch (e) {
    throw new ConnectorError(`The file can’t be read (${e instanceof Error ? e.message : String(e)}).`);
  }
}

let sqlite: SqliteService | undefined;

/** A file driver's connector, with the file read from the connection's path for each call. */
function fileConnector(inner: Connector, options: NodeOptions): Connector {
  const withFile = async (ctx: ConnectorContext): Promise<ConnectorContext> => ({ ...ctx, file: ctx.file ?? (await fileFor(ctx.connection, options)) });
  return {
    id: inner.id,
    runsIn: ['local', 'pi'],
    test: async (ctx) => inner.test(await withFile(ctx)),
    catalog: async (ctx) => inner.catalog(await withFile(ctx)),
    read: async (ctx, req) => inner.read(await withFile(ctx), req),
    ...(inner.document ? { document: async (ctx) => inner.document!(await withFile(ctx)) } : {}),
  };
}

/** The drivers this build of the service has, by id. */
export function nodeConnectors(options: NodeOptions): Partial<Record<DriverId, Connector>> {
  const client = () => inProcessClient((sqlite ??= new SqliteService()));
  return {
    sqlite: fileConnector(sqliteConnector('sqlite', client), options),
    libsql: fileConnector(sqliteConnector('libsql', client), options),
  };
}
