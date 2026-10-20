import { describe, expect, it } from 'vitest';
import { editDistance, jaro, jaroWinkler, nearDuplicates } from './similar';

describe('similarity', () => {
  it('measures how alike two strings are, rewarding a shared start', () => {
    expect(jaro('martha', 'marhta')).toBeCloseTo(0.944, 3);
    expect(jaroWinkler('martha', 'marhta')).toBeCloseTo(0.961, 3);
    expect(jaroWinkler('manchestr', 'manchester')).toBeGreaterThan(0.95);
    expect(jaroWinkler('leeds', 'london')).toBeLessThan(0.75);
    expect(jaro('', 'a')).toBe(0);
    expect(jaro('same', 'same')).toBe(1);
  });

  it('counts edits, with a swap as one', () => {
    expect(editDistance('leads', 'leeds')).toBe(1);
    expect(editDistance('recieve', 'receive')).toBe(1);
    expect(editDistance('cat', 'cart')).toBe(1);
    expect(editDistance('cat', 'dog')).toBe(3);
    expect(editDistance('a', 'abcd', 1)).toBe(2);
  });
});

describe('near-duplicates', () => {
  it('names each rarer value that is nearly a more common one, with that one as its target', () => {
    const counts = [{ value: 'Manchester', count: 12 }, { value: 'Leeds', count: 10 }, { value: 'Bristol', count: 8 }, { value: 'Manchestr', count: 2 }, { value: 'Leads', count: 1 }, { value: 'Brighton', count: 3 }];
    expect(nearDuplicates(counts)).toEqual([
      { value: 'Manchestr', count: 2, target: 'Manchester' },
      { value: 'Leads', count: 1, target: 'Leeds' },
    ]);
  });

  it('treats spellings that differ only by capitals or spaces as one value, the most common spelling standing for it', () => {
    const counts = [{ value: 'north', count: 5 }, { value: 'North', count: 4 }, { value: 'Nort', count: 1 }];
    expect(nearDuplicates(counts)).toEqual([{ value: 'Nort', count: 1, target: 'north' }]);
  });

  it('leaves numbers, codes, dates and short values alone', () => {
    expect(nearDuplicates([{ value: '1001', count: 5 }, { value: '1002', count: 4 }])).toEqual([]);
    expect(nearDuplicates([{ value: 'CU1001', count: 5 }, { value: 'CU1002', count: 4 }])).toEqual([]);
    expect(nearDuplicates([{ value: '2025-01-02', count: 5 }, { value: '2025-01-03', count: 4 }])).toEqual([]);
    expect(nearDuplicates([{ value: 'Yes', count: 5 }, { value: 'Yas', count: 1 }])).toEqual([]);
    // Equal counts say nothing about which is right.
    expect(nearDuplicates([{ value: 'Grey', count: 5 }, { value: 'Gray', count: 5 }])).toEqual([]);
  });

  it('keeps two names that share a first word apart: a shared start is not a misspelling', () => {
    // Jaro-Winkler alone puts Fatima Patel within reach of Fatima Ali (the CRM export's customers).
    expect(nearDuplicates([{ value: 'Fatima Ali', count: 2 }, { value: 'Fatima Patel', count: 1 }])).toEqual([]);
    expect(nearDuplicates([{ value: 'MATEO ALI', count: 2 }, { value: 'mateo patel', count: 1 }])).toEqual([]);
    // A second typo is allowed in a long word.
    expect(nearDuplicates([{ value: 'Massachusetts', count: 5 }, { value: 'Masachusets', count: 1 }])).toEqual([{ value: 'Masachusets', count: 1, target: 'Massachusetts' }]);
  });
});
