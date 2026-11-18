import { describe, expect, it } from 'vitest';
import { CANDIDATE_FORMATS } from '../dates/formats';
import { NUMBER_DATE_FORMATS } from './dateRead';
import { formatFromWords, formatsFromWords, formatWords } from './dateWords';

describe('date formats in words', () => {
  it('writes the common formats as people do', () => {
    expect(formatWords('%d/%m/%Y')).toBe('DD/MM/YYYY');
    expect(formatWords('%Y-%m-%d %H:%M:%S')).toBe('YYYY-MM-DD hh:mm:ss');
    expect(formatWords('%d %b %y')).toBe('DD Mon YY');
    expect(formatWords('%B %d, %Y')).toBe('Month DD, YYYY');
    expect(formatWords('%m/%d/%Y %I:%M %p')).toBe('MM/DD/YYYY hh:mm AM');
    expect(formatWords('%Y-%m-%dT%H:%M:%S.%f%z')).toBe('YYYY-MM-DDThh:mm:ss.ffffff+hh:mm');
    expect(formatWords('excel serial')).toBe('Excel serial number');
    // A code with no word of its own stays a code.
    expect(formatWords('%j of %Y')).toBe('%j of YYYY');
  });

  it('reads every format Parse dates detects back from its words', () => {
    expect(CANDIDATE_FORMATS.length).toBeGreaterThan(80);
    for (const f of [...CANDIDATE_FORMATS, ...Object.keys(NUMBER_DATE_FORMATS)]) expect(formatFromWords(formatWords(f)), f).toBe(f);
  });

  it('still takes the codes, alone or mixed with words', () => {
    for (const f of CANDIDATE_FORMATS) expect(formatFromWords(f), f).toBe(f);
    expect(formatFromWords('DD/MM/%Y')).toBe('%d/%m/%Y');
    expect(formatFromWords('  %d %B %Y ')).toBe('%d %B %Y');
    expect(formatFromWords('%j of YYYY')).toBe('%j of %Y');
  });

  it('reads hours on the 12 hour clock only beside AM or PM', () => {
    expect(formatFromWords('hh:mm')).toBe('%H:%M');
    expect(formatFromWords('hh:mm AM')).toBe('%I:%M %p');
    expect(formatFromWords('hh:mm PM')).toBe('%I:%M %p');
  });

  it('reads a number format by its name, and a list separated by commas', () => {
    expect(formatFromWords('excel serial number')).toBe('excel serial');
    expect(formatFromWords('Unix time in seconds')).toBe('unix seconds');
    expect(formatsFromWords('DD/MM/YYYY, YYYY-MM-DD,')).toEqual(['%d/%m/%Y', '%Y-%m-%d']);
    expect(formatsFromWords('%d/%m/%Y, %Y-%m-%d')).toEqual(['%d/%m/%Y', '%Y-%m-%d']);
  });
});
