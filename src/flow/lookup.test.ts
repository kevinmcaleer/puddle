import { matchRate, parseLookupCounts } from './lookup';

describe('lookup counts', () => {
  it('reads the check row and says the match rate', () => {
    const c = parseLookupCounts({ rows: 5n, matched: 4n, dup_keys: 1n, dup_rows: 1n, dup_example: '5', missing_keys: 1n, missing_example: null });
    expect(c).toEqual({ rows: 5, matched: 4, dupKeys: 1, dupRows: 1, dupExample: '5', missingKeys: 1, missingExample: undefined });
    expect(matchRate(c)).toBe('4 of 5 rows matched (80%)');
    expect(matchRate({ ...c, rows: 1, matched: 1 })).toBe('1 of 1 row matched (100%)');
    expect(matchRate({ ...c, rows: 0, matched: 0 })).toBe('0 of 0 rows matched (0%)');
  });
});
