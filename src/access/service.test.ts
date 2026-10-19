import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tableFromIPC } from 'apache-arrow';
import { createHash, createDecipheriv } from './noCrypto';
import * as read from './read';
import { AccessService } from './service';
import { AccessError, ENCRYPTED } from './types';

const file = (name = 'shop.accdb') => new Blob([readFileSync(join(__dirname, '../../tests/fixtures', name))]);

describe('the Access worker service', () => {
  it('reads a table into an Arrow stream, with the tables of the database and each column’s DuckDB type', async () => {
    const r = await new AccessService().run('read', { db: 'a', file: file(), table: 'Orders' });
    expect(r).toMatchObject({ table: 'Orders', rows: 4 });
    expect(r.tables.map((t) => t.name)).toEqual(['Customers', 'Orders', 'Archive']);
    expect(r.columns.find((c) => c.name === 'Amount')).toEqual({ name: 'Amount', sqlType: 'DECIMAL(19,4)' });
    const table = tableFromIPC(r.ipc);
    expect(table.numRows).toBe(4);
    expect(String(table.schema.fields.find((f) => f.name === 'OrderDate')!.type)).toBe('Timestamp<MICROSECOND>');
  });

  it('opens each database once and keeps only the latest two', async () => {
    const open = vi.spyOn(read, 'openDatabase');
    const service = new AccessService();
    await service.run('read', { db: 'a', file: file() });
    await service.run('read', { db: 'a', file: file(), table: 'Orders' });
    expect(open).toHaveBeenCalledTimes(1);
    await service.run('read', { db: 'b', file: file('shop.mdb') });
    await service.run('read', { db: 'c', file: file() });
    await service.run('read', { db: 'a', file: file() });
    expect(open).toHaveBeenCalledTimes(4);
    await service.run('forget', { db: 'a' });
    await service.run('read', { db: 'a', file: file() });
    expect(open).toHaveBeenCalledTimes(5);
    open.mockRestore();
  });

  it('passes on plain failures and words unexpected ones', async () => {
    const service = new AccessService();
    await expect(service.run('read', { db: 'x', file: new Blob(['not a database']) })).rejects.toThrow('This file isn’t an Access database.');
    const fail = vi.spyOn(read, 'listTables').mockImplementation(() => {
      throw new TypeError('boom');
    });
    await expect(service.run('read', { db: 'y', file: file() })).rejects.toEqual(new AccessError('This database can’t be read (boom).'));
    fail.mockRestore();
  });
});

describe('the browser build’s stand-in for encryption', () => {
  it('says encrypted databases can’t be opened, whichever part mdb-reader asks for', () => {
    expect(() => createHash()).toThrow(ENCRYPTED);
    expect(() => createDecipheriv()).toThrow(ENCRYPTED);
  });
});
