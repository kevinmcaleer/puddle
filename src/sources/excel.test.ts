import { src } from '../../tests/helpers/projects';
import { formatBytes, isLargeWorkbook, LARGE_WORKBOOK_BYTES, parseHeaderRow, sheetLabel, sheetOptions, withSheet } from './excel';

describe('Excel source options', () => {
  it('starts a newly chosen sheet afresh: header row and range belong to the old one', () => {
    expect(withSheet({ sheet: 'A', headerRow: 3, range: 'A3:C9' }, 'B')).toEqual({ sheet: 'B' });
    expect(withSheet({}, 'B')).toEqual({ sheet: 'B' });
  });

  it('reads a typed header row: empty detects, 0 is none, anything else must be a row number', () => {
    expect(parseHeaderRow('')).toBe('auto');
    expect(parseHeaderRow('  ')).toBe('auto');
    expect(parseHeaderRow('0')).toBe(0);
    expect(parseHeaderRow(' 3 ')).toBe(3);
    for (const bad of ['-1', '2.5', 'three', '1e3', '1048577']) expect(parseHeaderRow(bad)).toBeUndefined();
  });

  it('passes only the options SheetJS uses', () => {
    expect(sheetOptions({ sheet: 'S', headerRow: 0, range: 'A1:B2', delimiter: ';' })).toEqual({ sheet: 'S', headerRow: 0, range: 'A1:B2' });
  });

  it('labels sheets with their size', () => {
    expect(sheetLabel({ name: 'Sales', rows: 1204, columns: 6 })).toBe('Sales (1,204 rows, 6 columns)');
    expect(sheetLabel({ name: 'One', rows: 1, columns: 1 })).toBe('One (1 row, 1 column)');
    expect(sheetLabel({ name: 'Empty', rows: 0, columns: 0 })).toBe('Empty (empty)');
  });

  it('warns about workbooks over the size limit only', () => {
    const book = (size: number) => src({ id: 'x', format: 'xlsx', file: { originalName: 'b.xlsx', size, lastModified: 0, headHash: 'h' } });
    expect(isLargeWorkbook(book(LARGE_WORKBOOK_BYTES))).toBe(false);
    expect(isLargeWorkbook(book(LARGE_WORKBOOK_BYTES + 1))).toBe(true);
    expect(isLargeWorkbook(src({ id: 'y', format: 'csv', file: { originalName: 'b.csv', size: 1e9, lastModified: 0, headHash: 'h' } }))).toBe(false);
    expect(formatBytes(34 * 1024 * 1024)).toBe('34 MB');
    expect(formatBytes(1500)).toBe('1 KB');
  });
});
