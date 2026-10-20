import { describe, expect, it } from 'vitest';
import type { ColumnSchema } from '../model';
import { defaultTicked, fixGroup, fixLabel, planFixes } from './fixes';
import { issueKey, type Issue } from './issues';

const col = (name: string, type = 'VARCHAR'): ColumnSchema => ({ name, type });
const available = [col('name'), col('city'), col('amount'), col('joined')];
const issue = (kind: Issue['kind'], column: string | undefined, fix: Issue['fix'], severity: Issue['severity'] = 'fix'): Issue => ({
  key: issueKey(kind, column),
  kind,
  column,
  count: 1,
  examples: [],
  severity,
  fix,
});
const issues: Issue[] = [
  issue('duplicateRows', undefined, { type: 'duplicateRows', params: { columns: [], keep: 'first' } }),
  issue('edgeSpaces', 'name', { type: 'trimWhitespace' }),
  issue('nonPrinting', 'city', { type: 'removeNonPrinting' }),
  issue('edgeSpaces', 'city', { type: 'trimWhitespace' }),
  issue('mixedCase', 'city', { type: 'changeCase', params: { mode: 'title' } }),
  issue('mixedCase', 'name', { type: 'changeCase', params: { mode: 'upper' } }),
  issue('numbersAsText', 'amount', { type: 'parseNumbers' }, 'suggest'),
  issue('datesAsText', 'joined', { type: 'parseDates' }, 'suggest'),
];

