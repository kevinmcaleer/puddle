import { describe, expect, it } from 'vitest';
import { schemaErrors } from '../../steps/forms';
import { bucketLabels, bucketNumbers, convertUnits, decimalsOf, roundNumbers, UNITS } from './numbers';
import { dateDifference, extractDatePart, partColumn, shiftDates, truncateDates } from './dates';

describe('number step helpers', () => {
  it('counts the decimals a number is written with', () => {
    expect([decimalsOf(5), decimalsOf(0.25), decimalsOf(-1.5), decimalsOf(1e-7), decimalsOf(1.5e-7)]).toEqual([0, 2, 1, 7, 8]);
  });

  it('labels custom buckets so each edge belongs to the bucket above it', () => {
    expect(bucketLabels([18, 65])).toEqual(['under 18', '18 to under 65', '65 and over']);
    expect(bucketLabels([0.5])).toEqual(['under 0.5', '0.5 and over']);
  });

  it('every unit has a kind, and converting across kinds is refused', () => {
    for (const u of Object.values(UNITS)) expect(['length', 'weight', 'volume', 'temperature']).toContain(u.kind);
    expect(schemaErrors(convertUnits.params, { columns: ['x'], from: 'kg', to: 'm' })).toEqual({ to: 'Convert to a unit of the same kind.' });
    expect(schemaErrors(convertUnits.params, { columns: ['x'], from: 'kg', to: 'lb' })).toEqual({});
  });

  it('says what is missing from round and bucket', () => {
    expect(schemaErrors(roundNumbers.params, { columns: ['x'], mode: 'nearest', places: 0 })).toEqual({ nearest: 'Give the number to round to.' });
    expect(schemaErrors(roundNumbers.params, { columns: ['x'], mode: 'places', places: -1 })).toEqual({ places: 'Use 0 or more places.' });
    expect(schemaErrors(bucketNumbers.params, { column: 'x', mode: 'edges', edges: [10, 5], into: 'b' })).toEqual({ edges: 'List edges from smallest to largest.' });
    expect(schemaErrors(bucketNumbers.params, { column: 'x', mode: 'edges', edges: [], into: 'b' })).toEqual({ edges: 'Give at least one edge, as numbers.' });
    expect(schemaErrors(bucketNumbers.params, { column: 'x', mode: 'width', edges: [], into: 'b' })).toEqual({ width: 'Give the bucket width.' });
  });

  it('labels number steps in the past tense', () => {
    expect(roundNumbers.label(roundNumbers.params.parse({ columns: ['price'], mode: 'places', places: 2 }))).toBe('Rounded price to 2 decimal places');
    expect(roundNumbers.label(roundNumbers.params.parse({ columns: ['price'], mode: 'up', places: 0 }))).toBe('Rounded price up to whole numbers');
    expect(roundNumbers.label(roundNumbers.params.parse({ columns: ['price'], mode: 'nearest', nearest: 5 }))).toBe('Rounded price to the nearest 5');
    expect(convertUnits.label({ columns: ['t'], from: 'f', to: 'c' })).toBe('Converted t from Fahrenheit to Celsius');
    expect(convertUnits.label({ columns: ['v'], from: 'ukpt', to: 'ml' })).toBe('Converted v from pints (UK) to millilitres');
  });
});

describe('date step helpers', () => {
  it('names a new part column after the date and the part', () => {
    expect(partColumn('joined', 'year')).toBe('joined_year');
    expect(partColumn('joined', 'weekdayName')).toBe('joined_weekday_name');
  });

  it('labels date steps in the past tense', () => {
    expect(extractDatePart.label({ columns: ['joined'], part: 'monthName', replace: false })).toBe('Extracted month name from joined');
    expect(shiftDates.label(shiftDates.params.parse({ columns: ['due'], direction: 'add', amount: 1, unit: 'days' }))).toBe('Added 1 day to due');
    expect(shiftDates.label(shiftDates.params.parse({ columns: ['due'], direction: 'subtract', amount: 3, unit: 'weeks' }))).toBe('Subtracted 3 weeks from due');
    expect(shiftDates.label(shiftDates.params.parse({ columns: ['due'], by: 'column', amountColumn: 'grace', unit: 'days' }))).toBe('Added the days in grace to due');
    expect(dateDifference.label({ start: 'a', end: 'b', unit: 'months', into: 'm' })).toBe('Added months from a to b as m');
    expect(truncateDates.label({ columns: ['d'], to: 'week' })).toBe('Truncated d to the week');
  });

  it('asks for the amount the add or subtract step uses', () => {
    expect(schemaErrors(shiftDates.params, { columns: ['d'], by: 'fixed', unit: 'days' })).toEqual({ amount: 'Give the amount.' });
    expect(schemaErrors(shiftDates.params, { columns: ['d'], by: 'column', amountColumn: '', unit: 'days' })).toEqual({ amountColumn: 'Pick the column with the amounts.' });
    expect(schemaErrors(shiftDates.params, { columns: ['d'], by: 'fixed', amount: -1, unit: 'days' })).toEqual({ amount: 'Use a positive amount; choose subtract to go back.' });
  });
});
