import { joinCure, joinMatchRate, keptSide, parseTidyCounts, sideMatch, unmatchedFate, type JoinCounts, type TidyCounts } from './join';

const counts = (c: Partial<JoinCounts> = {}): JoinCounts => ({ leftRows: 60, rightRows: 20, rows: 60, pairs: 28, matchedLeft: 28, matchedRight: 13, ...c });
const tidy = (left: [number, number, number], right: [number, number, number] = [13, 13, 13]): TidyCounts => ({
  trim: { left: left[0], right: right[0] },
  upper: { left: left[1], right: right[1] },
  both: { left: left[2], right: right[2] },
});

describe('how a join matched', () => {
  it('is about the right side for a right join, else the left', () => {
    expect(keptSide('right')).toBe('right');
    for (const kind of ['inner', 'left', 'full', 'anti', 'semi'] as const) expect(keptSide(kind)).toBe('left');
  });

  it('says how each side matched', () => {
    expect(sideMatch(counts(), 'left')).toEqual({ rows: 60, matched: 28, unmatched: 32 });
    expect(joinMatchRate(counts(), 'left')).toBe('28 of 60 left rows matched (47%)');
    expect(joinMatchRate(counts(), 'right')).toBe('13 of 20 right rows matched (65%)');
    expect(joinMatchRate(counts({ leftRows: 1, matchedLeft: 1 }), 'left')).toBe('1 of 1 left row matched (100%)');
    expect(joinMatchRate(counts({ leftRows: 0, matchedLeft: 0 }), 'left')).toBe('0 of 0 left rows matched (0%)');
  });

  it('says what becomes of the unmatched rows for each join type', () => {
    expect(unmatchedFate('inner')).toMatch(/left out/);
    expect(unmatchedFate('semi')).toMatch(/left out/);
    expect(unmatchedFate('anti')).toMatch(/keeps/);
    expect(unmatchedFate('left')).toMatch(/right columns are empty/);
    expect(unmatchedFate('full')).toMatch(/right columns are empty/);
    expect(unmatchedFate('right')).toMatch(/left columns are empty/);
  });
});

describe('the cure for unmatched keys', () => {
  it('reads the counts of each tidy', () => {
    expect(parseTidyCounts({ trim_left: 48n, trim_right: 18, upper_left: 38, upper_right: 16, both_left: 58, both_right: 18 })).toEqual(tidy([48, 38, 58], [18, 16, 18]));
  });

  it('takes both when both together match the most', () => {
    expect(joinCure('left', counts(), tidy([48, 38, 58]))).toEqual({ tidy: { trim: true, upper: true }, gained: 30 });
  });

  it('takes trimming alone, or one case alone, when it does as well as both', () => {
    expect(joinCure('inner', counts(), tidy([58, 28, 58]))).toEqual({ tidy: { trim: true, upper: false }, gained: 30 });
    expect(joinCure('inner', counts(), tidy([28, 40, 40]))).toEqual({ tidy: { trim: false, upper: true }, gained: 12 });
  });

  it('prefers trimming when trimming and one case do equally well', () => {
    expect(joinCure('left', counts(), tidy([40, 40, 40]))?.tidy).toEqual({ trim: true, upper: false });
  });

  it('has nothing to offer when no tidy matches more rows', () => {
    expect(joinCure('left', counts(), tidy([28, 28, 28]))).toBeUndefined();
  });

  it('counts the right side for a right join', () => {
    expect(joinCure('right', counts(), tidy([58, 58, 58], [13, 13, 13]))).toBeUndefined();
    expect(joinCure('right', counts(), tidy([28, 28, 28], [18, 16, 18]))).toEqual({ tidy: { trim: true, upper: false }, gained: 5 });
  });
});
