import { describe, expect, it } from 'vitest';
import { identIn, strIn } from './sql';

describe('quoting for another database', () => {
  it('quotes identifiers the way each one does', () => {
    expect(identIn('postgres', 'order "x"')).toBe('"order ""x"""');
    expect(identIn('mysql', 'a`b')).toBe('`a``b`');
    expect(identIn('sqlserver', 'a]b')).toBe('[a]]b]');
    expect(identIn('sqlite', 'a')).toBe('"a"');
  });

  it('quotes strings, with MySQL’s backslashes and SQL Server’s Unicode prefix', () => {
    expect(strIn('postgres', "it's")).toBe("'it''s'");
    expect(strIn('mysql', 'C:\\temp')).toBe("'C:\\\\temp'");
    expect(strIn('sqlserver', 'café')).toBe("N'café'");
    expect(strIn('sqlserver', 'cafe')).toBe("'cafe'");
  });
});
