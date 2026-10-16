// The Numbers step group: round, absolute, bucket, standardise, convert units.
// These need number columns; text numbers are read with parse numbers first.
import { z } from 'zod';
import { ident, list, num, str } from '../sql';
import { defineStep } from './registry';

const Column = z.string().min(1, 'pick a column');
const Columns = z.array(z.string().min(1)).min(1, 'pick at least one column');
const Name = z.string().trim().min(1, 'give the new column a name');
const names = (cols: string[]) => cols.join(', ');

const replaceEach = (input: string, columns: string[], expr: (col: string) => string) =>
  `SELECT * REPLACE (${list(columns.map((c) => `${expr(c)} AS ${ident(c)}`))}) FROM ${input}`;

/** How many decimal places a number is written with: 0.25 has 2, 5 has 0. */
export const decimalsOf = (n: number) => {
  const s = String(n);
  const e = /e-(\d+)$/.exec(s);
  if (e) return Number(e[1]) + (s.split('e')[0]!.split('.')[1]?.length ?? 0);
  return s.split('.')[1]?.length ?? 0;
};

/**
 * Scaling by a power of ten leaves floating-point dust (1.1 * 100 is 110.00000000000001), which ceil would
 * round up. Rounding the scaled value to 9 places first keeps ceil and floor honest.
 */
const clean = (expr: string) => `round(${expr}, 9)`;

export const roundNumbers = defineStep({
  type: 'roundNumbers',
  params: z
    .object({
      columns: Columns,
      /** places: nearest at that many decimals; up and down: ceiling and floor at that many decimals; nearest: to a multiple of `nearest`. */
      mode: z.enum(['places', 'up', 'down', 'nearest']).default('places'),
      places: z.number().int('use a whole number of places').min(0, 'use 0 or more places').max(15, 'use 15 places or fewer').default(0),
      nearest: z.number().positive('round to a number above 0').optional(),
    })
    .refine((p) => p.mode !== 'nearest' || p.nearest != null, { path: ['nearest'], message: 'give the number to round to' }),
  label: (p) => {
    const at = p.places === 0 ? 'whole numbers' : `${p.places} decimal place${p.places === 1 ? '' : 's'}`;
    const how = p.mode === 'nearest' ? `to the nearest ${p.nearest}` : p.mode === 'up' ? `up to ${at}` : p.mode === 'down' ? `down to ${at}` : `to ${at}`;
    return `Rounded ${names(p.columns)} ${how}`;
  },
  compile: (p, { input }) =>
    replaceEach(input, p.columns, (c) => {
      const x = ident(c);
      if (p.mode === 'nearest') {
        const n = num(p.nearest ?? 1);
        return `round(round(${clean(`${x} / ${n}`)}) * ${n}, ${num(decimalsOf(p.nearest ?? 1))})`;
      }
      // Halves round away from zero, and 2.675 rounds to 2.68 as written, though the double is 2.67499999...
      const fn = p.mode === 'up' ? 'ceil' : p.mode === 'down' ? 'floor' : 'round';
      if (p.places === 0) return `${fn}(${clean(x)})`;
      const f = num(10 ** p.places);
      return `${fn}(${clean(`${x} * ${f}`)}) / ${f}`;
    }),
});

export const absoluteValue = defineStep({
  type: 'absoluteValue',
  params: z.object({ columns: Columns }),
  label: (p) => `Made ${names(p.columns)} absolute`,
  compile: (p, { input }) => replaceEach(input, p.columns, (c) => `abs(${ident(c)})`),
});

/** A number as people write it in a label: 10, 2.5, -3. */
const show = (n: number) => String(n);

/** Labels for custom edges: under 18, 18 to under 65, 65 and over. */
export function bucketLabels(edges: number[]): string[] {
  if (!edges.length) return [];
  return [`under ${show(edges[0]!)}`, ...edges.slice(1).map((e, i) => `${show(edges[i]!)} to under ${show(e)}`), `${show(edges[edges.length - 1]!)} and over`];
}

