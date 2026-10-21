import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tableFromIPC } from 'apache-arrow';
import { duckType, isSqlite, listTables, openDatabase, readRows } from './read';
import { SqliteService } from './service';

const shop = () => new Uint8Array(readFileSync(join(__dirname, '../../tests/fixtures/db/shop.sqlite')));

describe('SQLite files', () => {
  it('knows a SQLite file by its header and refuses anything else', async () => {
    expect(isSqlite(shop())).toBe(true);
    expect(isSqlite(new TextEncoder().encode('id,name\n1,Ada\n'))).toBe(false);
    await expect(openDatabase(new TextEncoder().encode('id,name\n1,Ada\n'))).rejects.toThrow('isn’t a SQLite database');
  });

  it('lists tables and views with their declared columns, keys and row counts', async () => {
    const db = await openDatabase(shop());
    const tables = listTables(db);
    expect(tables.map((t) => [t.name, t.kind, t.rows])).toEqual([
      ['customers', 'table', 3],
      ['orders', 'table', 4],
      ['order_totals', 'view', 3],
    ]);
    expect(tables[0]!.columns).toEqual([
      { name: 'id', type: 'INTEGER', pk: true, notNull: false },
      { name: 'name', type: 'TEXT', pk: false, notNull: true },
      { name: 'email', type: 'TEXT', pk: false, notNull: false },
      { name: 'signed_up', type: 'DATE', pk: false, notNull: false },
      { name: 'active', type: 'BOOLEAN', pk: false, notNull: false },
    ]);
    db.close();
  });

  it('maps declared types by SQLite’s affinity rules', () => {
    expect(duckType('INTEGER').sqlType).toBe('BIGINT');
    expect(duckType('varchar(40)').sqlType).toBe('VARCHAR');
    expect(duckType('REAL').sqlType).toBe('DOUBLE');
    expect(duckType('BOOLEAN').sqlType).toBe('BOOLEAN');
    expect(duckType('DECIMAL(10,2)').sqlType).toBe('DECIMAL(10,2)');
    expect(duckType('DATE').sqlType).toBe('VARCHAR');
    expect(duckType('').sqlType).toBe('VARCHAR');
  });

  it('reads a table with its declared types, a query typed from its values, and honours a limit', async () => {
    const db = await openDatabase(shop());
    const customers = readRows(db, { table: 'customers' });
    expect(customers.rows).toBe(3);
    expect(customers.columns.map((c) => [c.name, c.sqlType])).toEqual([['id', 'BIGINT'], ['name', 'VARCHAR'], ['email', 'VARCHAR'], ['signed_up', 'VARCHAR'], ['active', 'BOOLEAN']]);
    expect(customers.columns[4]!.values).toEqual([true, true, false]);
    expect(customers.columns[2]!.values[2]).toBeNull();

    const q = readRows(db, { query: 'SELECT name, total * 2 AS doubled, count(*) AS n FROM order_totals GROUP BY 1, 2 ORDER BY 1' }, 2);
    expect(q.rows).toBe(2);
    expect(q.columns.map((c) => [c.name, c.sqlType])).toEqual([['name', 'VARCHAR'], ['doubled', 'DOUBLE'], ['n', 'BIGINT']]);
    expect(() => readRows(db, { table: 'nothing' })).toThrow('no table called nothing');
    expect(() => readRows(db, { query: 'SELEKT 1' })).toThrow('SQLite can’t run that');
    db.close();
  });

  it('the service reads a table into an Arrow stream DuckDB can load', async () => {
    const service = new SqliteService();
    const r = await service.run('read', { db: 'a', file: new Blob([shop()]), table: 'orders', limit: 3 });
    expect(r.rows).toBe(3);
    const table = tableFromIPC(r.ipc);
    expect(table.numRows).toBe(3);
    expect(table.schema.fields.map((f) => f.name)).toEqual(['id', 'customer_id', 'total', 'placed_at']);
    expect((await service.run('tables', { db: 'a', file: new Blob([shop()]) })).map((t) => t.name)).toEqual(['customers', 'orders', 'order_totals']);
    await service.run('forget', { db: 'a' });
  });
});
