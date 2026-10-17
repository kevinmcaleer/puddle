import { describe, expect, it } from 'vitest';
import { newStep } from '.';

const available = [{ name: 'when', type: 'VARCHAR' }];

describe('parse dates defaults', () => {
  it('uses the detected format', () => {
    const step = newStep('parseDates', { selected: [], available, dates: { ranked: [], best: '%d %B %Y' } });
    expect(step.params).toEqual({ columns: ['when'], formats: ['%d %B %Y'], onError: 'empty' });
    expect(step.label).toBe('Parsed when as dates');
  });

  it('leaves the format to the user when day and month order is ambiguous', () => {
    const step = newStep('parseDates', { selected: [], available, dates: { ranked: [], ambiguous: { dayFirst: '%d/%m/%Y', monthFirst: '%m/%d/%Y' } } });
    expect(step.params).toMatchObject({ formats: [] });
    expect(step.label).toBe('Parse dates');
  });
});

describe('parse dates locale', () => {
  it('has no locale unless one is picked, so an unclear order is still asked', () => {
    const step = newStep('parseDates', { selected: [], available, locale: 'en-US', dates: { ranked: [], ambiguous: { dayFirst: '%d/%m/%Y', monthFirst: '%m/%d/%Y' } } });
    expect(step.params.locale).toBeUndefined();
  });
});

describe('parse numbers locale', () => {
  it('starts with the project locale, which sets the decimal mark', () => {
    expect(newStep('parseNumbers', { selected: [], available, locale: 'de-DE' }).params).toEqual({ columns: ['when'], decimal: ',', locale: 'de-DE' });
    expect(newStep('parseNumbers', { selected: [], available, locale: 'en-US' }).label).toBe('Parsed numbers in when (English (US))');
  });

  it('falls back to the decimal mark for a locale the step doesn’t know, and for none', () => {
    expect(newStep('parseNumbers', { selected: [], available, locale: 'sv-SE', decimal: ',' }).params).toEqual({ columns: ['when'], decimal: ',', locale: '' });
    expect(newStep('parseNumbers', { selected: [], available }).params).toEqual({ columns: ['when'], decimal: '.', locale: '' });
  });
});
