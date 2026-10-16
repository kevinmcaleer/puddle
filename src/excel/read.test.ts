import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as XLSX from 'xlsx';
import { guessHeaderRow, listSheets, parseWorkbook, readSheet, serialToMs } from './read';
import { ExcelError } from './types';

const fixture = () => new Uint8Array(readFileSync(join(__dirname, '../../tests/fixtures/sales.xlsx')));
const day = (y: number, m: number, d: number) => Date.UTC(y, m - 1, d) / 86_400_000;

/** A workbook built in memory and written to .xlsx bytes, so each test reads exactly what it describes. */
function book(rows: unknown[][], extra: (ws: XLSX.WorkSheet) => void = () => {}, opts: { date1904?: boolean } = {}): Uint8Array {
  const ws = XLSX.utils.aoa_to_sheet(rows);
  extra(ws);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
  if (opts.date1904) wb.Workbook = { WBProps: { date1904: true } };
  return new Uint8Array(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer);
}

describe('the fixture workbook', () => {
  const wb = parseWorkbook(fixture());

  it('lists every sheet with its size', () => {
    expect(listSheets(wb)).toEqual([
      { name: 'Sales', rows: 7, columns: 8 },
      { name: 'Visits', rows: 3, columns: 4 },
      { name: 'Empty', rows: 0, columns: 0 },
    ]);
  });

  it('skips the title row, names merged and empty header cells, and keeps Excel types', () => {
    const data = readSheet(wb);
    expect(data).toMatchObject({ sheet: 'Sales', headerRow: 3, range: 'A1:H7', rows: 4 });
    expect(data.columns.map((c) => [c.name, c.type])).toEqual([
      ['Region', 'VARCHAR'],
      ['Order date', 'DATE'],
      ['Amount', 'DOUBLE'],
      ['Paid', 'BOOLEAN'],
      ['Notes', 'VARCHAR'],
      ['Contact', 'VARCHAR'],
      ['Contact_2', 'VARCHAR'],
      ['Column H', 'BIGINT'],
    ]);
    const col = (name: string) => data.columns.find((c) => c.name === name)!.values;
    expect(col('Order date')).toEqual([day(2026, 1, 5), day(2026, 2, 10), day(2026, 3, 15), day(2026, 3, 31)]);
    // The #N/A error cell reads as empty.
    expect(col('Amount')).toEqual([120.5, 80, 42.25, null]);
    expect(col('Notes')).toEqual(['First order', null, 'Rush', 'Awaiting stock']);
    expect(col('Contact_2')[0]).toBe('ann@example.com');
    expect(col('Column H')).toEqual([1, 2, 3, 4]);
  });

  it('reads date-times as timestamps and mixed columns as text', () => {
    const data = readSheet(wb, { sheet: 'Visits' });
    expect(data).toMatchObject({ headerRow: 1, rows: 2 });
    expect(data.columns.map((c) => c.type)).toEqual(['VARCHAR', 'TIMESTAMP', 'BIGINT', 'VARCHAR']);
    expect(data.columns[1]!.values).toEqual([Date.UTC(2026, 0, 5, 9, 30), Date.UTC(2026, 0, 6, 14, 0)]);
    expect(data.columns[3]!.values).toEqual(['1', 'two']);
  });

  it('uses a chosen header row and range', () => {
    const data = readSheet(wb, { headerRow: 3, range: 'A3:C5' });
    expect(data).toMatchObject({ headerRow: 3, range: 'A3:C5', rows: 2 });
    expect(data.columns.map((c) => c.name)).toEqual(['Region', 'Order date', 'Amount']);
    expect(data.columns[2]!.type).toBe('DOUBLE');
  });

  it('reads a range from one cell on to the end of the data', () => {
    expect(readSheet(wb, { range: 'B3' })).toMatchObject({ range: 'B3:H7', rows: 4 });
  });

  it('reads every row as data when there is no header row', () => {
    const data = readSheet(wb, { sheet: 'Visits', headerRow: 0 });
    expect(data).toMatchObject({ headerRow: 0, rows: 3 });
    expect(data.columns.map((c) => c.name)).toEqual(['Column A', 'Column B', 'Column C', 'Column D']);
    // The header text now sits in each column, so they all read as text.
    expect(data.columns[0]!.values).toEqual(['Visitor', 'Ann', 'Bob']);
  });

  it('explains what is wrong in plain words', () => {
    expect(() => readSheet(wb, { sheet: 'Nope' })).toThrow('This workbook has no sheet called “Nope”. Choose another sheet.');
    expect(() => readSheet(wb, { sheet: 'Empty' })).toThrow('The sheet “Empty” is empty. Choose another sheet.');
    expect(() => readSheet(wb, { range: 'A1:B' })).toThrow('“A1:B” isn’t a cell range. Write it like A1:F200.');
    expect(() => readSheet(wb, { range: 'z100:z200' })).toThrow('The range Z100:Z200 has no data in the sheet “Sales”, whose data is in A1:H7.');
    expect(() => readSheet(wb, { headerRow: 9 })).toThrow('Row 9 is outside the data read (A1:H7). Choose a header row from 1 to 7.');
  });
});

