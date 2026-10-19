import { columnsToCsv } from './csv';

describe('an Access table as CSV for the runner', () => {
  it('writes every value as text DuckDB casts back: empty for none, quoted text, timestamps, bytes as escapes', () => {
    const csv = columnsToCsv([
      { name: 'Name, full', type: 'VARCHAR', sqlType: 'VARCHAR', values: ['Ann "A" Lee', '', null] },
      { name: 'When', type: 'TIMESTAMP', sqlType: 'TIMESTAMP', values: [Date.UTC(2026, 0, 5, 14, 5, 9, 7), null, Date.UTC(1899, 11, 30)] },
      { name: 'Paid', type: 'BOOLEAN', sqlType: 'BOOLEAN', values: [true, false, null] },
      { name: 'Qty', type: 'BIGINT', sqlType: 'SMALLINT', values: [3, -1, null] },
      { name: 'Photo', type: 'BLOB', sqlType: 'BLOB', values: [new Uint8Array([0, 0xab]), null, new Uint8Array()] },
    ]);
    expect(csv.split('\n')).toEqual([
      '"Name, full","When","Paid","Qty","Photo"',
      '"Ann ""A"" Lee",2026-01-05 14:05:09.007,true,3,"\\x00\\xAB"',
      '"",,false,-1,',
      ',1899-12-30 00:00:00.000,,,""',
      '',
    ]);
  });

  it('writes a table with no rows as its header', () => {
    expect(columnsToCsv([{ name: 'ID', type: 'BIGINT', sqlType: 'INTEGER', values: [] }])).toBe('"ID"\n');
  });
});
