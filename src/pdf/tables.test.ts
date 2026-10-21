import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadPdfPages } from './node';
import { findPdfTables, linesOf } from './tables';
import { NO_TEXT, readPdfPages } from './read';

const fixture = (name: string) => new Uint8Array(readFileSync(join(__dirname, '../../tests/fixtures/pdf', name)));

describe('tables in a PDF’s text', () => {
  it('finds the tables of the statement fixture, lined up in columns with right-aligned amounts under their heading', async () => {
    const tables = findPdfTables(await loadPdfPages(fixture('statement.pdf')));
    expect(tables.map((t) => [t.index, t.label, t.page, t.cells.length])).toEqual([
      [1, 'Transactions (page 1)', 1, 5],
      [2, 'Summary (page 2)', 2, 3],
    ]);
    expect(tables[0]!.cells).toEqual([
      ['Date', 'Description', 'Paid in', 'Paid out'],
      ['2026-10-01', 'Salary October', '2,450.00', ''],
      ['2026-10-03', 'Grocer on the corner', '', '48.20'],
      ['2026-10-10', 'Refund: lamp', '19.99', ''],
      ['2026-10-28', 'Rent', '', '1,100.00'],
    ]);
    expect(tables[1]!.cells).toEqual([
      ['Item', 'Amount'],
      ['Opening balance', '312.40'],
      ['Closing balance', '1,634.19'],
    ]);
  });

  it('joins runs a space apart into one cell, starts a cell at a wide gap, and needs two rows of two cells for a table', () => {
    const run = (text: string, x: number, y: number, size = 10) => ({ text, x, y, width: text.length * size * 0.5, height: size });
    const lines = linesOf([run('Hello', 10, 100), run('world', 38, 100.4), run('far', 120, 100), run('one cell', 10, 80)]);
    expect(lines.map((l) => l.cells.map((c) => c.text))).toEqual([['Hello world', 'far'], ['one cell']]);
    expect(findPdfTables([{ page: 1, runs: [run('a', 10, 100), run('b', 100, 100), run('only one row', 10, 80)] }])).toEqual([]);
    const t = findPdfTables([{ page: 2, runs: [run('A heading that is far too long to be a label for the table underneath it, so the table is numbered', 10, 120, 8), run('a', 10, 100), run('b', 100, 100), run('c', 10, 88), run('d', 100, 88)] }]);
    expect(t).toEqual([{ index: 1, label: 'Table 1 (page 2)', page: 2, cells: [['a', 'b'], ['c', 'd']] }]);
  });

  it('says a scan has no text, and what a file that isn’t a PDF is', async () => {
    await expect(loadPdfPages(fixture('scan.pdf'))).rejects.toThrow(NO_TEXT);
    await expect(loadPdfPages(new Uint8Array([1, 2, 3]))).rejects.toThrow(/isn’t a PDF Puddle can read/);
    const noDoc = { getDocument: () => ({ promise: Promise.reject(new Error('No password given')) }) };
    await expect(readPdfPages(new Uint8Array(), noDoc)).rejects.toThrow(/needs a password/);
  });
});
