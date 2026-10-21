// Writes tests/fixtures/sales.xlsx, the Excel source fixture: several sheets, a title row above the header,
// merged and empty header cells, dates, date-times, booleans, an error cell and a mixed column. The same workbook
// is then written in every other spreadsheet format Puddle reads, under tests/fixtures/formats/, so the tests can
// compare what each format gives with the .xlsx; formats that hold one sheet get the Sales sheet, and the dBase
// file (a flat table with fixed field types) gets the data rows alone.
// Run with `node scripts/make-excel-fixtures.mjs` after changing it, and commit the files.
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as XLSX from 'xlsx';
import XLSX_ZAHL_PAYLOAD from 'xlsx/dist/xlsx.zahl.mjs';

/** A date cell from a UTC date: an Excel serial with a date format, so no time zone is involved. */
const serial = (y, m, d, h = 0, min = 0) => Date.UTC(y, m - 1, d, h, min) / 86_400_000 + 25569;
const date = (y, m, d) => ({ t: 'n', v: serial(y, m, d), z: 'yyyy-mm-dd' });
const dateTime = (y, m, d, h, min) => ({ t: 'n', v: serial(y, m, d, h, min), z: 'yyyy-mm-dd hh:mm' });
const na = { t: 'e', v: 0x2a, w: '#N/A' };

const sales = XLSX.utils.aoa_to_sheet([
  ['Sales report 2026'],
  [],
  ['Region', 'Order date', 'Amount', 'Paid', 'Notes', 'Contact', null, null],
  ['North', date(2026, 1, 5), 120.5, true, 'First order', 'Ann', 'ann@example.com', 1],
  ['South', date(2026, 2, 10), 80, false, null, 'Bob', 'bob@example.com', 2],
  ['East', date(2026, 3, 15), 42.25, true, 'Rush', 'Cy', 'cy@example.com', 3],
  ['West', date(2026, 3, 31), na, false, 'Awaiting stock', 'Di', 'di@example.com', 4],
]);
sales['!merges'] = [XLSX.utils.decode_range('A1:H1'), XLSX.utils.decode_range('F3:G3')];

const visits = XLSX.utils.aoa_to_sheet([
  ['Visitor', 'Arrived', 'Count', 'Mixed'],
  ['Ann', dateTime(2026, 1, 5, 9, 30), 3, 1],
  ['Bob', dateTime(2026, 1, 6, 14, 0), 5, 'two'],
]);

const wb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb, sales, 'Sales');
XLSX.utils.book_append_sheet(wb, visits, 'Visits');
XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([]), 'Empty');

const out = fileURLToPath(new URL('../tests/fixtures/sales.xlsx', import.meta.url));
writeFileSync(out, XLSX.write(wb, { type: 'buffer', bookType: 'xlsx', compression: true }));
console.log(`Wrote ${out}`);

const formats = fileURLToPath(new URL('../tests/fixtures/formats/', import.meta.url));
mkdirSync(formats, { recursive: true });
const write = (file, bookType, book = wb, extra = {}) => {
  writeFileSync(formats + file, XLSX.write(book, { type: 'buffer', bookType, compression: true, ...extra }));
  console.log(`Wrote ${formats}${file}`);
};
// The whole workbook, where the format holds several sheets.
write('sales.xls', 'xls');
write('sales-biff5.xls', 'biff5');
write('sales.xlsb', 'xlsb');
write('sales.xlsm', 'xlsm');
write('sales.ods', 'ods');
write('sales.fods', 'fods');
// Numbers can't hold an empty sheet: the two with data. Its dates are moments, not serials with a format, so the
// date cells are written as dates (Numbers counts from 2001; SheetJS reads them back on the 1904 system).
const asDate = (y, m, d, h = 0, min = 0) => ({ t: 'd', v: new Date(Date.UTC(y, m - 1, d, h, min)), z: 'yyyy-mm-dd' });
const salesDated = XLSX.utils.aoa_to_sheet([
  ['Sales report 2026'],
  [],
  ['Region', 'Order date', 'Amount', 'Paid', 'Notes', 'Contact', null, null],
  ['North', asDate(2026, 1, 5), 120.5, true, 'First order', 'Ann', 'ann@example.com', 1],
  ['South', asDate(2026, 2, 10), 80, false, null, 'Bob', 'bob@example.com', 2],
  ['East', asDate(2026, 3, 15), 42.25, true, 'Rush', 'Cy', 'cy@example.com', 3],
  ['West', asDate(2026, 3, 31), na, false, 'Awaiting stock', 'Di', 'di@example.com', 4],
]);
salesDated['!merges'] = sales['!merges'];
const visitsDated = XLSX.utils.aoa_to_sheet([
  ['Visitor', 'Arrived', 'Count', 'Mixed'],
  ['Ann', asDate(2026, 1, 5, 9, 30), 3, 1],
  ['Bob', asDate(2026, 1, 6, 14, 0), 5, 'two'],
]);
const two = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(two, salesDated, 'Sales');
XLSX.utils.book_append_sheet(two, visitsDated, 'Visits');
write('sales.numbers', 'numbers', two, { numbers: XLSX_ZAHL_PAYLOAD });
// One sheet: the Sales sheet alone.
const one = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(one, sales, 'Sales');
write('sales.dif', 'dif', one);
write('sales.slk', 'sylk', one);
write('sales.wk1', 'wk1', one);
// dBase: a flat table, each field one type (character, numeric, date, logical), so the data rows without the title.
const flat = XLSX.utils.aoa_to_sheet([
  ['Region', 'Order date', 'Amount', 'Paid', 'Notes'],
  ['North', new Date(Date.UTC(2026, 0, 5)), 120.5, true, 'First order'],
  ['South', new Date(Date.UTC(2026, 1, 10)), 80, false, null],
  ['East', new Date(Date.UTC(2026, 2, 15)), 42.25, true, 'Rush'],
  ['West', new Date(Date.UTC(2026, 2, 31)), null, false, 'Awaiting stock'],
], { cellDates: true });
const dbf = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(dbf, flat, 'Sales');
write('sales.dbf', 'dbf', dbf);
