import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { isPipeRow, pipeCells, readPipes } from './pipes';

const sap = () => readFileSync(join(__dirname, '../../tests/fixtures/messy/sap-extract.txt'), 'latin1');

describe('reading a pipe table', () => {
  it('keeps only the rows between pipes, drops the edge columns and trims every cell', () => {
    const table = readPipes('Title\n|a | b|\n|1 |  2|\n|3|4|\n\nfooter\n');
    expect(table.columns).toEqual(['a', 'b']);
    expect(table.rows).toEqual([['1', '2'], ['3', '4']]);
    expect(table.dropped).toBe(2);
  });

  it('drops a Markdown alignment row, and the header printed again on a later page', () => {
    const table = readPipes('| id | name |\n|---:|:-----|\n| 1 | Ada |\n| id | name |\n| 2 | Bob |\n');
    expect(table.columns).toEqual(['id', 'name']);
    expect(table.rows).toEqual([['1', 'Ada'], ['2', 'Bob']]);
    expect(table.dropped).toBe(2);
  });

  it('reads every row as data without a header, and pads a short row', () => {
    const table = readPipes('|1|2|\n|3|\n', { header: false });
    expect(table.columns).toEqual(['column0', 'column1']);
    expect(table.rows).toEqual([['1', '2'], ['3', '']]);
  });

  it('names a row by its pipes at both ends, and splits on them', () => {
    expect(isPipeRow('  |a|b|  ')).toBe(true);
    expect(isPipeRow('a|b')).toBe(false);
    expect(isPipeRow('---')).toBe(false);
    expect(pipeCells('| a |  b |')).toEqual(['a', 'b']);
  });

  it('reads the SAP extract as 61 rows of eight named columns: the line items and the total row, the banners, rules and page header gone', () => {
    const table = readPipes(sap());
    expect(table.columns).toEqual(['Doc. no.', 'Vendor', 'Doc. date', 'Pstng date', 'Crcy', 'Amount in LC', 'Cost ctr', 'Text']);
    expect(table.rows).toHaveLength(61);
    expect(table.rows[0]).toEqual(['5100000000', 'Wayne Industrial', '02.02.2026', '03.02.2026', 'EUR', '891,36', 'CC3009', 'Invoice']);
    expect(table.rows[60]![0]).toBe('*');
    expect(table.rows[60]![5]).toBe('192.474,66');
    expect(table.rows.some((r) => r[1] === 'Müller GmbH')).toBe(true);
  });
});