describe('reading workbooks', () => {
  it('refuses files that are not .xlsx workbooks', () => {
    expect(() => parseWorkbook(new TextEncoder().encode('a,b\n1,2'))).toThrow(ExcelError);
    expect(() => parseWorkbook(new TextEncoder().encode('a,b\n1,2'))).toThrow(/isn’t an Excel workbook/);
    expect(() => parseWorkbook(new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]))).toThrow(/old \.xls format or is password-protected/);
    expect(() => parseWorkbook(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3]))).toThrow(/can’t be read/);
  });

  it('names repeated headers apart, ignoring case as DuckDB does', () => {
    const data = readSheet(parseWorkbook(book([['id', 'ID', 'id', '  '], [1, 2, 3, 4]])));
    expect(data.columns.map((c) => c.name)).toEqual(['id', 'ID_2', 'id_3', 'Column D']);
  });

  it('names a header cell inside a vertical merge after the merged cell', () => {
    const bytes = book([['Name', 'Score'], [null, 'Max'], ['Ann', 3]], (ws) => (ws['!merges'] = [XLSX.utils.decode_range('A1:A2')]));
    const data = readSheet(parseWorkbook(bytes), { headerRow: 2 });
    expect(data.columns.map((c) => c.name)).toEqual(['Name', 'Max']);
  });

  it('drops trailing empty rows and columns from the used range', () => {
    const bytes = book([['a', 'b', null], [1, 2, null], [null, null, null]], (ws) => (ws['!ref'] = 'A1:E9'));
    expect(readSheet(parseWorkbook(bytes))).toMatchObject({ range: 'A1:B2', rows: 1 });
  });

  it('keeps large whole numbers exact only while they are safe integers', () => {
    const data = readSheet(parseWorkbook(book([['n', 'm'], [2 ** 53, 1], [1, 2]])));
    expect(data.columns.map((c) => c.type)).toEqual(['DOUBLE', 'BIGINT']);
  });

  it('reads a header-only sheet as columns with no rows', () => {
    const data = readSheet(parseWorkbook(book([['a', 'b']])));
    expect(data).toMatchObject({ rows: 0 });
    expect(data.columns.map((c) => [c.name, c.type])).toEqual([['a', 'VARCHAR'], ['b', 'VARCHAR']]);
  });

  it('reads dates of 1904-system workbooks', () => {
    // 0 in the 1904 system is 1 January 1904.
    const data = readSheet(parseWorkbook(book([['d'], [{ t: 'n', v: 0, z: 'yyyy-mm-dd' }]], undefined, { date1904: true })));
    expect(data.columns[0]).toMatchObject({ type: 'DATE', values: [day(1904, 1, 1)] });
  });
});

describe('Excel date serials', () => {
  it('convert without the local time zone, around the 1900 leap-year bug', () => {
    expect(serialToMs(1)).toBe(Date.UTC(1900, 0, 1));
    expect(serialToMs(59)).toBe(Date.UTC(1900, 1, 28));
    expect(serialToMs(61)).toBe(Date.UTC(1900, 2, 1));
    expect(serialToMs(25569)).toBe(0);
    expect(serialToMs(46027.5)).toBe(Date.UTC(2026, 0, 5, 12));
    expect(serialToMs(0, true)).toBe(Date.UTC(1904, 0, 1));
  });
});

describe('header row detection', () => {
  it('skips a title row and blank rows', () => {
    expect(guessHeaderRow([1, 0, 6, 6, 5])).toBe(2);
  });
  it('takes a row half as wide as the widest', () => {
    expect(guessHeaderRow([3, 6, 6])).toBe(0);
    expect(guessHeaderRow([2, 6, 6])).toBe(1);
  });
  it('falls back to the first row', () => {
    expect(guessHeaderRow([])).toBe(0);
    expect(guessHeaderRow([1])).toBe(0);
  });
});
