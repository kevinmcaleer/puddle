import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tableFromIPC, tableToIPC } from 'apache-arrow';
import * as read from './read';
import { sheetTable } from './arrow';
import { ExcelService } from './service';
import { transferables } from './transfer';
import { ExcelError } from './types';

const file = () => new Blob([readFileSync(join(__dirname, '../../tests/fixtures/sales.xlsx'))]);

describe('the Excel worker service', () => {
  it('reads a sheet into an Arrow stream with the sheet’s columns and types', async () => {
    const r = await new ExcelService().run('read', { book: 'b', file: file(), options: { sheet: 'Visits' } });
    expect(r).toMatchObject({ sheet: 'Visits', headerRow: 1, range: 'A1:D3', rows: 2 });
    expect(r.sheets.map((s) => s.name)).toEqual(['Sales', 'Visits', 'Empty']);
    const table = tableFromIPC(r.ipc);
    expect(table.numRows).toBe(2);
    expect(table.schema.fields.map((f) => `${f.name} ${String(f.type)}`)).toEqual(['Visitor Utf8', 'Arrived Timestamp<MICROSECOND>', 'Count Int64', 'Mixed Utf8']);
    expect(transferables(r)).toEqual([r.ipc.buffer]);
  });

  it('parses each workbook once and keeps only the latest two', async () => {
    const parse = vi.spyOn(read, 'parseWorkbook');
    const service = new ExcelService();
    await service.run('read', { book: 'a', file: file(), options: {} });
    await service.run('read', { book: 'a', file: file(), options: { sheet: 'Visits' } });
    expect(parse).toHaveBeenCalledTimes(1);
    await service.run('read', { book: 'b', file: file(), options: {} });
    await service.run('read', { book: 'c', file: file(), options: {} });
    await service.run('read', { book: 'a', file: file(), options: {} });
    expect(parse).toHaveBeenCalledTimes(4);
    await service.run('forget', { book: 'a' });
    await service.run('read', { book: 'a', file: file(), options: {} });
    expect(parse).toHaveBeenCalledTimes(5);
    parse.mockRestore();
  });

  it('turns unexpected failures into plain ExcelErrors', async () => {
    const service = new ExcelService();
    await expect(service.run('read', { book: 'x', file: new Blob(['not a workbook']), options: {} })).rejects.toThrow(ExcelError);
    const boom = vi.spyOn(read, 'readSheet').mockImplementation(() => {
      throw new TypeError('boom');
    });
    await expect(service.run('read', { book: 'y', file: file(), options: {} })).rejects.toThrow('This workbook can’t be read (boom).');
    boom.mockRestore();
  });

  it('writes workbooks, and says plainly when it can’t', async () => {
    const service = new ExcelService();
    const ipc = () => tableToIPC(sheetTable([{ name: 'a', type: 'BIGINT', values: [1, 2] }]), 'stream');
    const { data } = await service.run('write', { ipc: ipc(), options: { sheetName: 'S', header: true, freezeHeader: false } });
    expect(transferables({ data })).toEqual([data.buffer]);
    expect(read.readSheet(read.parseWorkbook(data))).toMatchObject({ rows: 2 });
    await expect(service.run('write', { ipc: ipc(), options: { sheetName: '', header: true, freezeHeader: false } })).rejects.toThrow('Give the sheet a name.');
    await expect(service.run('write', { ipc: new Uint8Array([1, 2, 3]), options: { sheetName: 'S', header: true, freezeHeader: false } })).rejects.toThrow(/^The workbook couldn’t be written \(/);
  });
});

describe('sheet columns as Arrow', () => {
  it('keeps nulls and types, including for a sheet with a header and no rows', () => {
    const t = sheetTable([
      { name: 'd', type: 'DATE', values: [20458, null] },
      { name: 't', type: 'TIMESTAMP', values: [null, Date.UTC(2026, 0, 5, 9, 30)] },
      { name: 'n', type: 'BIGINT', values: [1, null] },
    ]);
    // Arrow JS hands timestamps back in milliseconds, whatever their unit.
    expect(t.toArray().map((r) => r.toJSON())).toEqual([
      { d: Date.UTC(2026, 0, 5), t: null, n: 1n },
      { d: null, t: Date.UTC(2026, 0, 5, 9, 30), n: null },
    ]);
    const empty = sheetTable([{ name: 'a', type: 'VARCHAR', values: [] }]);
    expect(empty.numRows).toBe(0);
    expect(empty.schema.fields.map((f) => f.name)).toEqual(['a']);
  });
});
