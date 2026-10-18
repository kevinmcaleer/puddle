import { describe, expect, it } from 'vitest';
import { stepDef } from '../compiler';
import { STEP_GROUPS, stepForm } from '../steps';
import { decimalFor, QUICK_FIXES, type FixContext } from './fixes';

const ctx = (over: Partial<FixContext> = {}): FixContext => ({
  columns: ['name', 'city'],
  available: [
    { name: 'name', type: 'VARCHAR' },
    { name: 'city', type: 'VARCHAR' },
  ],
  locale: 'en-GB',
  detectDates: async () => ({ ranked: [], formats: ['%d/%m/%Y', '%d %B %Y'] }),
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

  it('each carries its step’s Add menu group, and the chips come in the menu’s group order', () => {
    for (const fix of QUICK_FIXES) expect(fix.group, fix.id).toBe(stepForm(fix.id)!.group);
    const order = QUICK_FIXES.map((f) => STEP_GROUPS.indexOf(f.group));
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(QUICK_FIXES.map((f) => f.id)).toEqual(['trimWhitespace', 'collapseSpaces', 'emptyToNull', 'removeNonPrinting', 'parseNumbers', 'parseDates', 'duplicateRows', 'changeCase']);
  });

  it('case uses the option picked', async () => {
    const fix = QUICK_FIXES.find((f) => f.id === 'changeCase')!;
    expect((await fix.build(ctx(), 'upper')).label).toBe('Changed name, city to upper case');
  });

  it('parse dates uses the detected formats, and leaves an ambiguous order to the user', async () => {
    const fix = QUICK_FIXES.find((f) => f.id === 'parseDates')!;
    expect((await fix.build(ctx())).params.formats).toEqual(['%d/%m/%Y', '%d %B %Y']);
    const ambiguous = await fix.build(ctx({ detectDates: async () => ({ ranked: [], ambiguous: { dayFirst: '%d/%m/%Y', monthFirst: '%m/%d/%Y', covers: { day: ['%d/%m/%Y'], month: ['%m/%d/%Y'] } } }) }));
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
