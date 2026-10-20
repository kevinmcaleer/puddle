import { describe, expect, it } from 'vitest';
import type { ColumnSchema } from '../model';
import type { ColumnProfile } from '../results/profile';
import { analysisChecks, booleanPair, caseVariants, commonCase, findIssues, parseAnalysis, parseDistinctFacts, parseValueCounts, periodColumns, serialDateFormat, type AnalysisFacts, type ColumnFacts } from './columns';
import { issueKey, sortIssues, type StepFix } from './issues';

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
  it('counts every column; text columns get the text facts, few-valued ones their values, numbers the range, ids the mode', () => {
    expect(analysisChecks(columns, profile)).toEqual([
      { column: 'id', numeric: true, id: true },
      { column: 'name', text: true },
      { column: 'region', text: true, values: true },
      { column: 'amount', text: true, numeric: true },
    ]);
    // The first column gets the index check only when its name says it counts rows.
    expect(analysisChecks([{ name: 'Unnamed: 0', type: 'BIGINT' }, ...columns.slice(1)], profile)[0]).toEqual({ column: 'Unnamed: 0', numeric: true, index: true });
    expect(analysisChecks([{ name: 'index', type: 'VARCHAR' }], {})[0]).toEqual({ column: 'index', text: true, index: true });
  });

  it('reads the query’s row back by check', () => {
    const checks = analysisChecks(columns, profile);
    const row = {
      rows: 44n, dups: 4n,
      nn0: 44n, nmin0: 1, nmax0: 44, whole0: 44n,
      nn1: 44n, edges1: 5n, edgesEx1: [' Ada', 'Zoe '], dbl1: 0n, dblEx1: [null, null], np1: 0n, npEx1: [null, null], blank1: 0n, ph1: 0n, nonNum1: 44n, kv1: 0n, kvSep1: null, kvEx1: null, moji1: 1n, mojiEx1: ['JosÃ©', 'JosÃ©'], comma1: 0n, point1: 0n,
      nn2: 40n, edges2: 0n, edgesEx2: [null, null], dbl2: 0n, dblEx2: [null, null], np2: 0n, npEx2: [null, null], blank2: 3n, ph2: 2n, nonNum2: 35n, kv2: 0n, kvSep2: null, kvEx2: null, moji2: 0n, mojiEx2: [null, null], comma2: 0n, point2: 0n,
      nn3: 44n, edges3: 0n, edgesEx3: [null, null], dbl3: 0n, dblEx3: [null, null], np3: 0n, npEx3: [null, null], blank3: 0n, ph3: 0n, nonNum3: 1n, kv3: 0n, kvSep3: null, kvEx3: null, moji3: 0n, mojiEx3: [null, null], comma3: 1n, point3: 40n, nmin3: 1, nmax3: 99, whole3: 10n,
    };
    const parsed = parseAnalysis(row, checks);
    expect(parsed.rows).toBe(44);
    expect(parsed.dups).toBe(4);
    expect(parsed.columns.id).toEqual({ nonNull: 44, min: 1, max: 44, whole: 44 });
    expect(parsed.columns.name).toMatchObject({ nonNull: 44, edges: 5, edgesEx: [' Ada', 'Zoe '], doubled: 0, doubledEx: [], mojibake: 1, mojibakeEx: ['JosÃ©', 'JosÃ©'] });
    expect(parsed.columns.region).toMatchObject({ blank: 3, placeholders: 2, nonNumbers: 35 });
    expect(parsed.columns.amount).toMatchObject({ nonNumbers: 1, min: 1, max: 99, whole: 10, commaDecimals: 1, pointDecimals: 40 });
    expect(parsed.columns.region!.values).toBeUndefined();

    // What the distinct values say comes in its own rows, one per column.
    parseDistinctFacts(
      [
        { c: 'id', dist: 40n, mode: '7', phEx: null, nonNumEx: null, nonDateEx: null, shapes: null, shapesEx: null },
        { c: 'name', dist: 44n, mode: 'Ada', phEx: [], nonNumEx: ['Ada'], nonDateEx: ['Ada'], shapes: 9n, shapesEx: ['Aaa'] },
        { c: 'region', dist: 6n, mode: 'North', phEx: ['-', 'n/a'], nonNumEx: ['East', 'North'], nonDateEx: ['East'], shapes: 2n, shapesEx: ['AAAAA', 'Aaaaa'] },
        { c: 'gone', dist: 1n, mode: 'x', phEx: null, nonNumEx: null, nonDateEx: null, shapes: null, shapesEx: null },
      ],
      checks,
      parsed.columns,
    );
    expect(parsed.columns.id).toMatchObject({ distinct: 40, mode: '7' });
    expect(parsed.columns.name).toMatchObject({ distinct: 44, shapes: 9, shapesEx: ['Aaa'], nonNumbersEx: ['Ada'] });
    expect(parsed.columns.name!.mode).toBeUndefined();
    expect(parsed.columns.region).toMatchObject({ distinct: 6, placeholdersEx: ['-', 'n/a'], nonNumbersEx: ['East', 'North'], shapesEx: ['AAAAA', 'Aaaaa'] });
    expect(parsed.columns.gone).toBeUndefined();
  });

  it('reads the value counts back by column, most frequent first as the query orders them', () => {
    expect(parseValueCounts([{ c: 'region', v: 'North', n: 20n }, { c: 'region', v: 'north', n: 2n }, { c: 'status', v: 'Y', n: 30n }])).toEqual({
      region: [{ value: 'North', count: 20 }, { value: 'north', count: 2 }],
      status: [{ value: 'Y', count: 30 }],
    });
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

  it('counts placeholders for empty, and the one word in a column of numbers, as a read option on a text source or Replace values elsewhere', () => {
    const withPlaceholders: AnalysisFacts = {
      ...facts,
      columns: { ...facts.columns, region: { ...facts.columns.region!, placeholders: 4, placeholdersEx: ['-', 'N/A', 'n/a'] }, amount: { ...facts.columns.amount!, nonNumbers: 2, nonNumbersEx: ['pending'] } },
    };
    const steps = findIssues(columns, profile, withPlaceholders);
    expect(steps.find((i) => i.key === 'placeholders:region')).toMatchObject({
      count: 4, share: 0.1, examples: ['-', 'N/A', 'n/a'], severity: 'fix',
      fix: { label: 'Replace values', steps: [{ type: 'replaceValues', params: { match: 'value', find: '-', replaceWithNull: true, matchCase: false } }, { type: 'replaceValues', params: { find: 'n/a' } }] },
    });
    expect(steps.find((i) => i.key === 'placeholders:amount')).toMatchObject({ count: 2, examples: ['pending'], fix: { steps: [{ params: { find: 'pending' } }] } });
    // The numbers issue then counts the real values only.
    expect(steps.find((i) => i.key === 'numbersAsText:amount')).toMatchObject({ count: 42 });

    const text = findIssues(columns, profile, { ...withPlaceholders, shape: { facts: { rows: 44, blank: 0, narrow: 0, separator: 0, header: 0, total: 0, totalEx: [], top: 0, bottom: 0 }, options: { nullStrings: ['NULL'] } } });
    expect(text.find((i) => i.key === 'placeholders:region')?.fix).toEqual({ readOptions: { nullStrings: ['NULL', '-', 'N/A', 'n/a'] }, label: 'Read "-", "N/A", "n/a" as empty' });
  });

  it('finds yes and no stored as text, dates stored as numbers, mixed types and mangled characters', () => {
    const cols: ColumnSchema[] = [{ name: 'active', type: 'VARCHAR' }, { name: 'flag', type: 'VARCHAR' }, { name: 'created_at', type: 'BIGINT' }, { name: 'Order date', type: 'VARCHAR' }, { name: 'total', type: 'VARCHAR' }, { name: 'note', type: 'VARCHAR' }];
    const prof: Record<string, ColumnProfile> = { active: { empty: 0, distinct: 2 }, flag: { empty: 0, distinct: 2 }, created_at: { empty: 0, distinct: 9 }, 'Order date': { empty: 0, distinct: 9 }, total: { empty: 0, distinct: 9, partly: { kind: 'numbers', share: 0.7 } }, note: { empty: 0, distinct: 9 } };
    const col = (extra: Partial<ColumnFacts>): ColumnFacts => ({ nonNull: 10, distinct: 9, ...extra });
    const issues = findIssues(cols, prof, {
      rows: 10,
      columns: {
        active: col({ distinct: 2, values: ['N', 'Y', 'n/a'], valueCounts: [{ value: 'Y', count: 6 }, { value: 'N', count: 3 }, { value: 'n/a', count: 1 }], placeholders: 1, placeholdersEx: ['n/a'] }),
        flag: col({ distinct: 2, values: ['0', '1'], valueCounts: [{ value: '1', count: 6 }, { value: '0', count: 4 }] }),
        created_at: col({ min: 1_700_000_000, max: 1_750_000_000, whole: 10 }),
        'Order date': col({ min: 45_000, max: 45_300, whole: 10 }),
        total: col({ nonNumbers: 3, nonNumbersEx: ['free', 'tbc?', 'waived'] }),
        note: col({ mojibake: 2, mojibakeEx: ['JosÃ© said â€œhiâ€', 'cafÃ©'] }),
      },
    });
    const by = Object.fromEntries(issues.map((i) => [i.key, i]));
    expect(by['booleansAsText:active']).toMatchObject({ count: 9, examples: ['y', 'n'], severity: 'fix', fix: { type: 'changeType', params: { to: 'boolean', onError: 'empty' } } });
    expect(by['booleansAsText:flag']).toMatchObject({ severity: 'suggest', examples: ['1', '0'] });
    expect(by['serialDates:created_at']).toMatchObject({ severity: 'suggest', examples: ['1700000000', '1750000000'], fix: { type: 'parseDates', params: { formats: ['unix seconds'] } } });
    expect(by['serialDates:Order date']).toMatchObject({ fix: { type: 'parseDates', params: { formats: ['excel serial'] } } });
    expect(by['mixedTypes:total']).toMatchObject({ count: 3, examples: ['free', 'tbc?', 'waived'], severity: 'suggest', fix: { type: 'parseNumbers' } });
    expect(by['mojibake:note']).toMatchObject({ count: 2, examples: ['JosÃ© said â€œhiâ€', 'cafÃ©'], severity: 'fix', fix: { type: 'fixMojibake' } });
    // On a text source read in another encoding, the fix is to read it as UTF-8 instead.
    const latin = findIssues(cols, prof, { rows: 10, columns: { note: col({ mojibake: 2, mojibakeEx: ['cafÃ©'] }) }, shape: { facts: { rows: 10, blank: 0, narrow: 0, separator: 0, header: 0, total: 0, totalEx: [], top: 0, bottom: 0 }, options: { encoding: 'latin-1' } } });
    expect(latin.find((i) => i.kind === 'mojibake')?.fix).toEqual({ readOptions: { encoding: 'utf-8' }, label: 'Read the file as UTF-8' });
  });

  it('lists a likely misspelling per value, with Replace values to the common spelling, and values written several ways', () => {
    const cols: ColumnSchema[] = [{ name: 'city', type: 'VARCHAR' }, { name: 'phone', type: 'VARCHAR' }, { name: 'postcode', type: 'VARCHAR' }, { name: 'Notes', type: 'VARCHAR' }];
    const prof: Record<string, ColumnProfile> = { city: { empty: 0, distinct: 4 }, phone: { empty: 0, distinct: 40 }, postcode: { empty: 0, distinct: 40 }, Notes: { empty: 0, distinct: 40 } };
    const counts = [{ value: 'Manchester', count: 12 }, { value: 'Leeds', count: 10 }, { value: 'manchester', count: 2 }, { value: 'Manchestr', count: 2 }, { value: 'Leads', count: 1 }];
    const issues = findIssues(cols, prof, {
      rows: 40,
      columns: {
        city: { nonNull: 27, distinct: 5, values: counts.map((c) => c.value).sort(), valueCounts: counts },
        phone: { nonNull: 40, distinct: 40, shapes: 2, shapesEx: ['99999 999999', '99999999999'] },
        postcode: { nonNull: 40, distinct: 40, shapes: 3, shapesEx: ['AA9 9AA', 'AA99 9AA', 'AA999AA'] },
        Notes: { nonNull: 40, distinct: 40, shapes: 3, shapesEx: ['Aaaa', 'Aaaa aaaa', 'aaa 99'] },
      },
    });
    // Misspellings come in the order of how common they are; the panel sorts them by value.
    expect(issues.map((i) => i.key)).toEqual(['mixedCase:city', 'nearDuplicate:city:Manchestr', 'nearDuplicate:city:Leads', 'inconsistentShapes:phone', 'inconsistentShapes:postcode']);
    expect(sortIssues(issues, cols.map((c) => c.name)).map((i) => i.key).slice(1, 3)).toEqual(['nearDuplicate:city:Leads', 'nearDuplicate:city:Manchestr']);
    expect(issues[1]).toMatchObject({
      value: 'Manchestr', count: 2, examples: ['Manchestr', 'Manchester'], severity: 'suggest',
      fix: { type: 'replaceValues', params: { match: 'value', find: 'Manchestr', replace: 'Manchester', replaceWithNull: false, matchCase: false, toText: false } },
    });
    expect(issues[2]).toMatchObject({ value: 'Leads', examples: ['Leads', 'Leeds'] });
    // Shapes that differ only by their spaces have a safe fix; others are only noted.
    expect(issues[3]).toMatchObject({ count: 40, examples: ['99999 999999', '99999999999'], severity: 'suggest', fix: { type: 'findReplace', params: { find: ' ', replace: '', regex: false, matchCase: true } } });
    expect(issues[4]).toMatchObject({ severity: 'info', examples: ['AA9 9AA', 'AA99 9AA', 'AA999AA'] });
    expect(issues[4]!.fix).toBeUndefined();
  });

  it('finds untidy names, empty, constant and index columns, wide tables, keys with values, and repeated ids', () => {
    const cols: ColumnSchema[] = [{ name: 'Unnamed: 0', type: 'BIGINT' }, { name: 'Customer ID', type: 'VARCHAR' }, { name: ' Name ', type: 'VARCHAR' }, { name: 'Country', type: 'VARCHAR' }, { name: 'Blank', type: 'VARCHAR' }, { name: 'Jan 2024', type: 'BIGINT' }, { name: 'Feb 2024', type: 'BIGINT' }, { name: 'Mar 2024', type: 'VARCHAR' }, { name: 'Summary', type: 'VARCHAR' }];
    const prof: Record<string, ColumnProfile> = Object.fromEntries(cols.map((c) => [c.name, { empty: 0, distinct: 10, min: 'UK' }]));
    const col = (extra: Partial<ColumnFacts>): ColumnFacts => ({ nonNull: 10, distinct: 10, ...extra });
    const f: AnalysisFacts = {
      rows: 10,
      columns: {
        'Unnamed: 0': col({ seq1: 0, seq0: 10 }),
        'Customer ID': col({ distinct: 8, mode: 'C004' }),
        ' Name ': col({}),
        Country: col({ distinct: 1 }),
        Blank: col({ nonNull: 0, distinct: 0 }),
        'Jan 2024': col({}),
        'Feb 2024': col({}),
        'Mar 2024': col({}),
        Summary: col({ keyValues: 9, keyValueSep: ':', keyValueEx: 'Total: 1,234' }),
      },
    };
    const issues = findIssues(cols, prof, f);
    const by = Object.fromEntries(issues.map((i) => [i.key, i]));
    expect(issues.map((i) => i.key)).toEqual(['untidyNames', 'wideTable', 'indexColumn:Unnamed: 0', 'idDuplicates:Customer ID', 'constantColumn:Country', 'emptyColumn:Blank', 'keyValue:Summary']);
    expect(by.untidyNames).toMatchObject({ count: 1, examples: [' Name '], severity: 'fix', fix: { type: 'renameColumns', params: { renames: [{ from: ' Name ', to: 'Name' }] } } });
    expect(by.wideTable).toMatchObject({ count: 3, severity: 'suggest', fix: { type: 'unpivot', params: { columns: ['Jan 2024', 'Feb 2024', 'Mar 2024'], except: false, attribute: 'month', value: 'value', keepEmpty: true, asText: true } } });
    expect(by['indexColumn:Unnamed: 0']).toMatchObject({ severity: 'suggest', fix: { type: 'removeColumns' } });
    expect(by['idDuplicates:Customer ID']).toMatchObject({ count: 2, examples: ['C004'], severity: 'info' });
    expect(by['constantColumn:Country']).toMatchObject({ examples: ['UK'], severity: 'info' });
    expect(by['emptyColumn:Blank']).toMatchObject({ count: 10, severity: 'fix', fix: { type: 'removeColumns' } });
    expect(by['keyValue:Summary']).toMatchObject({ severity: 'suggest', examples: ['Total: 1,234'], fix: { label: 'Split by delimiter', steps: [{ type: 'splitByDelimiter', params: { column: 'Summary', delimiterKind: 'colon', at: 'left', to: 'columns', into: ['Summary key', 'Summary value'] } }, { type: 'trimWhitespace', params: { columns: ['Summary key', 'Summary value'] } }] } });
    // In snake_case style, every name that isn't snake_case already is renamed.
    const snake = findIssues(cols, prof, { ...f, columnNames: 'snake' }).find((i) => i.kind === 'untidyNames')!;
    expect((snake.fix as StepFix).params?.renames).toEqual([
      { from: 'Unnamed: 0', to: 'unnamed_0' }, { from: 'Customer ID', to: 'customer_id' }, { from: ' Name ', to: 'name' }, { from: 'Country', to: 'country' }, { from: 'Blank', to: 'blank' },
      { from: 'Jan 2024', to: 'jan_2024' }, { from: 'Feb 2024', to: 'feb_2024' }, { from: 'Mar 2024', to: 'mar_2024' }, { from: 'Summary', to: 'summary' },
    ]);
    // Repeated ids that come from whole duplicate rows are the duplicates' problem, not the id's; a small table says nothing about constants or indexes.
    expect(findIssues(cols, prof, { ...f, dups: 2 }).some((i) => i.kind === 'idDuplicates')).toBe(false);
    expect(findIssues(cols, prof, { ...f, rows: 3 }).map((i) => i.kind)).not.toContain('constantColumn');
  });

  it('knows the boolean pairs, the formats of numbers that stand for dates, and the columns named for periods', () => {
    expect(booleanPair(['Yes', 'no', 'N/A'])).toEqual({ pair: ['yes', 'no'], severity: 'fix' });
    expect(booleanPair(['TRUE', 'FALSE'])).toEqual({ pair: ['true', 'false'], severity: 'fix' });
    expect(booleanPair(['Yes'])).toBeUndefined();
    expect(booleanPair(['Yes', 'No', 'Maybe'])).toBeUndefined();
    expect(serialDateFormat(44_000, 45_900)).toBe('excel serial');
    expect(serialDateFormat(1_600_000_000, 1_700_000_000)).toBe('unix seconds');
    expect(serialDateFormat(1_600_000_000_000, 1_700_000_000_000)).toBe('unix milliseconds');
    expect(serialDateFormat(1, 44)).toBeUndefined();
    expect(periodColumns(['store', 'jan_2024', 'feb_2024', 'mar_2024'])).toEqual(['jan_2024', 'feb_2024', 'mar_2024']);
    expect(periodColumns(['region', '2022', '2023', '2024', 'manager'])).toEqual(['2022', '2023', '2024']);
    expect(periodColumns(['region', 'q1', 'q2', 'q3', 'manager'])).toEqual(['q1', 'q2', 'q3']);
    expect(periodColumns(['region', 'q1', 'manager'])).toEqual([]);
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
