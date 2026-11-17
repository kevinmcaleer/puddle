import type { ColumnProfile } from '../results/profile';
import { isMeasure, keyLike, parseSuggestionChecks, rankSuggestions, suggestionChecks, suggestRules, SUGGESTIONS_SHOWN, type CheckResult } from './suggest';

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
      // Every value looks like a number: count the ones the rule itself would fail.
      { column: 'amount', blank: true, edges: true, distinct: true, reads: 'number' },
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

  // Regression: profiling reads "16 Feb 2024" and "24/01/2024" as dates, the rule only what DuckDB casts, so the
  // suggestion "reads as a date" was offered and failed the moment it was added.
  it('does not suggest reading text as a date when the rule itself would fail', () => {
    const cols = [{ name: 'when', type: 'VARCHAR' }];
    const prof: Record<string, ColumnProfile> = { when: { empty: 0, distinct: 10, looksLike: { kind: 'dates', share: 1 } } };
    expect(suggestionChecks(cols, prof, 10)[0]).toMatchObject({ column: 'when', reads: 'date' });
    const keysFor = (unread: number) => suggestRules(cols, prof, checked({ when: { nonNull: 10, unread } })).map((s) => s.key);
    expect(keysFor(4)).not.toContain('readsAs:when');
    expect(keysFor(0)).toContain('readsAs:when');
    expect(parseSuggestionChecks({ rows: 10, nn0: 10, unread0: 4 }, [{ column: 'when', reads: 'date' }]).columns.when).toMatchObject({ unread: 4 });
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

// #290: a six column file got sixteen suggestions in column order, with noise such as "amount is unique" among them.
describe('the sales sample: what is suggested, and in what order', () => {
  const sales = [
    { name: 'order_id', type: 'VARCHAR' },
    { name: 'order_date', type: 'VARCHAR' },
    { name: 'customer', type: 'VARCHAR' },
    { name: 'amount', type: 'VARCHAR' },
    { name: 'currency', type: 'VARCHAR' },
    { name: 'region', type: 'VARCHAR' },
  ];
  const salesProfile: Record<string, ColumnProfile> = {
    order_id: { empty: 0, distinct: 120, min: 'SO-1001', max: 'SO-1120' },
    order_date: { empty: 0, distinct: 110, min: '16 Feb 2024', max: 'April 28, 2024', looksLike: { kind: 'dates', share: 1 } },
    customer: { empty: 0, distinct: 40, min: 'Alice Ali', max: 'Zoe Young' },
    amount: { empty: 0, distinct: 120, min: '132.49', max: '£1530.44', looksLike: { kind: 'numbers', share: 1 } },
    currency: { empty: 0, distinct: 3, min: ' GBP', max: 'gbp' },
    region: { empty: 0.05, distinct: 6, min: ' North', max: 'west' },
  };
  const salesFacts = checked(
    {
      order_id: { nonNull: 120, blank: 0, edges: 0, distinct: 120 },
      order_date: { nonNull: 120, blank: 0, edges: 0 },
      customer: { nonNull: 120, blank: 0, edges: 0 },
      amount: { nonNull: 120, blank: 0, edges: 0, distinct: 120 },
      currency: { nonNull: 120, blank: 0, edges: 9, values: [' GBP', 'GBP', 'gbp'] },
      region: { nonNull: 114, edges: 7 },
    },
    120,
  );
  const all = suggestRules(sales, salesProfile, salesFacts);

  it('does not suggest that a measure is unique, though every amount differs', () => {
    expect(all.map((s) => s.key)).toContain('unique:order_id');
    expect(all.map((s) => s.key)).not.toContain('unique:amount');
    expect(isMeasure({ name: 'amount', type: 'VARCHAR' }, salesProfile.amount)).toBe(true);
    expect(isMeasure({ name: 'price', type: 'DECIMAL(10,2)' }, undefined)).toBe(true);
    expect(isMeasure({ name: 'total', type: 'DOUBLE' }, undefined)).toBe(true);
    // Numbers that name a row are not a measure: an id kept as text, a whole-number id.
    expect(isMeasure({ name: 'customer_id', type: 'VARCHAR' }, { looksLike: { kind: 'numbers', share: 1 } })).toBe(false);
    expect(isMeasure({ name: 'id', type: 'BIGINT' }, undefined)).toBe(false);
    expect(isMeasure({ name: 'customer', type: 'VARCHAR' }, salesProfile.customer)).toBe(false);
  });

  it('still suggests the other rules for a measure', () => {
    expect(all.map((s) => s.key)).toEqual(expect.arrayContaining(['notEmpty:amount', 'readsAs:amount']));
  });

  it('ranks keys and required columns first, each kind of rule taking its turn', () => {
    const ranked = rankSuggestions(all).map((s) => s.key);
    expect(ranked.slice(0, SUGGESTIONS_SHOWN)).toEqual(['unique:order_id', 'notEmpty:order_id', 'inSet:currency', 'readsAs:order_date', 'noEdgeSpaces:order_id']);
    // Nothing is dropped by ranking, and nothing is listed twice.
    expect([...ranked].sort()).toEqual(all.map((s) => s.key).sort());
    expect(ranked.indexOf('notEmpty:order_date')).toBeGreaterThan(ranked.indexOf('readsAs:order_date'));
  });

  it('puts a column named as a key before the others of its kind', () => {
    const picks = (keys: string[]) => keys.map((key) => ({ key, type: key.split(':')[0]!, params: {}, reason: '' }));
    expect(rankSuggestions(picks(['unique:name', 'unique:email', 'unique:customer_id', 'notEmpty:name', 'notEmpty:customer_id'])).map((s) => s.key)).toEqual([
      'unique:customer_id',
      'notEmpty:customer_id',
      'unique:name',
      'notEmpty:name',
      'unique:email',
    ]);
    for (const name of ['id', 'order_id', 'customerId', 'Invoice no', 'product code', 'ref']) expect(keyLike(name)).toBe(true);
    for (const name of ['paid', 'video', 'amount', 'casino', 'name']) expect(keyLike(name)).toBe(false);
  });
});