export const bucketNumbers = defineStep({
  type: 'bucketNumbers',
  params: z
    .object({
      column: Column,
      /** width: equal buckets from `start`; edges: the boundaries given, each bucket including its lower edge. */
      mode: z.enum(['width', 'edges']).default('width'),
      width: z.number().positive('use a width above 0').optional(),
      start: z.number().default(0),
      edges: z.array(z.number()).default([]),
      into: Name,
    })
    .superRefine((p, ctx) => {
      if (p.mode === 'width' && p.width == null) ctx.addIssue({ code: 'custom', path: ['width'], message: 'give the bucket width' });
      if (p.mode === 'edges') {
        if (!p.edges.length || p.edges.some((e) => !Number.isFinite(e))) ctx.addIssue({ code: 'custom', path: ['edges'], message: 'give at least one edge, as numbers' });
        else if (p.edges.some((e, i) => i > 0 && e <= p.edges[i - 1]!)) ctx.addIssue({ code: 'custom', path: ['edges'], message: 'list edges from smallest to largest' });
      }
    }),
  label: (p) => `Bucketed ${p.column} into ${p.into}`,
  compile: (p, { input }) => {
    const x = ident(p.column);
    if (p.mode === 'edges') {
      const labels = bucketLabels(p.edges);
      const whens = p.edges.map((e, i) => `WHEN ${x} < ${num(e)} THEN ${str(labels[i]!)}`);
      return `SELECT *, CASE WHEN ${x} IS NULL THEN NULL ${whens.join(' ')} ELSE ${str(labels[labels.length - 1]!)} END AS ${ident(p.into)} FROM ${input}`;
    }
    const w = p.width ?? 1;
    const d = Math.max(decimalsOf(w), decimalsOf(p.start));
    const lower = (k: string) => `${num(p.start)} + (${k}) * ${num(w)}`;
    const k = `floor(${clean(`(${x} - ${num(p.start)}) / ${num(w)}`)})`;
    // Written with the decimals of the width and start, so a bucket reads 0.5 to under 1.0 and never 0.30000000000000004.
    const text = (e: string) => (d === 0 ? `CAST(CAST(${e} AS BIGINT) AS VARCHAR)` : `CAST(CAST(round(${e}, ${num(d)}) AS DECIMAL(38, ${num(d)})) AS VARCHAR)`);
    return `SELECT *, ${text(lower(k))} || ' to under ' || ${text(lower(`${k} + 1`))} AS ${ident(p.into)} FROM ${input}`;
  },
});

export const standardise = defineStep({
  type: 'standardise',
  params: z.object({
    columns: Columns,
    /** zscore: how many standard deviations from the mean (population); minmax: 0 for the smallest, 1 for the largest. */
    method: z.enum(['zscore', 'minmax']).default('zscore'),
  }),
  label: (p) => `Standardised ${names(p.columns)} ${p.method === 'zscore' ? 'as z-scores' : 'to 0 to 1'}`,
  // Over every row of the step's input. A column whose values are all the same gives 0 rather than dividing by 0.
  compile: (p, { input }) =>
    replaceEach(input, p.columns, (c) => {
      const x = ident(c);
      const [centre, spread] = p.method === 'zscore' ? [`avg(${x}) OVER ()`, `stddev_pop(${x}) OVER ()`] : [`min(${x}) OVER ()`, `(max(${x}) OVER () - min(${x}) OVER ())`];
      return `CASE WHEN ${x} IS NULL THEN NULL WHEN ${spread} = 0 THEN 0.0 ELSE (${x} - ${centre}) / ${spread} END`;
    }),
});

