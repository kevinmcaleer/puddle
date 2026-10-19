// DBML colours (`headercolor`, TableGroup `color`, Ref `color`, Note `headercolor`) are any hex the author likes. The
// diagram draws each with the nearest colour of the design system's palette, so both themes keep their contrast; the
// raw value stays in the schema for export.

/** The palette tones, each a token pair: `--<tone>` for lines and text, `--<tone>-tint` for fills. */
export const TONES = ['teal', 'blue', 'purple', 'amber', 'red', 'grey'] as const;
export type Tone = (typeof TONES)[number];

/** Each tone's token, and the hue it stands for (degrees on the colour wheel). */
export const TONE_TOKENS: Record<Tone, { line: string; tint: string; hue: number | null }> = {
  teal: { line: 'brand', tint: 'brand-tint', hue: 180 },
  blue: { line: 'node-source', tint: 'node-source-tint', hue: 215 },
  purple: { line: 'node-combine', tint: 'node-combine-tint', hue: 275 },
  amber: { line: 'accent-ink', tint: 'accent-tint', hue: 40 },
  red: { line: 'fail', tint: 'fail-tint', hue: 10 },
  grey: { line: 'node-check', tint: 'node-check-tint', hue: null },
};

/** A #rgb or #rrggbb colour's hue (0 to 360) and saturation (0 to 1), or undefined when it isn't one. */
export function hueOf(hex: string): { hue: number; saturation: number; lightness: number } | undefined {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return undefined;
  const h = m[1]!.length === 3 ? [...m[1]!].map((c) => c + c).join('') : m[1]!;
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255) as [number, number, number];
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const lightness = (max + min) / 2;
  const d = max - min;
  if (d === 0) return { hue: 0, saturation: 0, lightness };
  const saturation = d / (1 - Math.abs(2 * lightness - 1));
  let hue: number;
  if (max === r) hue = ((g - b) / d) % 6;
  else if (max === g) hue = (b - r) / d + 2;
  else hue = (r - g) / d + 4;
  hue = (hue * 60 + 360) % 360;
  return { hue, saturation, lightness };
}

const distance = (a: number, b: number) => Math.min(Math.abs(a - b), 360 - Math.abs(a - b));

/**
 * The palette tone nearest a DBML colour: grey for greys (and for near-black or near-white), otherwise the tone of the
 * nearest hue. Undefined when there is no colour, or it isn't a hex colour.
 */
export function toneOf(color: string | undefined): Tone | undefined {
  if (!color) return undefined;
  const c = hueOf(color);
  if (!c) return undefined;
  if (c.saturation < 0.15 || c.lightness < 0.08 || c.lightness > 0.95) return 'grey';
  let best: Tone = 'teal';
  let bestDistance = Infinity;
  for (const tone of TONES) {
    const hue = TONE_TOKENS[tone].hue;
    if (hue == null) continue;
    const d = distance(c.hue, hue);
    if (d < bestDistance) [best, bestDistance] = [tone, d];
  }
  return best;
}

/** The colour written into the DBML when a tone is picked on the diagram: a hex DBML reads, which draws as that tone. */
export const TONE_HEX: Record<Tone, string> = { teal: '#16A085', blue: '#3498DB', purple: '#8E44AD', amber: '#F39C12', red: '#E74C3C', grey: '#7F8C8D' };
