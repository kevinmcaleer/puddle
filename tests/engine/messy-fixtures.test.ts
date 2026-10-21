// The four difficult files in tests/fixtures/messy, written by scripts/make-messy-fixtures.mjs for Phase 5 (Analyse
// and fix): each test states the problems a file has, as the plan describes them, and shows the data is recoverable
// with the read options and steps the fixes will set. The detectors and fixes are built against these.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { compile, sourceFileName } from '../../src/compiler';
import { EngineClient, tableRows } from '../../src/engine/client';
import { guessHeaderRow, listSheets, parseWorkbook, readSheet } from '../../src/excel/read';
import { createNodeBackend } from '../helpers/nodeBackend';
import { flow, src, step } from '../helpers/projects';

const dir = join(__dirname, '../fixtures/messy');
const bytes = (name: string) => new Uint8Array(readFileSync(join(dir, name)));

let engine: EngineClient;
beforeAll(async () => {
  engine = new EngineClient(await createNodeBackend());
});
afterAll(() => engine.close());

const rows = async (sql: string) => tableRows((await engine.query(sql)).table);
const one = async (sql: string) => Number(Object.values((await rows(sql))[0]!)[0]);

describe('sap-extract.txt: an SAP list with a banner, a repeated header, a total row and a footer', () => {
  const text = readFileSync(join(dir, 'sap-extract.txt'), 'latin1');
  const lines = text.split('\r\n');
  const dataLines = lines.filter((l) => l.startsWith('|') && !l.startsWith('|Doc. no.') && !l.startsWith('|*'));

  it('has a three-line banner and a separator line before the header, and the header again on page two', () => {
    expect(lines[0]).toMatch(/^Vendor line items\s+Page\s+1$/);
    expect(lines[4]).toMatch(/^-+$/);
    expect(lines[5]).toMatch(/^\|Doc\. no\.\s+\|Vendor/);
    expect(lines.filter((l) => l.startsWith('|Doc. no.'))).toHaveLength(2);
    expect(lines.filter((l) => /^Vendor line items\s+Page/.test(l))).toHaveLength(2);
    expect(text).toContain('\f');
  });

  it('ends with a total row and an end-of-report footer, and has 60 data rows between', () => {
    expect(dataLines).toHaveLength(60);
    expect(lines.find((l) => l.startsWith('|*'))).toMatch(/\|\s*192\.474,66 \|/);
    expect(lines.slice(-3)).toEqual(['60 items displayed', 'End of report', '']);
  });

  it('writes numbers the German way with a trailing minus and dates as dd.mm.yyyy', () => {
    expect(dataLines.some((l) => /\|\s+\d{1,3}(\.\d{3})+,\d{2} \|/.test(l))).toBe(true);
    expect(dataLines.some((l) => /,\d{2}-\|/.test(l))).toBe(true);
    expect(dataLines.every((l) => /\|\d{2}\.\d{2}\.2026\|\d{2}\.\d{2}\.2026\|/.test(l))).toBe(true);
  });

  it('reads as a pipe-delimited table once the lines around it are dropped, and the amounts sum to the total row', async () => {
    const csv = [lines[5]!, ...dataLines].join('\n') + '\n';
    const source = src({ id: 'sap', format: 'csv', parseOptions: { delimiter: '|' } });
    await engine.registerBuffer(sourceFileName(source), new TextEncoder().encode(csv));
    const project = flow({
      sources: [source],
      nodes: [
        { id: 'in', type: 'source', sourceId: source.id },
        { id: 'fix', type: 'transform', steps: [step('t', 'trimWhitespace', { columns: ['Vendor', 'Crcy', 'Amount in LC', 'Cost ctr', 'Text'] })] },
      ],
      wires: [['in', 'fix']],
    });
    const sql = compile(project, { nodeId: 'fix' }).sql;
    // The leading and trailing pipes make an empty first and last column: a fix drops them.
    const columns = (await engine.describe(sql)).map((c) => c.name);
    expect(columns).toHaveLength(10);
    expect(columns.slice(1, 9)).toEqual(['Doc. no.', 'Vendor', 'Doc. date', 'Pstng date', 'Crcy', 'Amount in LC', 'Cost ctr', 'Text']);
    expect(await one(`SELECT count(*) FROM (${sql})`)).toBe(60);
    const german = `CAST(replace(replace(regexp_replace("Amount in LC", '^(.*)-$', '-\\1'), '.', ''), ',', '.') AS DOUBLE)`;
    expect(await one(`SELECT round(sum(${german}), 2) FROM (${sql})`)).toBe(192474.66);
    expect(await one(`SELECT count(*) FROM (${sql}) WHERE ${german} < 0`)).toBeGreaterThan(0);
    // DuckDB's sniffer reads dd.mm.yyyy as dates on its own.
    expect((await engine.describe(sql)).find((c) => c.name === 'Doc. date')?.type).toBe('DATE');
    expect(await one(`SELECT count(*) FROM (${sql}) WHERE "Doc. date" IS NULL`)).toBe(0);
  });
});