describe('planning fixes', () => {
  it('makes one step per fix type over every column it applies to, hidden characters first and duplicates last', async () => {
    const { steps } = await planFixes(issues, { available, locale: 'en-GB' });
    expect(steps.map((s) => [s.type, s.params.columns])).toEqual([
      ['removeNonPrinting', ['city']],
      ['trimWhitespace', ['name', 'city']],
      ['changeCase', ['city']],
      ['changeCase', ['name']],
      ['parseNumbers', ['amount']],
      ['parseDates', ['joined']],
      ['duplicateRows', []],
    ]);
    // Settings that differ keep their own step: Title case for city, UPPER for name.
    expect(steps.filter((s) => s.type === 'changeCase').map((s) => s.params.mode)).toEqual(['title', 'upper']);
    expect(steps.find((s) => s.type === 'duplicateRows')?.params).toMatchObject({ keep: 'first' });
    // Each step is labelled as the Add menu would label it, and has its own id.
    expect(new Set(steps.map((s) => s.id)).size).toBe(steps.length);
    expect(steps.every((s) => s.label.length > 0 && s.enabled)).toBe(true);
  });

  it('expands a fix of several steps, adds up the values to read as empty across columns, and keeps a step’s own settings', async () => {
    const planned = await planFixes(
      [
        issue('placeholders', 'city', { steps: [{ type: 'replaceValues', params: { match: 'value', find: 'n/a', replace: '', replaceWithNull: true, matchCase: false, toText: false } }, { type: 'replaceValues', params: { match: 'value', find: '-', replace: '', replaceWithNull: true, matchCase: false, toText: false } }], label: 'Replace values' }),
        issue('placeholders', 'name', { steps: [{ type: 'replaceValues', params: { match: 'value', find: 'n/a', replace: '', replaceWithNull: true, matchCase: false, toText: false } }], label: 'Replace values' }),
        issue('placeholders', 'amount', { readOptions: { nullStrings: ['n/a', '-'] }, label: 'Read as empty' }),
        issue('placeholders', 'joined', { readOptions: { nullStrings: ['?', 'n/a'] }, label: 'Read as empty' }),
        issue('untidyNames', undefined, { type: 'renameColumns', params: { renames: [{ from: 'name', to: 'Name' }] } }),
        issue('keyValue', 'joined', { steps: [{ type: 'splitByDelimiter', params: { column: 'joined', delimiterKind: 'colon', delimiter: '', at: 'left', to: 'columns', quote: '', into: ['joined key', 'joined value'], keepOriginal: false } }, { type: 'trimWhitespace', params: { columns: ['joined key', 'joined value'] } }], label: 'Split by delimiter' }),
        issue('serialDates', 'amount', { type: 'parseDates', params: { formats: ['excel serial'] } }, 'suggest'),
        issue('emptyColumn', 'city', { type: 'removeColumns' }),
      ],
      { available, locale: 'en-GB', detectDates: async () => ({ formats: ['%d/%m/%Y'] }) as never },
    );
    expect(planned.readOptions).toEqual({ nullStrings: ['n/a', '-', '?'] });
    // One Replace values per placeholder, over every column it was seen in; the column steps after the value steps, Rename last.
    expect(planned.steps.map((s) => [s.type, s.params.columns ?? s.params.column ?? s.params.renames])).toEqual([
      ['replaceValues', ['city', 'name']],
      ['replaceValues', ['city']],
      ['parseDates', ['amount']],
      ['removeColumns', ['city']],
      ['splitByDelimiter', 'joined'],
      ['trimWhitespace', ['joined key', 'joined value']],
      ['renameColumns', [{ from: 'name', to: 'Name' }]],
    ]);
    expect(planned.steps[0]!.params).toMatchObject({ find: 'n/a', replaceWithNull: true, matchCase: false });
    // Formats the issue names are kept rather than detected; a step that names its own column gets no columns list.
    expect(planned.steps[2]!.params.formats).toEqual(['excel serial']);
    expect(planned.steps[4]!.params).not.toHaveProperty('columns');
    expect(planned.steps[4]!.params.into).toEqual(['joined key', 'joined value']);
  });

  it('reads the locale’s decimal mark into Parse numbers and the detected formats into Parse dates', async () => {
    const { steps } = await planFixes(issues, { available, locale: 'de-DE', detectDates: async () => ({ formats: ['%d.%m.%Y'] }) as never });
    expect(steps.find((s) => s.type === 'parseNumbers')?.params).toMatchObject({ decimal: ',' });
    expect(steps.find((s) => s.type === 'parseDates')?.params).toMatchObject({ formats: ['%d.%m.%Y'] });
    // No detector: the step is added with no formats, for the user to settle.
    const { steps: bare } = await planFixes(issues, { available, locale: 'en-GB' });
    expect(bare.find((s) => s.type === 'parseDates')?.params).toMatchObject({ formats: [] });
  });

  it('skips issues with nothing to apply', async () => {
    const none = issue('mixedCase', 'name', undefined, 'info');
    expect(await planFixes([none], { available, locale: 'en-GB' })).toEqual({ steps: [], readOptions: {} });
  });

  it('gathers read-option fixes apart from the steps, later ones over earlier', async () => {
    const top: Issue = { key: 'bannerRows', kind: 'bannerRows', count: 3, examples: [], severity: 'fix', fix: { readOptions: { skip: 3 }, label: 'Skip 3 lines at the top' } };
    const bottom: Issue = { key: 'footerRows', kind: 'footerRows', count: 1, examples: [], severity: 'fix', fix: { readOptions: { skipBottom: 1 }, label: 'Skip 1 row at the bottom' } };
    expect(await planFixes([top, bottom, issues[1]!], { available, locale: 'en-GB' })).toMatchObject({ readOptions: { skip: 3, skipBottom: 1 }, steps: [{ type: 'trimWhitespace' }] });
    expect(fixGroup(top)).toBe('Read options');
    expect(fixLabel(top)).toBe('Skip 3 lines at the top');
    expect(fixLabel(issues[1]!)).toBe('Trim whitespace');
  });

  it('ticks every fix by default, and the suggestions only when the project says so', () => {
    expect(defaultTicked(issues, false)).toEqual(issues.filter((i) => i.severity === 'fix').map((i) => i.key));
    expect(defaultTicked(issues, true)).toEqual(issues.map((i) => i.key));
  });

  it('files each fix under its step’s group', () => {
    expect(fixGroup(issues[0]!)).toBe('Rows');
    expect(fixGroup(issues[1]!)).toBe('Clean');
    expect(fixGroup(issue('mixedCase', 'name', undefined, 'info'))).toBeUndefined();
  });
});
