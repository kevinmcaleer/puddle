import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ruleForms } from '../src/rules';
import { stepForms } from '../src/steps';

// The user guide in docs/ (built with Sphinx): its pictures and its references to the app's steps and rules.
const DOCS = join(import.meta.dirname, '../docs');
const SHOTS = join(DOCS, '_static/screenshots');

const pages = readdirSync(DOCS)
  .filter((f) => f.endsWith('.md') && f !== 'README.md')
  .map((f) => ({ name: f, text: readFileSync(join(DOCS, f), 'utf8') }));
const page = (name: string) => pages.find((p) => p.name === name)!.text;

/** Each picture a page shows, by file name. */
const pictures = pages.flatMap((p) => [...p.text.matchAll(/\]\(_static\/screenshots\/([^)]+)\)/g)].map((m) => m[1]!));

/** The screenshot names the capture scripts save, from their shot() and shotPanel() calls. */
const captured = readdirSync(join(DOCS, 'screenshots'))
  .filter((f) => f.endsWith('.spec.ts'))
  .flatMap((f) => [...readFileSync(join(DOCS, 'screenshots', f), 'utf8').matchAll(/shot(?:Panel)?\(page, '([^']+)'/g)].map((m) => `${m[1]}.png`));

describe('the user guide', () => {
  it('shows only pictures the capture script takes, and every picture it takes', () => {
    expect(pictures.length).toBeGreaterThan(0);
    expect([...new Set(pictures)].sort()).toEqual([...new Set(captured)].sort());
  });

  it('has every picture it shows, and no others', () => {
    const files = readdirSync(SHOTS).filter((f) => f.endsWith('.png'));
    expect(files.sort()).toEqual([...new Set(pictures)].sort());
  });

  it('lists every step in the step reference, under its group in the Add step menu', () => {
    const text = page('step-reference.md');
    const sections = Object.fromEntries(text.split(/^## /m).slice(1).map((s) => [s.slice(0, s.indexOf('\n')), s]));
    for (const form of stepForms()) {
      expect(sections[form.group], `the ${form.group} section`).toBeDefined();
      expect(sections[form.group], `${form.title} in ${form.group}`).toContain(`| ${form.title} |`);
    }
    const rows = [...text.matchAll(/^\| (?!Step |---)([^|]+) \|/gm)].map((m) => m[1]);
    expect(rows.sort()).toEqual(stepForms().map((f) => f.title).sort());
  });

  it('lists every kind of rule on the quality rules page', () => {
    const text = page('quality-rules.md');
    for (const form of ruleForms()) expect(text, form.title).toContain(`| ${form.title} |`);
  });
});