describe('messy.txt: a text export that went through several hands', () => {
  const raw = readFileSync(join(dir, 'messy.txt'));
  const text = raw.toString('utf8');
  const lines = text.split(/\r?\n/);
  const header = 'Customer ID;Customer Name;City;Status;Signed up;Balance;Phone;Notes';

  it('starts with a UTF-8 BOM and two comment lines, mixes CRLF and LF line endings, and ends with a row count', () => {
    expect([raw[0], raw[1], raw[2]]).toEqual([0xef, 0xbb, 0xbf]);
    expect(lines[0]).toBe('﻿# Export from CRM, do not edit');
    expect(lines[1]).toMatch(/^# Generated /);
    expect(lines[2]).toBe(header);
    expect(text.split('\r\n').length - 1).toBe(24);
    expect(text.split('\n').length - 1).toBeGreaterThan(24 + 20);
    expect(lines.slice(-4)).toEqual(['', 'Rows: 40', '', '']);
  });

  it('has the header pasted in again half way down, two blank lines, a row two cells short and a row one cell long', () => {
    const body = lines.slice(3, -4);
    expect(body.filter((l) => l === header)).toHaveLength(1);
    expect(body.filter((l) => l === '')).toHaveLength(2);
    const widths = body.filter((l) => l && l !== header).map((l) => l.split(';').length);
    expect(widths.filter((w) => w === 6)).toHaveLength(1);
    expect(widths.filter((w) => w === 9)).toHaveLength(1);
    expect(widths.filter((w) => w === 8)).toHaveLength(42);
  });

  it('carries non-printing characters and smart quotes inside values', () => {
    expect(text).toContain('​');
    expect(text).toContain(' ');
    expect(text).toContain('“');
    expect(text).toMatch(/Moved\tflat/);
  });

  it('reads as semicolon-separated text with the comments skipped, and shows every column issue the plan lists', async () => {
    const source = src({ id: 'crm', format: 'csv', parseOptions: { delimiter: ';' } });
    // Skipped comment lines stand in for the "Skip rows at the top" read option; the BOM, blank lines and ragged
    // rows are left for DuckDB, which pads short rows and reads the long one as its first eight cells.
    await engine.registerBuffer(sourceFileName(source), new TextEncoder().encode(lines.slice(2).join('\n')));
    const project = flow({ sources: [source], nodes: [{ id: 'in', type: 'source', sourceId: source.id }] });
    const sql = compile(project, { nodeId: 'in' }).sql;
    const columns = await engine.describe(sql);
    // Every column reads as text: nothing in the file is typed yet.
    expect(columns.map((c) => c.type)).toEqual(columns.map(() => 'VARCHAR'));
    const q = (where: string) => one(`SELECT count(*) FROM (${sql}) WHERE ${where}`);
    expect(await q(`"Customer ID" = 'Customer ID'`)).toBe(1);
    expect(await q(`"Customer Name" <> trim("Customer Name")`)).toBeGreaterThan(0);
    expect(await q(`"Customer Name" LIKE '%  %'`)).toBeGreaterThan(0);
    expect(await q(`"Customer Name" = upper("Customer Name")`)).toBeGreaterThan(0);
    expect(await q(`"Customer Name" = lower("Customer Name")`)).toBeGreaterThan(0);
    expect(await q(`lower(Status) IN ('n/a', '-', '?', 'null')`)).toBeGreaterThan(0);
    expect(await one(`SELECT count(DISTINCT lower(trim(Status))) FROM (${sql}) WHERE lower(Status) IN ('active', 'lapsed')`)).toBe(2);
    expect(await one(`SELECT count(DISTINCT Status) FROM (${sql}) WHERE lower(Status) IN ('active', 'lapsed')`)).toBeGreaterThan(2);
    expect(await q(`City = 'Manchestr' OR City LIKE '%' || chr(160)`)).toBeGreaterThan(0);
    for (const re of ['^\\d{4}-\\d{2}-\\d{2}$', '^\\d{2}/\\d{2}/\\d{4}$', '^\\d{1,2} [A-Z][a-z]{2} \\d{4}$'])
      expect(await q(`regexp_matches("Signed up", '${re}')`)).toBeGreaterThan(0);
    expect(await q(`regexp_matches(Balance, '^[£(]')`)).toBeGreaterThan(0);
    expect(await q(`Balance LIKE '% '`)).toBeGreaterThan(0);
    expect(await one(`SELECT count(DISTINCT regexp_replace(Phone, '[0-9]', '9', 'g')) FROM (${sql}) WHERE Phone NOT IN ('', 'Phone')`)).toBe(3);
    expect(await one(`SELECT count(*) - count(DISTINCT ("Customer ID", "Customer Name", City, Status, "Signed up", Balance, Phone, Notes)) FROM (${sql})`)).toBe(4);
    expect(await q(`regexp_matches(Notes, chr(8203) || '|' || chr(9) || '|' || chr(8220))`)).toBeGreaterThan(0);
  });
});

describe('skewed.xlsx: invoice rows shifted by a deleted or an inserted cell', () => {
  const wb = parseWorkbook(bytes('skewed.xlsx'));
  const header = ['Invoice', 'Customer', 'Issued', 'Due', 'Net', 'VAT', 'Gross'];

  it('has two sheets of 36 invoices under the same header; the inserted cells push a nameless eighth column out', () => {
    expect(listSheets(wb)).toEqual([
      { name: 'Deleted cell', rows: 37, columns: 7 },
      { name: 'Inserted cell', rows: 37, columns: 8 },
    ]);
    expect(readSheet(wb, { sheet: 'Deleted cell' }).columns.map((c) => c.name)).toEqual(header);
    expect(readSheet(wb, { sheet: 'Inserted cell' }).columns.map((c) => c.name)).toEqual([...header, 'Column H']);
  });

  it('from the 18th row of the first sheet the cells sit one column to the left, so Customer holds dates and Gross is empty', () => {
    const data = readSheet(wb, { sheet: 'Deleted cell' });
    const col = (name: string) => data.columns.find((c) => c.name === name)!.values;
    const vendors = ['Acme Supplies Ltd', 'Northwind Traders', 'Müller GmbH', 'Initech', 'Umbrella Logistics', 'Stark Components', 'Wayne Industrial', 'Tyrell Parts'];
    const vendor = (v: unknown) => typeof v === 'string' && vendors.includes(v);
    expect(col('Customer').slice(0, 17).every(vendor)).toBe(true);
    expect(col('Customer').slice(17).some(vendor)).toBe(false);
    expect(col('Customer').slice(17).every((v) => v != null)).toBe(true);
    expect(col('Gross').slice(0, 17).every((v) => typeof v === 'number')).toBe(true);
    expect(col('Gross').slice(17).every((v) => v == null)).toBe(true);
    // The 18th row is where the pattern breaks: the detector must find row 19 of the sheet.
    expect(col('Customer').findIndex((v) => !vendor(v))).toBe(17);
  });

  it('in the second sheet a block of twelve rows in the middle sits one column to the right, with Issued empty', () => {
    const data = readSheet(wb, { sheet: 'Inserted cell' });
    const col = (name: string) => data.columns.find((c) => c.name === name)!.values;
    const shifted = col('Issued').map((v) => v == null);
    expect(shifted.filter(Boolean)).toHaveLength(12);
    expect(shifted.indexOf(true)).toBe(10);
    expect(shifted.lastIndexOf(true)).toBe(21);
    // In those rows every value sits one column right: Gross holds the VAT and the eighth column holds the gross.
    expect(col('Column H').map((v) => v != null)).toEqual(shifted);
    expect(col('Gross').slice(10, 22).every((v) => typeof v === 'number')).toBe(true);
  });
});

describe('merged.xlsx: a report with a merged title, a two-row header, regions merged down, totals and footnotes', () => {
  const wb = parseWorkbook(bytes('merged.xlsx'));
  const ws = wb.Sheets['H1 2026']!;
  const merges = ws['!merges']!;

  it('merges the title across the top, the quarters over their months, the row headers over two rows, and each region down its stores', () => {
    expect(merges).toHaveLength(10);
    expect(merges[0]).toEqual({ s: { r: 0, c: 0 }, e: { r: 0, c: 9 } });
    expect(merges.filter((m) => m.s.r === 3 && m.e.r === 3)).toHaveLength(2);
    expect(merges.filter((m) => m.s.r === 3 && m.e.r === 4)).toHaveLength(3);
    const regions = merges.filter((m) => m.s.r > 4 && m.s.c === 0);
    expect(regions.map((m) => m.e.r - m.s.r + 1)).toEqual([3, 4, 2, 2]);
  });

  it('reads the table below the title with its two header rows joined, the regions filled down their stores, and the spacer column empty', () => {
    const data = readSheet(wb);
    expect(data).toMatchObject({ range: 'A4:J21', headerRow: 4, headerRows: 2, merges: 4 });
    expect(data.columns.map((c) => c.name)).toEqual(['Region', 'Store', 'Q1 Jan', 'Q1 Feb', 'Q1 Mar', 'Q2 Apr', 'Q2 May', 'Q2 Jun', 'Column I', 'Notes']);
    expect(data.columns[2]!.values[0]).toBe(263);
    const col = (name: string) => data.columns.find((c) => c.name === name)!.values;
    const region = col('Region'), store = col('Store');
    expect(region.slice(0, 4)).toEqual(['North', 'North', 'North', null]);
    expect(region.filter((v) => v != null)).toHaveLength(11);
    // The subtotal and grand total rows stay inside the data, for the shape detector to list.
    expect(store.filter((v) => typeof v === 'string' && v.endsWith(' total'))).toEqual(['North total', 'South total', 'Scotland total', 'Wales total', 'Grand total']);
    expect(col('Column I').every((v) => v == null)).toBe(true);
    expect(col('Notes').some((v) => typeof v === 'string' && v.length > 5)).toBe(true);
    expect(guessHeaderRow([1, 1, 0, 6, 6, 8])).toBe(3);
  });

  it('lists the footnotes as a table of their own, read with its own header', () => {
    const data = readSheet(wb);
    expect(data.tables.map((t) => t.range)).toEqual(['A4:J21', 'A24:B28']);
    const notes = readSheet(wb, { range: 'A24:B28' });
    expect(notes.columns.map((c) => c.name)).toEqual(['Code', 'Meaning']);
    expect(notes.columns[0]!.values).toEqual(['Q1', 'Q2', 'GBP thousands']);
  });
});
