import { SHEET_COLUMNS, SHEET_ROWS, sheetNameProblem, tooManyRows, toSheetName } from './limits';

describe('Excel limits', () => {
  it('match Excel', () => {
    expect(SHEET_ROWS).toBe(1_048_576);
    expect(SHEET_COLUMNS).toBe(16_384);
  });

  it('check sheet names against Excel’s rules', () => {
    expect(sheetNameProblem('Orders 2026')).toBeUndefined();
    expect(sheetNameProblem('x'.repeat(31))).toBeUndefined();
    expect(sheetNameProblem(' ')).toBe('Give the sheet a name.');
    expect(sheetNameProblem('x'.repeat(32))).toBe('Sheet names can be at most 31 characters long.');
    for (const bad of ['a/b', 'a\\b', 'a?', 'a*', '[a]', 'a:b']) expect(sheetNameProblem(bad)).toBe('Sheet names can’t contain \\ / ? * [ ] or :.');
    expect(sheetNameProblem("'quoted'")).toBe('Sheet names can’t start or end with an apostrophe.');
  });

  it('make a valid sheet name from any node name', () => {
    expect(toSheetName('Output 1')).toBe('Output 1');
    expect(toSheetName('Sales: Q1/Q2 [draft]')).toBe('Sales Q1 Q2 draft');
    expect(toSheetName("'quoted'")).toBe('quoted');
    expect(toSheetName('a'.repeat(40))).toHaveLength(31);
    expect(toSheetName(' /:* ')).toBe('Sheet1');
    for (const name of ['Output 1', 'Sales: Q1/Q2 [draft]', 'x'.repeat(40), "'"]) expect(sheetNameProblem(toSheetName(name))).toBeUndefined();
  });

  it('explain the row limit with and without a header', () => {
    expect(tooManyRows(2_000_000, true)).toBe('This output has 2,000,000 rows; an Excel sheet holds at most 1,048,575 below its header. Export it as CSV or Parquet instead, which have no row limit.');
    expect(tooManyRows(2_000_000, false)).toContain('holds at most 1,048,576. Export');
  });
});
