import { describe, expect, it } from 'vitest';
import { stepDef } from '../compiler';
import { decimalFor, QUICK_FIXES, type FixContext } from './fixes';

const ctx = (over: Partial<FixContext> = {}): FixContext => ({
  columns: ['name', 'city'],
  available: [
    { name: 'name', type: 'VARCHAR' },
    { name: 'city', type: 'VARCHAR' },
  ],
  locale: 'en-GB',
  detectDates: async () => ({ ranked: [], best: '%d/%m/%Y' }),
  ...over,
});

describe('quick fixes', () => {
  it('there are at most eight, and each makes one valid step on every selected column', async () => {
    expect(QUICK_FIXES.length).toBeLessThanOrEqual(8);
    for (const fix of QUICK_FIXES) {
      const step = await fix.build(ctx(), fix.options?.[0]?.id);
      expect(stepDef(step.type)!.params.safeParse(step.params).success, fix.id).toBe(true);
      expect(step.params.columns, fix.id).toEqual(['name', 'city']);
      expect(step.label, fix.id).toMatch(/name, city/);
    }
  });

  it('case uses the option picked', async () => {
    const fix = QUICK_FIXES.find((f) => f.id === 'changeCase')!;
    expect((await fix.build(ctx(), 'upper')).label).toBe('Changed name, city to upper case');
  });

  it('parse dates uses the detected format, and leaves an ambiguous order to the user', async () => {
    const fix = QUICK_FIXES.find((f) => f.id === 'parseDates')!;
    expect((await fix.build(ctx())).params.formats).toEqual(['%d/%m/%Y']);
    const ambiguous = await fix.build(ctx({ detectDates: async () => ({ ranked: [], ambiguous: { dayFirst: '%d/%m/%Y', monthFirst: '%m/%d/%Y' } }) }));
    expect(ambiguous.params.formats).toEqual([]);
  });

  it('parse numbers reads the decimal mark from the locale', async () => {
    expect(decimalFor('en-GB')).toBe('.');
    expect(decimalFor('de-DE')).toBe(',');
    const fix = QUICK_FIXES.find((f) => f.id === 'parseNumbers')!;
    expect((await fix.build(ctx({ locale: 'fr-FR' }))).params.decimal).toBe(',');
  });

  it('parse numbers keeps the project locale on the step, so it reads the same on any machine', async () => {
    const fix = QUICK_FIXES.find((f) => f.id === 'parseNumbers')!;
    expect((await fix.build(ctx({ locale: 'de-DE' }))).params).toMatchObject({ decimal: ',', locale: 'de-DE' });
    expect(decimalFor('de-CH')).toBe('.');
  });
});
