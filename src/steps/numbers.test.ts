import { describe, expect, it } from 'vitest';
import { newStep, stepForm, textColumnsProblem } from '.';
import { formatExample } from './dates';
import { bucketPreview } from './numbers';

const available = [
  { name: 'name', type: 'VARCHAR' },
  { name: 'joined', type: 'DATE' },
  { name: 'left_at', type: 'TIMESTAMP' },
  { name: 'price', type: 'DOUBLE' },
  { name: 'qty', type: 'BIGINT' },
];

describe('date and number step defaults', () => {
  it('start from the selected columns, else the first column of the type the step needs', () => {
    expect(newStep('extractDatePart', { selected: [], available }).params).toEqual({ columns: ['joined'], part: 'year', replace: false });
    expect(newStep('roundNumbers', { selected: [], available }).params).toMatchObject({ columns: ['price'], mode: 'places', places: 0 });
    expect(newStep('absoluteValue', { selected: ['qty'], available }).params).toEqual({ columns: ['qty'] });
    expect(newStep('bucketNumbers', { selected: [], available }).params).toMatchObject({ column: 'price', into: 'price_bucket' });
  });

  it('keep the time when adding to a timestamp, and offer a number column for the amount', () => {
    expect(newStep('shiftDates', { selected: ['left_at'], available }).params).toMatchObject({ columns: ['left_at'], keepTime: true, amountColumn: 'price' });
    expect(newStep('shiftDates', { selected: [], available }).params).toMatchObject({ columns: ['joined'], keepTime: false, amount: 1, unit: 'days' });
  });

  it('measure between the first two date columns', () => {
    const step = newStep('dateDifference', { selected: [], available });
    expect(step.params).toEqual({ start: 'joined', end: 'left_at', unit: 'days', into: 'difference' });
    expect(step.label).toBe('Added days from joined to left_at as difference');
  });

  it('with no column of the right type, ask for one', () => {
    const text = [{ name: 'name', type: 'VARCHAR' }];
    expect(newStep('truncateDates', { selected: [], available: text }).label).toBe('Truncate dates');
    expect(newStep('standardise', { selected: [], available: text }).label).toBe('Standardise');
  });

  it('put the new groups in the Add step menu', () => {
    expect(['extractDatePart', 'shiftDates', 'dateDifference', 'truncateDates', 'formatDates'].map((t) => stepForm(t)!.group)).toEqual(Array(5).fill('Dates'));
    expect(['roundNumbers', 'absoluteValue', 'bucketNumbers', 'standardise', 'convertUnits'].map((t) => stepForm(t)!.group)).toEqual(Array(5).fill('Numbers'));
  });
});

describe('text given to a date or number step', () => {
  const dates = { expects: 'date' as const };
  it('points at parse dates or parse numbers', () => {
    expect(textColumnsProblem(dates, ['joined', 'name'], available)).toBe('name is text. Add a Parse dates step before this one to read it as dates.');
    expect(textColumnsProblem({ expects: 'number' }, 'name', available)).toBe('name is text. Add a Parse numbers step before this one to read it as numbers.');
    const two = [...available, { name: 'note', type: 'VARCHAR' }];
    expect(textColumnsProblem(dates, ['name', 'note'], two)).toBe('name, note are text. Add a Parse dates step before this one to read them as dates.');
  });

  it('is quiet for the right types, missing columns and fields that take anything', () => {
    expect(textColumnsProblem(dates, ['joined', 'left_at'], available)).toBeUndefined();
    expect(textColumnsProblem(dates, ['gone'], available)).toBeUndefined();
    expect(textColumnsProblem({}, ['name'], available)).toBeUndefined();
  });
});

describe('live hints', () => {
  it('shows what a date format makes', () => {
    expect(formatExample('%d %B %Y')).toBe('Friday 1 March 2024 at 14:05:09 becomes 01 March 2024');
    expect(formatExample('%Q')).toMatch(/can’t be previewed/);
    expect(formatExample('')).toBeUndefined();
  });

  it('shows the buckets before they run', () => {
    expect(bucketPreview({ mode: 'width', width: 10, start: 0 })).toBe('Buckets like 0 to under 10, 10 to under 20');
    expect(bucketPreview({ mode: 'width', width: 0.5, start: 0 })).toBe('Buckets like 0.0 to under 0.5, 0.5 to under 1.0');
    expect(bucketPreview({ mode: 'edges', edges: [18, 65] })).toBe('Buckets: under 18; 18 to under 65; 65 and over');
    expect(bucketPreview({ mode: 'edges', edges: [65, 18] })).toBeUndefined();
  });
});
