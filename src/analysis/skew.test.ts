import { describe, expect, it } from 'vitest';
import type { ColumnSchema } from '../model';
import { findSkew, parseSkew, skewFix, skewIssue, type SkewGroup } from './skew';

const invoice = ['Invoice', 'Customer', 'Issued', 'Due', 'Net', 'VAT', 'Gross'];
const group = (sig: string, n: number, first: number, last: number): SkewGroup => ({ sig, n, first, last });
const schema = (names: string[], types: Record<string, string> = {}): ColumnSchema[] => names.map((name) => ({ name, type: types[name] ?? 'VARCHAR' }));

describe('findSkew', () => {
  it('finds the rows with a cell deleted: the usual row shifted left from a column, from a row number down', () => {
    const skew = findSkew(invoice, [group('ttddnnn', 17, 1, 17), group('tddnnne', 19, 18, 36)]);
    expect(skew).toMatchObject({ at: 1, sit: 'left', rows: { from: 18 }, exact: true, base: { sig: 'ttddnnn' }, shifted: { sig: 'tddnnne' } });
  });

  it('finds the rows with a cell inserted: shifted right into a column the reader named, picked out where the hole is', () => {
    const skew = findSkew([...invoice, 'Column H'], [group('ttddnnne', 24, 1, 36), group('tteddnnn', 12, 11, 22)]);
    expect(skew).toMatchObject({ at: 2, sit: 'right', rows: { emptyColumn: 2 }, exact: true });
  });

  it('is not exact when the column that is empty on the shifted rows is empty on other rows too', () => {
    const skew = findSkew([...invoice, 'Column H'], [group('ttddnnne', 20, 1, 36), group('tteddnnn', 12, 11, 22), group('ttednnne', 4, 3, 30)]);
    expect(skew).toMatchObject({ at: 2, sit: 'right', rows: { emptyColumn: 2 }, exact: false });
  });

  it('leaves blank rows and single rows out, and finds no skew in a tidy table', () => {
    expect(findSkew(invoice, [group('ttddnnn', 36, 1, 36), group('eeeeeee', 3, 10, 30), group('tddnnne', 1, 20, 20)])).toBeUndefined();
    expect(findSkew(invoice, [group('ttddnnn', 30, 1, 36), group('ttddnne', 6, 2, 35)])).toBeUndefined();
  });

  it('reads the groups as the query returns them', () => {
    expect(parseSkew([{ sig: 'tn', n: 2n, first: 1, last: 3 }])).toEqual([{ sig: 'tn', n: 2, first: 1, last: 3 }]);
  });
});

describe('skewFix', () => {
  it('moves the cells back right from the row number, then gives the dates and numbers their types back', () => {
    const columns = schema(invoice, { Issued: 'DATE', Net: 'DOUBLE', VAT: 'DOUBLE', Gross: 'DOUBLE' });
    const skew = findSkew(invoice, [group('ttddnnn', 17, 1, 17), group('tddnnne', 19, 18, 36)])!;
    const fix = skewFix(columns, skew, { Issued: ['%Y-%m-%d', '%-m/%-d/%y'] });
    expect(fix.steps).toEqual([
      { type: 'realignRows', params: { rows: 'from', from: 18, conditions: [], match: 'all', matchCase: false, columns: ['Customer', 'Issued', 'Due', 'Net', 'VAT', 'Gross'], direction: 'right', by: 1 } },
      { type: 'parseNumbers', params: { columns: ['Net', 'VAT', 'Gross'] } },
      { type: 'parseDates', params: { columns: ['Issued'], formats: ['%Y-%m-%d', '%-m/%-d/%y'], onError: 'empty' } },
      { type: 'parseDates', params: { columns: ['Due'], formats: ['%Y-%m-%d'], onError: 'empty' } },
    ]);
    // Each date column's text comes from itself and, on the moved rows, the column to its left.
    expect(fix.dateSources).toEqual({ Issued: ['Issued', 'Customer'], Due: ['Due', 'Issued'] });
    expect(skewIssue(columns, skew, fix)).toEqual({ value: 'left', count: 19, examples: ['rows 18 to 36', 'from row 18'], severity: 'fix', fix: { steps: fix.steps, label: 'Realign rows' } });
  });

  it('moves the cells back left where the hole is, keeps whole-number columns whole, and removes the column the inserted cells pushed out', () => {
    const names = [...invoice, 'Column H'];
    const columns = schema(names, { Issued: 'DATE', Due: 'DATE', VAT: 'BIGINT', Gross: 'BIGINT', 'Column H': 'BIGINT' });
    const skew = findSkew(names, [group('ttddnnne', 24, 1, 36), group('tteddnnn', 12, 11, 22)])!;
    const fix = skewFix(columns, skew);
    expect(fix.steps).toEqual([
      { type: 'realignRows', params: { rows: 'where', from: 1, conditions: [{ column: 'Issued', op: 'empty', value: '' }], match: 'all', matchCase: false, columns: ['Issued', 'Due', 'Net', 'VAT', 'Gross', 'Column H'], direction: 'left', by: 1 } },
      { type: 'changeType', params: { columns: ['VAT', 'Gross'], to: 'integer', onError: 'empty' } },
      { type: 'parseNumbers', params: { columns: ['Net'] } },
      { type: 'parseDates', params: { columns: ['Issued'], formats: ['%Y-%m-%d'], onError: 'empty' } },
      { type: 'parseDates', params: { columns: ['Due'], formats: ['%Y-%m-%d'], onError: 'empty' } },
      { type: 'removeColumns', params: { columns: ['Column H'] } },
    ]);
    expect(skewIssue(columns, skew, fix)).toMatchObject({ value: 'right', count: 12, examples: ['rows 11 to 22', 'where Issued is empty'], severity: 'fix' });
  });
});