/** Units by kind. Factors convert to the kind's base unit (metre, kilogram, litre); temperature has formulas instead. */
export const UNITS = {
  mm: { kind: 'length', label: 'Millimetres', factor: 0.001 },
  cm: { kind: 'length', label: 'Centimetres', factor: 0.01 },
  m: { kind: 'length', label: 'Metres', factor: 1 },
  km: { kind: 'length', label: 'Kilometres', factor: 1000 },
  in: { kind: 'length', label: 'Inches', factor: 0.0254 },
  ft: { kind: 'length', label: 'Feet', factor: 0.3048 },
  yd: { kind: 'length', label: 'Yards', factor: 0.9144 },
  mi: { kind: 'length', label: 'Miles', factor: 1609.344 },
  mg: { kind: 'weight', label: 'Milligrams', factor: 0.000001 },
  g: { kind: 'weight', label: 'Grams', factor: 0.001 },
  kg: { kind: 'weight', label: 'Kilograms', factor: 1 },
  t: { kind: 'weight', label: 'Tonnes', factor: 1000 },
  oz: { kind: 'weight', label: 'Ounces', factor: 0.028349523125 },
  lb: { kind: 'weight', label: 'Pounds', factor: 0.45359237 },
  st: { kind: 'weight', label: 'Stones', factor: 6.35029318 },
  ml: { kind: 'volume', label: 'Millilitres', factor: 0.001 },
  l: { kind: 'volume', label: 'Litres', factor: 1 },
  m3: { kind: 'volume', label: 'Cubic metres', factor: 1000 },
  tsp: { kind: 'volume', label: 'Teaspoons (US)', factor: 0.00492892159375 },
  tbsp: { kind: 'volume', label: 'Tablespoons (US)', factor: 0.0147867647812 },
  floz: { kind: 'volume', label: 'Fluid ounces (US)', factor: 0.0295735295625 },
  cup: { kind: 'volume', label: 'Cups (US)', factor: 0.2365882365 },
  pt: { kind: 'volume', label: 'Pints (US)', factor: 0.473176473 },
  ukpt: { kind: 'volume', label: 'Pints (UK)', factor: 0.56826125 },
  gal: { kind: 'volume', label: 'Gallons (US)', factor: 3.785411784 },
  ukgal: { kind: 'volume', label: 'Gallons (UK)', factor: 4.54609 },
  c: { kind: 'temperature', label: 'Celsius', factor: 1 },
  f: { kind: 'temperature', label: 'Fahrenheit', factor: 1 },
  k: { kind: 'temperature', label: 'Kelvin', factor: 1 },
} as const;
export type Unit = keyof typeof UNITS;
const UNIT_KEYS = Object.keys(UNITS) as [Unit, ...Unit[]];

/** A unit's name mid-sentence: metres, pints (UK), but Celsius. */
const unitName = (u: Unit) => (UNITS[u].kind === 'temperature' ? UNITS[u].label : UNITS[u].label.charAt(0).toLowerCase() + UNITS[u].label.slice(1));

/** Temperature to and from Celsius. */
const toC = { c: (x: string) => x, f: (x: string) => `((${x} - 32) * 5 / 9)`, k: (x: string) => `(${x} - 273.15)` };
const fromC = { c: (x: string) => x, f: (x: string) => `(${x} * 9 / 5 + 32)`, k: (x: string) => `(${x} + 273.15)` };

/** The SQL converting `x` from one unit to another of the same kind. */
export function convertExpr(x: string, from: Unit, to: Unit): string {
  const d = `CAST(${x} AS DOUBLE)`;
  const expr = UNITS[from].kind === 'temperature' ? fromC[to as 'c' | 'f' | 'k'](toC[from as 'c' | 'f' | 'k'](d)) : `${d} * ${num(UNITS[from].factor)} / ${num(UNITS[to].factor)}`;
  // Rounded to 12 places so 2.54 cm is 1 inch, not 1.0000000000000002; far finer than any measurement.
  return `round(${expr}, 12)`;
}

export const convertUnits = defineStep({
  type: 'convertUnits',
  params: z
    .object({ columns: Columns, from: z.enum(UNIT_KEYS), to: z.enum(UNIT_KEYS) })
    .refine((p) => UNITS[p.from].kind === UNITS[p.to].kind, { path: ['to'], message: 'convert to a unit of the same kind' }),
  label: (p) => `Converted ${names(p.columns)} from ${unitName(p.from)} to ${unitName(p.to)}`,
  compile: (p, { input }) => replaceEach(input, p.columns, (c) => convertExpr(ident(c), p.from, p.to)),
});
