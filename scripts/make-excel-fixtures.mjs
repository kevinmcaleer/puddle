// Writes tests/fixtures/sales.xlsx, the Excel source fixture: several sheets, a title row above the header,
// merged and empty header cells, dates, date-times, booleans, an error cell and a mixed column.
// Run with `node scripts/make-excel-fixtures.mjs` after changing it, and commit the workbook.
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as XLSX from 'xlsx';

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
