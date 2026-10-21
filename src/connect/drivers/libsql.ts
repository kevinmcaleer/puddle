// LibSQL: Turso (or any sqld) over HTTP when the connection has an address, else a local file, which is a SQLite file.
import type { Connector } from '../types';
import { hranaConnector } from './hrana';
import { sqliteConnector } from './sqlite';

/** The connector that fits the connection: the address when one is given, the file otherwise. */
export function libsqlConnector(file: Connector = sqliteConnector('libsql'), http: Connector = hranaConnector()): Connector {
  const pick = (ctx: { connection: { settings: Record<string, unknown> } }) => (String(ctx.connection.settings.url ?? '').trim() ? http : file);
  return {
    id: 'libsql',
    runsIn: ['browser', 'local', 'pi'],
    test: (ctx) => pick(ctx).test(ctx),
    catalog: (ctx) => pick(ctx).catalog(ctx),
    read: (ctx, req) => pick(ctx).read(ctx, req),
    document: (ctx) => pick(ctx).document!(ctx),
  };
}

export default libsqlConnector();
