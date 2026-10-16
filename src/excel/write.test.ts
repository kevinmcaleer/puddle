import { Bool, DateDay, Int32, Int64, makeVector, Table, tableToIPC, TimestampMicrosecond, Utf8, vectorFromArray } from 'apache-arrow';
import * as XLSX from 'xlsx';
import { sheetTable } from './arrow';
import { SHEET_ROWS } from './limits';
import { parseWorkbook, readSheet } from './read';
import { ExcelError } from './types';
import { msToSerial, writeWorkbook } from './write';

const day = (y: number, m: number, d: number) => Date.UTC(y, m - 1, d) / 86_400_000;

/** The rows the fixture-like output has: one column of each type Excel keeps, with gaps. */
const ipc = () =>
  tableToIPC(
    sheetTable([
      { name: 'id', type: 'BIGINT', values: [1, 2, 3] },
      { name: 'name', type: 'VARCHAR', values: ['Ann', null, 'Cy'] },
      { name: 'amount', type: 'DOUBLE', values: [120.5, 80, null] },
      { name: 'paid', type: 'BOOLEAN', values: [true, false, null] },
      { name: 'ordered', type: 'DATE', values: [day(2026, 1, 5), null, day(1999, 12, 31)] },
      { name: 'arrived', type: 'TIMESTAMP', values: [Date.UTC(2026, 0, 5, 9, 30), Date.UTC(2026, 0, 6, 14, 0, 5), null] },
    ]),
    'stream',
  );

const options = { sheetName: 'Orders', header: true, freezeHeader: true };
const sheetXml = (book: Uint8Array) => new TextDecoder().decode((XLSX.CFB.find(XLSX.CFB.read(book, { type: 'array' }), '/xl/worksheets/sheet1.xml') as { content: Uint8Array }).content);

describe('writing workbooks', () => {
  it('reads back with the same rows, columns and types', () => {
    const wb = parseWorkbook(writeWorkbook(ipc(), options));
    expect(wb.SheetNames).toEqual(['Orders']);
    const data = readSheet(wb);
    expect(data).toMatchObject({ headerRow: 1, rows: 3 });
    expect(data.columns.map((c) => [c.name, c.type])).toEqual([
      ['id', 'BIGINT'],
      ['name', 'VARCHAR'],
      ['amount', 'DOUBLE'],
      ['paid', 'BOOLEAN'],
      ['ordered', 'DATE'],
      ['arrived', 'TIMESTAMP'],
    ]);
    expect(data.columns.map((c) => c.values)).toEqual([
      [1, 2, 3],
      ['Ann', null, 'Cy'],
      [120.5, 80, null],
      [true, false, null],
      [day(2026, 1, 5), null, day(1999, 12, 31)],
      [Date.UTC(2026, 0, 5, 9, 30), Date.UTC(2026, 0, 6, 14, 0, 5), null],
    ]);
  });

  it('writes dates as Excel serials with date formats, never through the local time zone', () => {
    const ws = XLSX.read(writeWorkbook(ipc(), options), { type: 'array', cellNF: true }).Sheets.Orders!;
    expect(ws.E2).toMatchObject({ t: 'n', v: 46027, z: 'yyyy-mm-dd' });
    expect(ws.F2).toMatchObject({ t: 'n', z: 'yyyy-mm-dd hh:mm:ss' });
    expect(msToSerial(Date.UTC(2026, 0, 5, 12))).toBe(46027.5);
  });

  it('freezes the header row only when asked and there is one', () => {
    expect(sheetXml(writeWorkbook(ipc(), options))).toContain('<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>');
    expect(sheetXml(writeWorkbook(ipc(), { ...options, freezeHeader: false }))).not.toContain('<pane');
    expect(sheetXml(writeWorkbook(ipc(), { ...options, header: false }))).not.toContain('<pane');
  });

  it('leaves the header row out when asked', () => {
    const data = readSheet(parseWorkbook(writeWorkbook(ipc(), { ...options, header: false })), { headerRow: 0 });
    expect(data.rows).toBe(3);
    expect(data.columns[1]!.values).toEqual(['Ann', null, 'Cy']);
  });

  it('writes integers past 2^53 as text, so no digits are lost', () => {
    const t = new Table({ big: vectorFromArray([2n ** 60n, 5n], new Int64()), small: vectorFromArray([1, 2], new Int32()) });
    const ws = XLSX.read(writeWorkbook(tableToIPC(t, 'stream'), options), { type: 'array' }).Sheets.Orders!;
    expect(ws.A2).toMatchObject({ t: 's', v: String(2n ** 60n) });
    expect(ws.A3).toMatchObject({ t: 'n', v: 5 });
    expect(ws.B2).toMatchObject({ t: 'n', v: 1 });
  });

  it('writes a header-only sheet for an output with no rows', () => {
    const t = new Table({ a: vectorFromArray([] as string[], new Utf8()), b: vectorFromArray([] as boolean[], new Bool()) });
    const data = readSheet(parseWorkbook(writeWorkbook(tableToIPC(t, 'stream'), options)));
    expect(data.rows).toBe(0);
    expect(data.columns.map((c) => c.name)).toEqual(['a', 'b']);
  });

  it('refuses more rows than a sheet holds instead of cutting them off', () => {
    const rows = (n: number) => tableToIPC(new Table({ n: makeVector(new Float64Array(n)) }), 'stream');
    expect(() => writeWorkbook(rows(SHEET_ROWS), options)).toThrow(ExcelError);
    expect(() => writeWorkbook(rows(SHEET_ROWS), options)).toThrow('This output has 1,048,576 rows; an Excel sheet holds at most 1,048,575 below its header.');
  });

  it('refuses a sheet name Excel would reject', () => {
    expect(() => writeWorkbook(ipc(), { ...options, sheetName: 'a/b' })).toThrow(/can’t contain/);
  });

  it('keeps types for dates and timestamps built by DuckDB-style Arrow columns', () => {
    const t = new Table({
      d: vectorFromArray([new Date(Date.UTC(2026, 0, 5))], new DateDay()),
      ts: vectorFromArray([new Date(Date.UTC(2026, 0, 5, 9, 30))], new TimestampMicrosecond()),
    });
    const data = readSheet(parseWorkbook(writeWorkbook(tableToIPC(t, 'stream'), options)));
    expect(data.columns.map((c) => c.type)).toEqual(['DATE', 'TIMESTAMP']);
    expect(data.columns[1]!.values).toEqual([Date.UTC(2026, 0, 5, 9, 30)]);
  });
});
