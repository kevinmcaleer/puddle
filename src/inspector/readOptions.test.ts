import { describe, expect, it } from 'vitest';
import { readOptionsOpen } from './readOptions';

const stepFix = { fix: { type: 'trimWhitespace', params: {} } } as never;
const readFix = { fix: { readOptions: { skip: 2 } } } as never;

describe('when a source’s read options start open', () => {
  it('stay folded for a file that reads cleanly, with or without issues that steps fix', () => {
    expect(readOptionsOpen({ state: 'ok', issues: [] })).toBe(false);
    expect(readOptionsOpen({ state: 'ok', issues: [stepFix, { fix: undefined }] })).toBe(false);
    expect(readOptionsOpen({ state: 'other', issues: [] })).toBe(false);
  });

  it('open when the source can’t be read', () => {
    expect(readOptionsOpen({ state: 'error', issues: [] })).toBe(true);
  });

  it('open for a Word or PDF document, whose options pick the table that is read', () => {
    expect(readOptionsOpen({ state: 'ok', issues: [], format: 'pdf' })).toBe(true);
    expect(readOptionsOpen({ state: 'ok', issues: [], format: 'word' })).toBe(true);
    expect(readOptionsOpen({ state: 'ok', issues: [], format: 'csv' })).toBe(false);
  });

  it('open when an issue is fixed by a read option', () => {
    expect(readOptionsOpen({ state: 'ok', issues: [stepFix, readFix] })).toBe(true);
  });

  it('follow a choice made by hand, whatever the source says', () => {
    expect(readOptionsOpen({ state: 'ok', issues: [] }, true)).toBe(true);
    expect(readOptionsOpen({ state: 'error', issues: [readFix] }, false)).toBe(false);
  });
});
