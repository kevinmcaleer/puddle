import { describe, expect, it } from 'vitest';
import { strftime } from './strftime';

describe('strftime preview', () => {
  it('writes the example date the way DuckDB would', () => {
    expect(strftime('%d/%m/%Y')).toBe('01/03/2024');
    expect(strftime('%A %-d %B %Y')).toBe('Friday 1 March 2024');
    expect(strftime('%a %d %b %y, %I:%M %p')).toBe('Fri 01 Mar 24, 02:05 PM');
    expect(strftime('%Y-%m-%dT%H:%M:%S')).toBe('2024-03-01T14:05:09');
    expect(strftime('day %j, 100%%')).toBe('day 061, 100%');
  });

  it('takes another date, read as UTC', () => {
    expect(strftime('%-I %p on %e', new Date(Date.UTC(2023, 11, 5, 0, 30)))).toBe('12 AM on  5');
  });

  it('gives up on a specifier it does not know, or a stray % at the end', () => {
    expect(strftime('%Q')).toBeUndefined();
    expect(strftime('%Y %')).toBeUndefined();
  });
});
