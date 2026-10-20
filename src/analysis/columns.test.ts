import { describe, expect, it } from 'vitest';
import type { ColumnSchema } from '../model';
import type { ColumnProfile } from '../results/profile';
import { analysisChecks, caseVariants, commonCase, findIssues, parseAnalysis, type AnalysisFacts } from './columns';
import { issueKey, sortIssues } from './issues';

const columns: ColumnSchema[] = [
  { name: 'id', type: 'BIGINT' },
  { name: 'name', type: 'VARCHAR' },
  { name: 'region', type: 'VARCHAR' },
  { name: 'amount', type: 'VARCHAR' },
];
const profile: Record<string, ColumnProfile> = {
  id: { empty: 0, distinct: 44 },
  name: { empty: 0, distinct: 400 },
  region: { empty: 0.1, distinct: 6 },
  amount: { empty: 0, distinct: 440, min: '£1,234.50', max: '99.00', looksLike: { kind: 'numbers', share: 1 } },
};
const facts: AnalysisFacts = {
  rows: 44,
  dups: 4,
  columns: {
    name: { nonNull: 44, edges: 5, edgesEx: [' Ada', 'Zoe '], doubled: 2, doubledEx: ['Bob  Jones'], nonPrinting: 1, nonPrintingEx: ['VIP​'], blank: 0 },
    region: { nonNull: 40, edges: 0, doubled: 0, nonPrinting: 0, blank: 3, values: ['East', 'NORTH', 'North', 'South', 'north', 'West'] },
    amount: { nonNull: 44, edges: 0, doubled: 0, nonPrinting: 0, blank: 0 },
  },
};

describe('analysis checks', () => {
  it('counts the text columns, and lists the values of those with few of them', () => {
    expect(analysisChecks(columns, profile)).toEqual([
      { column: 'name', text: true },
      { column: 'region', text: true, values: true },
      { column: 'amount', text: true },
    ]);
  });

  it('reads the query’s row back by check', () => {
    const checks = analysisChecks(columns, profile);
    const row = { rows: 44n, dups: 4n, nn0: 44n, edges0: 5n, edgesEx0: [' Ada', 'Zoe '], dbl0: 0n, dblEx0: [null, null], np0: 0n, npEx0: [null, null], blank0: 0n, nn1: 40n, edges1: 0n, edgesEx1: [null, null], dbl1: 0n, dblEx1: [null, null], np1: 0n, npEx1: [null, null], blank1: 3n, vals1: ['East', 'north'], nn2: 44n, edges2: 0n, edgesEx2: [null, null], dbl2: 0n, dblEx2: [null, null], np2: 0n, npEx2: [null, null], blank2: 0n };
    const parsed = parseAnalysis(row, checks);
    expect(parsed.rows).toBe(44);
    expect(parsed.dups).toBe(4);
    expect(parsed.columns.name).toMatchObject({ nonNull: 44, edges: 5, edgesEx: [' Ada', 'Zoe '], doubled: 0, doubledEx: [] });
    expect(parsed.columns.region).toMatchObject({ blank: 3, values: ['East', 'north'] });
  });
});

describe('mixed capitals', () => {
  it('groups values that are the same once capitals and spaces are ignored', () => {
    expect(caseVariants(['North', 'north', 'NORTH', 'South', ' south', 'East'])).toEqual([['North', 'north', 'NORTH'], ['South', ' south']]);
    expect(caseVariants(['a', 'b'])).toEqual([]);
  });

  it('picks the case most variants already use', () => {
    expect(commonCase([['North', 'north', 'NORTH', 'South']])).toBe('title');
    expect(commonCase([['North', 'north', 'NORTH']])).toBe('title');
    expect(commonCase([['NORTH', 'north', 'SOUTH']])).toBe('upper');
    expect(commonCase([['north', 'North', 'south']])).toBe('lower');
  });
});

describe('findIssues', () => {
  it('turns the facts into one issue per problem, with its count, examples and fix', () => {
    const issues = findIssues(columns, profile, facts);
    expect(issues.map((i) => i.key)).toEqual(['duplicateRows', 'nonPrinting:name', 'edgeSpaces:name', 'doubleSpaces:name', 'emptyText:region', 'mixedCase:region', 'numbersAsText:amount']);
    expect(issues[0]).toMatchObject({ kind: 'duplicateRows', count: 4, share: 4 / 44, severity: 'fix', fix: { type: 'duplicateRows', params: { columns: [], keep: 'first' } } });
    expect(issues[2]).toMatchObject({ column: 'name', count: 5, examples: [' Ada', 'Zoe '], fix: { type: 'trimWhitespace' } });
    expect(issues[5]).toMatchObject({ column: 'region', count: 3, examples: ['NORTH', 'North', 'north'], fix: { type: 'changeCase', params: { mode: 'title' } } });
    expect(issues[6]).toMatchObject({ column: 'amount', count: 44, share: 1, examples: ['£1,234.50', '99.00'], severity: 'fix', fix: { type: 'parseNumbers' } });
  });

  it('only suggests parsing a column that mostly, not wholly, reads as numbers or dates', () => {
    const mostly = { ...profile, amount: { ...profile.amount!, looksLike: { kind: 'dates' as const, share: 0.9 } } };
    const issue = findIssues(columns, mostly, facts).find((i) => i.column === 'amount');
    expect(issue).toMatchObject({ kind: 'datesAsText', severity: 'suggest', count: 40, fix: { type: 'parseDates' } });
    const barely = { ...profile, amount: { ...profile.amount!, looksLike: { kind: 'numbers' as const, share: 0.5 } } };
    expect(findIssues(columns, barely, facts).some((i) => i.column === 'amount')).toBe(false);
  });

  it('leaves out ignored issues, and finds nothing in an empty result', () => {
    expect(findIssues(columns, profile, facts, ['duplicateRows', issueKey('edgeSpaces', 'name')]).map((i) => i.key)).not.toContain('edgeSpaces:name');
    expect(findIssues(columns, profile, { rows: 0, columns: {} })).toEqual([]);
  });

  it('sorts the table’s issues first, then by column order, then by kind', () => {
    const issues = findIssues(columns, profile, facts);
    const shuffled = [...issues].reverse();
    expect(sortIssues(shuffled, columns.map((c) => c.name)).map((i) => i.key)).toEqual(issues.map((i) => i.key));
  });
});
