// Writes tests/fixtures/messy/*, the four difficult files Phase 5 (Analyse and fix, epic in GitHub) is built against:
// an SAP list with a header and footer, a text export that went through several hands, a workbook whose rows skew
// half way down, and a report with merged cells. A seeded generator, so the files come out the same each run.
// Run with `node scripts/make-messy-fixtures.mjs` after changing it, and commit the files.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as XLSX from 'xlsx';

const out = fileURLToPath(new URL('../tests/fixtures/messy', import.meta.url));
// The two text files are also Try a sample datasets (src/samples/catalog.ts), shipped with the app.
const samples = fileURLToPath(new URL('../public/samples', import.meta.url));
mkdirSync(out, { recursive: true });
let seed = 2026;
const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const pick = (a) => a[Math.floor(rnd() * a.length)];
const int = (lo, hi) => lo + Math.floor(rnd() * (hi - lo + 1));
const p2 = (n) => String(n).padStart(2, '0');

const first = ['Alice', 'Bob', 'Chloe', 'Dev', 'Ewan', 'Fatima', 'George', 'Hana', 'Isaac', 'Jade', 'Kofi', 'Leila', 'Mateo', 'Nora', 'Omar', 'Priya'];
const last = ['Smith', 'Jones', 'Patel', 'Okafor', 'Nguyen', 'Garcia', 'Brown', 'Kowalski', 'Murphy', 'Ali', 'Evans', 'Chen'];
const cities = ['London', 'Manchester', 'Leeds', 'Bristol', 'Glasgow', 'Cardiff'];
const vendors = ['Acme Supplies Ltd', 'Northwind Traders', 'Müller GmbH', 'Initech', 'Umbrella Logistics', 'Stark Components', 'Wayne Industrial', 'Tyrell Parts'];

// 1. sap-extract.txt: an SAP ALV list from a spool. Banner, separator lines, a pipe table, the header repeated on page
// 2, German numbers (1.234,50 and a trailing minus), dates as 20.03.2026, a total row and an end-of-report footer.
{
  const de = (n) => {
    const [whole, frac] = Math.abs(n).toFixed(2).split('.');
    const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    return `${grouped},${frac}${n < 0 ? '-' : ' '}`;
  };
  const cols = [
    ['Doc. no.', 10, 'l'], ['Vendor', 20, 'l'], ['Doc. date', 10, 'l'], ['Pstng date', 10, 'l'], ['Crcy', 4, 'l'], ['Amount in LC', 16, 'r'], ['Cost ctr', 8, 'l'], ['Text', 24, 'l'],
  ];
  const cell = (v, [, w, align]) => (align === 'r' ? String(v).padStart(w) : String(v).padEnd(w));
  const line = (cells) => `|${cells.map((v, i) => cell(v, cols[i])).join('|')}|`;
  const rule = '-'.repeat(line(cols.map(() => '')).length);
  const banner = (page) => [
    'Vendor line items                                                   Page       ' + page,
    'Company code 1000   Fiscal year 2026   Period 03                    PRD/100',
    'User KMCALEER      Date 20.03.2026   Time 08:14:52',
    '',
    rule,
    line(cols.map((c) => c[0])),
    rule,
  ];
  const rows = [];
  let total = 0;
  for (let i = 0; i < 60; i++) {
    const amount = Math.round((int(20, 9800) + rnd()) * 100) / 100 * (rnd() < 0.15 ? -1 : 1);
    total += amount;
    const d = int(1, 28), m = pick([1, 2, 3]);
    rows.push([String(5100000000 + i * 7), pick(vendors), `${p2(d)}.${p2(m)}.2026`, `${p2(Math.min(28, d + int(0, 3)))}.${p2(m)}.2026`, pick(['EUR', 'EUR', 'EUR', 'GBP']), de(amount), `CC${int(1, 9)}00${int(0, 9)}`, pick(['Invoice', 'Credit memo', 'Freight', 'Q1 maintenance', 'Spares', '', 'Consulting March'])]);
  }
  const page1 = rows.slice(0, 35).map(line), page2 = rows.slice(35).map(line);
  const text = [
    ...banner(1), ...page1, '', '\f',
    ...banner(2), ...page2, rule,
    line(['*', '', '', '', 'EUR', de(Math.round(total * 100) / 100), '', '']),
    rule,
    '',
    `${rows.length} items displayed`,
    'End of report',
    '',
  ].join('\r\n');
  writeFileSync(join(out, 'sap-extract.txt'), text, 'latin1');
  writeFileSync(join(samples, 'sap-extract.txt'), text, 'latin1');
}

