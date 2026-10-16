import type { ColumnProfile } from '../results/profile';
import { parseSuggestionChecks, suggestionChecks, suggestRules, type CheckResult } from './suggest';

const columns = [
  { name: 'id', type: 'BIGINT' },
  { name: 'status', type: 'VARCHAR' },
  { name: 'amount', type: 'VARCHAR' },
  { name: 'joined', type: 'DATE' },
  { name: 'note', type: 'VARCHAR' },
];

const profile: Record<string, ColumnProfile> = {
  id: { empty: 0, distinct: 10, min: '1', max: '10' },
  status: { empty: 0, distinct: 3, min: 'closed', max: 'pending' },
  amount: { empty: 0, distinct: 9, min: '1', max: '9', looksLike: { kind: 'numbers', share: 1 } },
  joined: { empty: 0.1, distinct: 9, min: '2024-01-01', max: '2024-12-31' },
  note: { empty: 0.5, distinct: 5, min: 'a', max: 'e', looksLike: { kind: 'dates', share: 0.9 } },
};

const checked = (cols: Record<string, CheckResult>, rows = 10) => ({ rows, columns: cols });

describe('which exact checks to run', () => {
  it('asks only what the profile hints at', () => {
    expect(suggestionChecks(columns, profile, 10)).toEqual([
      // No nulls: count blanks. Close to one value per row: count distinct exactly.
      { column: 'id', blank: true, distinct: true, values: undefined },
      { column: 'status', blank: true, edges: true, values: true },
      { column: 'amount', blank: true, edges: true, distinct: true },
      { column: 'note', edges: true, values: true },
    ].map((c) => Object.fromEntries(Object.entries(c).filter(([, v]) => v !== undefined))));
  });

  it('never asks for the values of a column with too many, or with about one per row', () => {
    const checks = suggestionChecks([{ name: 'code', type: 'VARCHAR' }], { code: { empty: 0.2, distinct: 11 } }, 1000);
    expect(checks[0]).not.toHaveProperty('values');
    expect(suggestionChecks([{ name: 'code', type: 'BIGINT' }], { code: { empty: 0.2, distinct: 3 } }, 4)).toEqual([]);
  });
});

describe('reading the checks back', () => {
  it('reads counts and the list of values per column', () => {
    const row = { rows: 10, nn0: 10, blank0: 0, distinct0: 10, nn1: 9, edges1: 0, values1: ['closed', 'open'] };
    expect(parseSuggestionChecks(row, [{ column: 'id', blank: true, distinct: true }, { column: 'status', edges: true, values: true }])).toEqual({
      rows: 10,
      columns: { id: { nonNull: 10, blank: 0, distinct: 10 }, status: { nonNull: 9, edges: 0, values: ['closed', 'open'] } },
    });
  });
});

describe('suggestRules', () => {
  const facts = checked({
    id: { nonNull: 10, blank: 0, distinct: 10 },
    status: { nonNull: 10, blank: 0, edges: 0, values: ['closed', 'open', 'pending'] },
    amount: { nonNull: 10, blank: 0, edges: 2, distinct: 9 },
    joined: { nonNull: 9 },
    note: { nonNull: 5, edges: 0, values: ['a', 'b', 'c', 'd', 'e'] },
  });

  it('suggests rules that pass today, each with its reason', () => {
    expect(suggestRules(columns, profile, facts).map((s) => [s.key, s.reason])).toEqual([
      ['notEmpty:id', 'id has no empty values'],
      ['unique:id', 'id has a different value in each of its 10 rows'],
      ['inRange:id', 'id runs from 1 to 10'],
      ['notEmpty:status', 'status has no empty values'],
      ['inSet:status', 'status has 3 distinct values'],
      ['noEdgeSpaces:status', 'status has no spaces at either end'],
      ['notEmpty:amount', 'amount has no empty values'],
      ['readsAs:amount', 'amount is text, but every value reads as a number'],
      ['inRange:joined', 'joined runs from 2024-01-01 to 2024-12-31'],
      ['noEdgeSpaces:note', 'note has no spaces at either end'],
    ]);
    const set = suggestRules(columns, profile, facts).find((s) => s.key === 'inSet:status')!;
    expect(set).toMatchObject({ type: 'inSet', params: { column: 'status', values: ['closed', 'open', 'pending'], matchCase: true } });
    expect(suggestRules(columns, profile, facts).find((s) => s.key === 'unique:id')!.params).toEqual({ columns: ['id'] });
  });

  it('needs the exact count to agree before suggesting unique', () => {
    // The approximate count said 10; exactly, two rows share a value.
    const keys = suggestRules(columns, profile, checked({ ...facts.columns, id: { nonNull: 10, blank: 0, distinct: 9 } })).map((s) => s.key);
    expect(keys).not.toContain('unique:id');
    // Empty values in the column: not suggested either.
    expect(suggestRules(columns, profile, checked({ ...facts.columns, id: { nonNull: 8, distinct: 8 } })).map((s) => s.key)).not.toContain('unique:id');
  });

  it('only suggests reading text as numbers or dates when every value does', () => {
    expect(suggestRules(columns, profile, facts).map((s) => s.key)).not.toContain('readsAs:note');
  });

  it('leaves out a set of values when there are about as many values as rows', () => {
    expect(suggestRules(columns, profile, facts).map((s) => s.key)).not.toContain('inSet:note');
  });

  it('leaves out rules the node already has, and dismissed suggestions', () => {
    const existing = [
      { type: 'notEmpty', params: { column: 'id' } },
      { type: 'unique', params: { columns: ['id'] } },
      { type: 'unique', params: { columns: ['status', 'amount'] } },
    ];
    const keys = suggestRules(columns, profile, facts, existing, ['inSet:status']).map((s) => s.key);
    expect(keys).not.toContain('notEmpty:id');
    expect(keys).not.toContain('unique:id');
    expect(keys).not.toContain('inSet:status');
    expect(keys).toContain('notEmpty:status');
  });

  it('suggests nothing for an empty result', () => {
    expect(suggestRules(columns, profile, checked({}, 0))).toEqual([]);
  });
});
