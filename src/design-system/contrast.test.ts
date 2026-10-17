import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import tokens from './tokens.json';

// WCAG 2.2 AA contrast for the token pairs the app draws text and controls with, in both themes. A pair belongs
// here when components.css, a Tailwind class or the Glide theme puts the first token on the second.

type Theme = 'light' | 'dark';
const THEMES: Theme[] = ['light', 'dark'];
const byName = new Map(tokens.color.tokens.map((t) => [t.name, t.value as Record<Theme, string>]));

/** A token's hex in a theme, following references such as "{brand}". */
function hex(name: string, theme: Theme): string {
  const value = byName.get(name)?.[theme];
  if (!value) throw new Error(`No colour token ${name}`);
  const ref = /^\{(.+)\}$/.exec(value);
  return ref ? hex(ref[1]!, theme) : value;
}

/** Relative luminance (WCAG 2.2, 1.4.3). */
function luminance(colour: string) {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(colour.slice(i, i + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

function contrast(a: string, b: string) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}

const SURFACES = ['surface-canvas', 'surface-panel', 'surface-raised', 'surface-sunken', 'surface-hover'];

/** Text: 4.5:1 (all of Puddle's text is under 18.66px bold, so none counts as large). */
const TEXT: [string, string][] = [
  // Ink on every surface: body text, metadata and placeholders, the menus' hints on a hovered item.
  ...['ink', 'ink-muted', 'ink-subtle'].flatMap((ink) => SURFACES.map((s): [string, string] => [ink, s])),
  // Links and the selection.
  ...['surface-panel', 'surface-raised', 'surface-canvas'].map((s): [string, string] => ['brand', s]),
  ['on-brand', 'brand'],
  ['on-brand', 'brand-hover'],
  ['brand', 'brand-tint'],
  ['ink', 'brand-tint'],
  ['ink-muted', 'brand-tint'],
  ['ink-subtle', 'brand-tint'],
  // The viewer and the pinned results.
  ['on-accent', 'accent'],
  ...['surface-panel', 'surface-raised', 'surface-canvas', 'accent-tint'].map((s): [string, string] => ['accent-ink', s]),
  ['ink', 'accent-tint'],
  ['ink-muted', 'accent-tint'],
  // Rule results: badges on their tints, the words in rule rows and field hints on panels.
  ...(['pass', 'warn', 'fail'] as const).flatMap((tone): [string, string][] => [
    [tone, `${tone}-tint`],
    [tone, 'surface-panel'],
    [tone, 'surface-raised'],
  ]),
  ['ink', 'warn-tint'],
  ['ink', 'fail-tint'],
  ['on-fail', 'fail'],
];

/** Controls, focus and graphics against what is around them (borders, wires, handles, node chips' icons): 3:1 (1.4.11). */
const NON_TEXT: [string, string][] = [
  ...['line-strong', 'brand', 'accent-ring', 'wire', 'wire-active', 'wire-broken'].flatMap((fg) => ['surface-panel', 'surface-raised', 'surface-canvas'].map((s): [string, string] => [fg, s])),
  ['brand', 'surface-sunken'],
  ...['source', 'transform', 'combine', 'check', 'output'].map((k): [string, string] => [`node-${k}`, `node-${k}-tint`]),
];

describe('token contrast', () => {
  for (const theme of THEMES) {
    it.each(TEXT)(`${theme}: %s text on %s meets 4.5:1`, (fg, bg) => {
      expect(contrast(hex(fg, theme), hex(bg, theme))).toBeGreaterThanOrEqual(4.5);
    });
    it.each(NON_TEXT)(`${theme}: %s on %s meets 3:1`, (fg, bg) => {
      expect(contrast(hex(fg, theme), hex(bg, theme))).toBeGreaterThanOrEqual(3);
    });
  }

  it('measures contrast as WCAG does', () => {
    expect(contrast('#000000', '#ffffff')).toBeCloseTo(21, 5);
    expect(contrast('#777777', '#ffffff')).toBeCloseTo(4.48, 2);
  });

  it('tokens.css carries the same values as tokens.json', () => {
    const css = readFileSync(join(import.meta.dirname, 'tokens.css'), 'utf8');
    const light = /:root \{([^}]*)\}/.exec(css)![1]!;
    const dark = /:root\[data-theme="dark"\] \{([^}]*)\}/.exec(css)![1]!;
    for (const [name, value] of byName) {
      for (const [theme, block] of [['light', light], ['dark', dark]] as const) {
        const ref = /^\{(.+)\}$/.exec(value[theme]);
        expect(block, `${theme} --${name}`).toContain(`--${name}: ${ref ? `var(--${ref[1]})` : value[theme]};`);
      }
    }
  });
});
