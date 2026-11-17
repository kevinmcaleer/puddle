import { describe, expect, it } from 'vitest';
import { FILE_FORMATS, WELCOME_FORMATS, welcomeFormats } from './formats';
import { ACCEPT, knownFormat } from './detect';

describe('the formats the empty canvas names', () => {
  it('are all formats a file can be read as', () => {
    for (const f of WELCOME_FORMATS) expect(FILE_FORMATS).toContain(f);
  });

  it('each have an extension the file chooser accepts', () => {
    const accepted = ACCEPT.split(',').map((ext) => knownFormat(`file${ext}`));
    for (const f of WELCOME_FORMATS) expect(accepted).toContain(f);
  });

  it('are named as the rest of the app names them, Excel first, and admit there are more', () => {
    expect(welcomeFormats()).toBe('Excel, CSV, JSON, Parquet, Access and most other data files');
    expect(WELCOME_FORMATS.length).toBeLessThan(FILE_FORMATS.length);
  });
});
