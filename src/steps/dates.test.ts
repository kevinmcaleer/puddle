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
