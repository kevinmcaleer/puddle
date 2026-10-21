import { describe, expect, it } from 'vitest';
import { bearer, tokenMatches } from './auth';

describe('the bearer token', () => {
  it('is read from the Authorization header', () => {
    expect(bearer('Bearer abc')).toBe('abc');
    expect(bearer('bearer   abc  ')).toBe('abc');
    expect(bearer(['Bearer first', 'Bearer second'])).toBe('first');
    expect(bearer('Basic abc')).toBeUndefined();
    expect(bearer(undefined)).toBeUndefined();
    expect(bearer('Bearer')).toBeUndefined();
  });

  it('matches only the expected token, whatever its length, and never an empty expectation', () => {
    expect(tokenMatches('secret', 'secret')).toBe(true);
    expect(tokenMatches('secre', 'secret')).toBe(false);
    expect(tokenMatches('secret!', 'secret')).toBe(false);
    expect(tokenMatches(undefined, 'secret')).toBe(false);
    expect(tokenMatches('', 'secret')).toBe(false);
    expect(tokenMatches('', '')).toBe(false);
    expect(tokenMatches(undefined, '')).toBe(false);
  });
});
