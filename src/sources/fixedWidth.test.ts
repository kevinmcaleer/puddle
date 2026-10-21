import { cutLine, detectBoundaries, nameColumns, readFixedWidth, withBoundary } from './fixedWidth';

const LINES = [
  'CUSTNO NAME                CITY        BALANCE  SINCE',
  '000123 Ada Lovelace        London      1,234.50 2024-01-31',
  '000124 Grace Hopper        New York       99.00 2024-02-29',
  '000125 Edsger Dijkstra     Rotterdam     -12.00 2024-03-01',
  '000126 Alan Turing         Manchester   7.50    2024-12-25',
];

describe('fixed-width boundaries', () => {
  it('finds the offset after each column of spaces that runs down the table', () => {
    expect(detectBoundaries(LINES)).toEqual([7, 27, 39, 48]);
  });

  it('leaves the left margin out, and the banner and footer lines that are much shorter than the table', () => {
    expect(detectBoundaries(['  A   B', '  1   2', '  3   4'])).toEqual([6]);
    expect(detectBoundaries(['Report', '', ...LINES, 'End'])).toEqual([7, 27, 39, 48]);
  });

  it('allows a value to spill into a gap on the odd line, but not a column of text that lines up by chance', () => {
    const lines = Array.from({ length: 100 }, (_, i) => `${String(i).padStart(3, '0')} ${i === 7 ? 'a very long value' : 'short'}     x`);
    expect(detectBoundaries(lines)).toEqual([4, 14]);
  });

  it('finds nothing in fewer than two lines of the table', () => {
    expect(detectBoundaries([])).toEqual([]);
    expect(detectBoundaries(['A   B'])).toEqual([]);
  });
});

describe('reading fixed-width text', () => {
  it('cuts each line at the boundaries, trims the cells, and names the columns from the first line', () => {
    const table = readFixedWidth(LINES.join('\n'));
    expect(table.boundaries).toEqual([7, 27, 39, 48]);
    expect(table.columns).toEqual(['CUSTNO', 'NAME', 'CITY', 'BALANCE', 'SINCE']);
    expect(table.rows).toHaveLength(4);
    expect(table.rows[0]).toEqual(['000123', 'Ada Lovelace', 'London', '1,234.50', '2024-01-31']);
    expect(table.rows[3]).toEqual(['000126', 'Alan Turing', 'Manchester', '7.50', '2024-12-25']);
  });

  it('uses the boundaries given, sorted and without repeats, so a moved boundary changes the columns', () => {
    const table = readFixedWidth(LINES.join('\n'), { boundaries: [27, 7, 7, 39] });
    expect(table.boundaries).toEqual([7, 27, 39]);
    expect(table.columns).toEqual(['CUSTNO', 'NAME', 'CITY', 'BALANCE  SINCE']);
    expect(table.rows[0]![3]).toBe('1,234.50 2024-01-31');
  });

  it('reads every line as data without a header, naming the columns column0…, and pads short lines', () => {
    const table = readFixedWidth('ab cd\nef\n', { boundaries: [3], header: false });
    expect(table.columns).toEqual(['column0', 'column1']);
    expect(table.rows).toEqual([['ab', 'cd'], ['ef', '']]);
  });

  it('skips a banner at the top and a footer at the bottom, and never reads a blank line as a row', () => {
    const text = ['Customer list', '', ...LINES, '', '4 customers'].join('\r\n');
    const table = readFixedWidth(text, { skip: 2, skipBottom: 1 });
    expect(table.columns).toEqual(['CUSTNO', 'NAME', 'CITY', 'BALANCE', 'SINCE']);
    expect(table.rows).toHaveLength(4);
  });

  it('names columns as DuckDB would: empties column<i>, repeats suffixed', () => {
    expect(nameColumns(['a', '', 'a'], 4)).toEqual(['a', 'column1', 'a_1', 'column3']);
    expect(cutLine('abcdef', [2, 4])).toEqual(['ab', 'cd', 'ef']);
  });

  it('adds, removes and moves a boundary, keeping the list sorted and off the first offset', () => {
    expect(withBoundary([7, 27], 15)).toEqual([7, 15, 27]);
    expect(withBoundary([7, 27], 27)).toEqual([7]);
    expect(withBoundary([7, 27], 27, 30)).toEqual([7, 30]);
    expect(withBoundary([7, 27], 7, 0)).toEqual([27]);
  });
});
