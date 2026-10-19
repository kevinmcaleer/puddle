import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { listTables, openDatabase, readTable } from './read';
import { AccessError, ENCRYPTED } from './types';

const fixture = (name: string) => new Uint8Array(readFileSync(join(__dirname, '../../tests/fixtures', name)));
const ms = (y: number, m: number, d: number, h = 0, min = 0, s = 0) => Date.UTC(y, m - 1, d, h, min, s);

// shop.accdb (Access 2010) and shop.mdb (Access 2000) hold the same tables; scripts/MakeAccessFixtures.java writes them.
describe.each(['shop.accdb', 'shop.mdb'])('%s', (name) => {
  const db = openDatabase(fixture(name));

  it('lists the database’s own tables with their sizes, leaving out system tables', () => {
    expect(listTables(db)).toEqual([
      { name: 'Customers', rows: 3, columns: 6 },
      { name: 'Orders', rows: 4, columns: 10 },
      { name: 'Archive', rows: 0, columns: 2 },
    ]);
  });

  it('reads the first table when none is named, with each Access type and empty values', () => {
    const data = readTable(db);
    expect(data.table).toBe('Customers');
    expect(data.rows).toBe(3);
    expect(data.columns.map((c) => [c.name, c.type, c.sqlType])).toEqual([
      ['CustomerID', 'BIGINT', 'INTEGER'],
      ['Name', 'VARCHAR', 'VARCHAR'],
      ['Email', 'VARCHAR', 'VARCHAR'],
      ['Joined', 'TIMESTAMP', 'TIMESTAMP'],
      ['Active', 'BOOLEAN', 'BOOLEAN'],
      ['CreditLimit', 'VARCHAR', 'DECIMAL(19,4)'],
    ]);
    const col = (n: string) => data.columns.find((c) => c.name === n)!.values;
    expect(col('Name')).toEqual(['Ann Lee', 'Bob Ray', 'Zoë Café']);
    expect(col('Email')).toEqual(['ann@example.com', null, 'zoe@example.com']);
    // Access date-times have no time zone: they are read as written, as UTC.
    expect(col('Joined')).toEqual([ms(2025, 3, 14), ms(2025, 7, 1, 9, 30), ms(2026, 1, 20, 17, 45, 10)]);
    expect(col('Active')).toEqual([true, false, true]);
    expect(col('CreditLimit')).toEqual(['1500.0000', '250.5000', null]);
  });

  it('reads a named table, keeping each number type’s size', () => {
    const data = readTable(db, 'Orders');
    expect(data.columns.map((c) => `${c.name} ${c.sqlType}`)).toEqual([
      'OrderID INTEGER',
      'CustomerID INTEGER',
      'OrderDate TIMESTAMP',
      'Quantity SMALLINT',
      'Weight DOUBLE',
      'Discount FLOAT',
      'Priority UTINYINT',
      'Amount DECIMAL(19,4)',
      'Notes VARCHAR',
      'Shipped BOOLEAN',
    ]);
    const col = (n: string) => data.columns.find((c) => c.name === n)!.values;
    expect(col('Quantity')).toEqual([3, 1, 12, null]);
    expect(col('Notes')).toEqual(['Leave at the door', null, 'Gift wrap, café box', '']);
    expect(col('OrderDate')[3]).toBeNull();
  });

  it('reads an empty table as its columns with no rows', () => {
    const data = readTable(db, 'Archive');
    expect(data.rows).toBe(0);
    expect(data.columns.map((c) => c.name)).toEqual(['ID', 'Note']);
  });

  it('says plainly when a table isn’t there', () => {
    expect(() => readTable(db, 'Invoices')).toThrow(new AccessError('There is no table called Invoices in this database. Choose another table.'));
  });
});

describe('files that can’t be read', () => {
  it('refuses a file that isn’t an Access database', () => {
    expect(() => openDatabase(new TextEncoder().encode('a,b\n1,2\n'))).toThrow(AccessError);
    expect(() => openDatabase(fixture('sales.xlsx'))).toThrow('This file isn’t an Access database. Save it from Access as .accdb or .mdb, or export the tables as CSV.');
  });

  // locked.accdb is mdb-reader's own test database with the password "password" (MIT licence, github.com/andipaetzold/mdb-reader).
  it('says that a database encrypted with a password can’t be opened', () => {
    expect(() => openDatabase(fixture('locked.accdb'))).toThrow(ENCRYPTED);
  });
});
