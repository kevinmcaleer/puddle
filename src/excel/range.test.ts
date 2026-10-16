import { columnIndex, columnLetters, formatRange, intersect, MAX_COL, MAX_ROW, parseRange } from './range';

describe('cell ranges', () => {
  it('converts column letters both ways', () => {
    for (const [letters, i] of [['A', 0], ['Z', 25], ['AA', 26], ['AZ', 51], ['XFD', 16383]] as const) {
      expect(columnIndex(letters)).toBe(i);
      expect(columnLetters(i)).toBe(letters);
    }
    expect(columnIndex('ab')).toBe(27);
  });

  it('parses ranges in either corner order, with or without $', () => {
    expect(parseRange('B3:F200')).toEqual({ s: { r: 2, c: 1 }, e: { r: 199, c: 5 } });
    expect(parseRange(' f200:b3 ')).toEqual({ s: { r: 2, c: 1 }, e: { r: 199, c: 5 } });
    expect(parseRange('$B$3:$F$200')).toEqual(parseRange('B3:F200'));
  });

  it('reads one cell as from there to the end of the data', () => {
    expect(parseRange('A3')).toEqual({ s: { r: 2, c: 0 }, e: { r: MAX_ROW, c: MAX_COL } });
  });

  it.each(['', 'A', '3', 'A0', 'A1:', 'A1:B2:C3', 'Sheet1!A1:B2', 'ABCD1', 'A1048577'])('refuses %j', (text) => {
    expect(parseRange(text)).toBeUndefined();
  });

  it('formats and intersects', () => {
    const r = parseRange('B3:F200')!;
    expect(formatRange(r)).toBe('B3:F200');
    expect(formatRange(intersect(r, parseRange('A1:C10')!)!)).toBe('B3:C10');
    expect(intersect(r, parseRange('G1:H2')!)).toBeUndefined();
  });
});
