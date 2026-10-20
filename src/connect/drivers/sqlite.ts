// SQLite database files (and LibSQL files, which are SQLite files), read in the browser by the SQLite worker.
import type { Catalog, CatalogTable } from '../../model';
import { sqliteClient, type SqliteClient } from '../../sqlite/client';
import { duckType } from '../../sqlite/read';
import type { SqliteTableInfo } from '../../sqlite/types';
import { ConnectorError, type Connector, type ConnectorContext } from '../types';

const need = (ctx: ConnectorContext) => {
  if (!ctx.file) throw new ConnectorError('Choose the database file first.');
  return { db: `conn:${ctx.connection.id}`, file: ctx.file };
};

/** A SQLite table as the catalogue lists it. */
export const catalogTable = (t: SqliteTableInfo): CatalogTable => ({ name: t.name, kind: t.kind, rows: t.rows, columns: t.columns.map((c) => ({ name: c.name, type: duckType(c.type).sqlType, nullable: !c.notNull && !c.pk })) });

export function sqliteConnector(id: 'sqlite' | 'libsql', client: () => SqliteClient = sqliteClient): Connector {
  return {
    id,
    runsIn: ['browser'],
    async test(ctx) {
      const tables = await client().call('tables', need(ctx));
      return { ok: true, server: `SQLite file, ${tables.length} ${tables.length === 1 ? 'table' : 'tables'}` };
    },
    async catalog(ctx): Promise<Catalog> {
      return { tables: (await client().call('tables', need(ctx))).map(catalogTable) };
    },
    async read(ctx, req) {
      const r = await client().call('read', { ...need(ctx), table: req.table?.name, query: req.query, limit: req.limit });
      return { columns: r.columns, rows: r.rows, ipc: r.ipc };
    },
  };
}

export default sqliteConnector('sqlite');
