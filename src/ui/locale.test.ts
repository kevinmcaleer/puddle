import { afterEach, describe, expect, it, vi } from 'vitest';
import { browserLocale, resolveDisplay, useDisplay } from './locale';

afterEach(() => vi.unstubAllGlobals());

describe('display locale', () => {
  it('follows the browser’s language by default, falling back to en-GB', () => {
    vi.stubGlobal('navigator', { languages: ['de-CH', 'de'], language: 'de-CH' });
    expect(browserLocale()).toBe('de-CH');
    expect(resolveDisplay({ locale: 'browser', dates: 'locale' })).toEqual({ locale: 'de-CH', dates: 'locale' });
    vi.stubGlobal('navigator', { languages: [], language: 'not a locale!' });
    expect(browserLocale()).toBe('en-GB');
  });

  it('a picked locale wins over the browser’s', () => {
    vi.stubGlobal('navigator', { languages: ['en-US'], language: 'en-US' });
    expect(resolveDisplay({ locale: 'fr-FR', dates: 'iso' })).toEqual({ locale: 'fr-FR', dates: 'iso' });
  });

  it('changing the preference replaces the format, and only then', () => {
    const before = useDisplay.getState().format;
    expect(useDisplay.getState().format).toBe(before);
    useDisplay.getState().setPreference({ locale: 'de-DE' });
    expect(useDisplay.getState().format).toEqual({ locale: 'de-DE', dates: before.dates });
    useDisplay.getState().setPreference({ dates: 'iso' });
    expect(useDisplay.getState().format).toEqual({ locale: 'de-DE', dates: 'iso' });
    useDisplay.getState().setPreference({ locale: 'browser', dates: 'locale' });
  });
});