// 2. messy.txt: a text export that went through several hands. A UTF-8 BOM, mixed line endings, comment lines,
// semicolons, a second header where two exports were pasted together, blank and ragged rows, non-printing characters,
// smart quotes, mixed case, five ways of writing empty, dates in three formats, amounts as text, phone numbers in
// three shapes, trailing spaces, duplicate rows and a footer.
{
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const header = 'Customer ID;Customer Name;City;Status;Signed up;Balance;Phone;Notes';
  const rows = [];
  for (let i = 0; i < 40; i++) {
    const id = `CU${String(1000 + i)}`;
    const f = pick(first), l = pick(last);
    const name = pick([`${f} ${l}`, `${f} ${l}`, `${f}  ${l}`, `${f} ${l} `, ` ${f} ${l}`, `${f.toUpperCase()} ${l.toUpperCase()}`, `${f.toLowerCase()} ${l.toLowerCase()}`]);
    const city = pick([...cities, pick(cities).toLowerCase(), `${pick(cities)} `, 'Manchestr']);
    const status = pick(['Active', 'active', 'ACTIVE', 'Active', 'Lapsed', 'lapsed', 'N/A', 'n/a', '-', '?', 'NULL']);
    const d = int(1, 28), m = int(0, 11);
    const date = pick([`2025-${p2(m + 1)}-${p2(d)}`, `${p2(d)}/${p2(m + 1)}/2025`, `${d} ${months[m]} 2025`, '']);
    const value = Math.round((int(0, 5000) + rnd()) * 100) / 100;
    const bal = pick([value.toFixed(2), `£${value.toLocaleString('en-GB', { minimumFractionDigits: 2 })}`, `(${value.toFixed(2)})`, `${value.toFixed(2)} `, 'n/a']);
    const digits = String(int(100, 999));
    const phone = pick([`07700 900${digits}`, `+44 7700 900${digits}`, `07700900${digits}`, '']);
    const note = pick(['', '', 'Called back', `Prefers “email”`, 'VIP​', 'Moved\tflat', 'Owes money, chase', 'see ticket #12']);
    rows.push([id, name, city, status, date, bal, phone, note]);
  }
  // Four exact duplicates, a short row, a long row, and the second export's header pasted in the middle.
  for (const i of [4, 12, 25, 33]) rows.splice(i + 3, 0, [...rows[i]]);
  rows[9] = rows[9].slice(0, 6);
  rows[21] = [...rows[21], 'extra'];
  const lines = rows.map((r) => r.join(';'));
  lines.splice(20, 0, header);
  lines.splice(7, 0, '');
  lines.splice(30, 0, '');
  const text = ['﻿# Export from CRM, do not edit', '# Generated 2026-03-20 by crm-export 2.1', header, ...lines, '', 'Rows: 40', ''];
  // Mixed line endings: the first export's lines end in CRLF, the pasted second half in LF.
  const joined = text.map((l, i) => l + (i < 24 ? '\r\n' : '\n')).join('');
  writeFileSync(join(out, 'messy.txt'), joined, 'utf8');
  writeFileSync(join(samples, 'messy.txt'), joined, 'utf8');
}

/** A date cell from a UTC date: an Excel serial with a date format, so no time zone is involved. */
const serial = (y, m, d) => Date.UTC(y, m - 1, d) / 86_400_000 + 25569;
const date = (y, m, d) => ({ t: 'n', v: serial(y, m, d), z: 'yyyy-mm-dd' });
const book = (sheets) => {
  const wb = XLSX.utils.book_new();
  for (const [name, ws] of sheets) XLSX.utils.book_append_sheet(wb, ws, name);
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx', compression: true });
};

