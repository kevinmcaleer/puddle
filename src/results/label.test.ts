import { describe, expect, it } from 'vitest';
import { gridLabel } from './label';

describe('the results grid’s name', () => {
  it('says whose rows they are and how many rows and columns', () => {
    expect(gridLabel('Transform 1', 2000, 3)).toBe('Results of Transform 1: 2,000 rows, 3 columns');
    expect(gridLabel('one.csv', 1, 1)).toBe('Results of one.csv: 1 row, 1 column');
  });

  it('says the rows are being counted until the count lands', () => {
    expect(gridLabel('big.parquet', undefined, 12)).toBe('Results of big.parquet: counting rows, 12 columns');
  });
});