// 3. skewed.xlsx: an invoice list where a column was deleted from row 19 down (rows shifted left), and a sheet where
// a cell was inserted for a block of rows in the middle (rows shifted right).
{
  const header = ['Invoice', 'Customer', 'Issued', 'Due', 'Net', 'VAT', 'Gross'];
  const invoices = [];
  for (let i = 0; i < 36; i++) {
    const net = Math.round((int(50, 4000) + rnd()) * 100) / 100, vat = Math.round(net * 20) / 100;
    const m = int(1, 3), d = int(1, 28);
    invoices.push([`INV-${2026000 + i}`, pick(vendors), date(2026, m, d), date(2026, Math.min(m + 1, 12), d), net, vat, Math.round((net + vat) * 100) / 100]);
  }
  // From the 18th data row (sheet row 19) the Customer cell was deleted with "shift cells left".
  const left = invoices.map((r, i) => (i >= 17 ? [r[0], ...r.slice(2), null] : r));
  const deleted = XLSX.utils.aoa_to_sheet([header, ...left]);
  // A block in the middle had a blank cell inserted before Issued with "shift cells right".
  const right = invoices.map((r, i) => (i >= 10 && i < 22 ? [r[0], r[1], null, ...r.slice(2)] : r));
  const inserted = XLSX.utils.aoa_to_sheet([header, ...right]);
  writeFileSync(join(out, 'skewed.xlsx'), book([['Deleted cell', deleted], ['Inserted cell', inserted]]));
}

// 4. merged.xlsx: a regional sales report. A merged title, a two-row header (quarters merged over months), region
// names merged down the rows they cover, a subtotal per region, a grand total, a blank spacer column, free-text notes,
// and a second table of footnotes below the first.
{
  const regions = [['North', ['Leeds', 'Manchester', 'York']], ['South', ['Bristol', 'Brighton', 'Reading', 'Exeter']], ['Scotland', ['Glasgow', 'Edinburgh']], ['Wales', ['Cardiff', 'Swansea']]];
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun'];
  const rows = [
    ['Regional sales report, H1 2026'],
    ['Prepared by Finance, 20 March 2026. Figures in GBP thousands.'],
    [],
    ['Region', 'Store', 'Q1', null, null, 'Q2', null, null, null, 'Notes'],
    [null, null, ...months, null, null],
  ];
  const merges = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 9 } }, { s: { r: 3, c: 2 }, e: { r: 3, c: 4 } }, { s: { r: 3, c: 5 }, e: { r: 3, c: 7 } }, { s: { r: 3, c: 0 }, e: { r: 4, c: 0 } }, { s: { r: 3, c: 1 }, e: { r: 4, c: 1 } }, { s: { r: 3, c: 9 }, e: { r: 4, c: 9 } }];
  const grand = months.map(() => 0);
  for (const [region, stores] of regions) {
    const start = rows.length;
    const sub = months.map(() => 0);
    for (const store of stores) {
      const values = months.map((_, i) => {
        const v = int(80, 900);
        sub[i] += v;
        grand[i] += v;
        return v;
      });
      rows.push([store === stores[0] ? region : null, store, ...values, null, pick(['', '', 'Refit in Feb', 'New manager', 'Closed two days for flooding', 'Includes online orders'])]);
    }
    merges.push({ s: { r: start, c: 0 }, e: { r: start + stores.length - 1, c: 0 } });
    rows.push([null, `${region} total`, ...sub, null, null]);
  }
  rows.push([null, 'Grand total', ...grand, null, null]);
  rows.push([], [], ['Footnotes'], ['Code', 'Meaning'], ['Q1', 'January to March'], ['Q2', 'April to June'], ['GBP thousands', 'Rounded to the nearest thousand']);
  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws['!merges'] = merges;
  writeFileSync(join(out, 'merged.xlsx'), book([['H1 2026', ws]]));
}

console.log(`Wrote the messy fixtures to ${out}`);
