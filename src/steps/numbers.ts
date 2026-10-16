// Editor forms for the Numbers step group.
import { bucketLabels, UNITS } from '../compiler';
import { pickKind } from './basic';
import { freeName } from './columns';
import { defineStepForm } from './forms';

const when = (key: string, ...values: string[]) => (p: Record<string, unknown>) => values.includes(String(p[key]));
const numberColumns = { key: 'columns', label: 'Columns', kind: 'columns', expects: 'number' } as const;

defineStepForm({
  type: 'roundNumbers',
  title: 'Round',
  group: 'Numbers',
  fields: [
    numberColumns,
    {
      key: 'mode',
      label: 'Round',
      kind: 'select',
      options: [
        { value: 'places', label: 'To decimal places' },
        { value: 'up', label: 'Up' },
        { value: 'down', label: 'Down' },
        { value: 'nearest', label: 'To the nearest multiple' },
      ],
    },
    { key: 'places', label: 'Decimal places', kind: 'number', min: 0, when: when('mode', 'places', 'up', 'down'), hint: '0 rounds to whole numbers. Halves round away from zero.' },
    { key: 'nearest', label: 'Nearest', kind: 'number', when: when('mode', 'nearest'), hint: 'For example 5, 100 or 0.25.' },
  ],
  defaults: (ctx) => ({ columns: pickKind(ctx, 'number'), mode: 'places', places: 0, nearest: 5 }),
});

defineStepForm({
  type: 'absoluteValue',
  title: 'Absolute value',
  group: 'Numbers',
  fields: [{ ...numberColumns, hint: 'Negative numbers lose their minus sign.' }],
  defaults: (ctx) => ({ columns: pickKind(ctx, 'number') }),
});

/** The labels a bucket step makes, written out so the form shows them before it runs. */
export function bucketPreview(p: Record<string, unknown>): string | undefined {
  if (p.mode === 'edges') {
    const edges = Array.isArray(p.edges) ? p.edges.map(Number) : [];
    if (!edges.length || edges.some((e, i) => !Number.isFinite(e) || (i > 0 && e <= edges[i - 1]!))) return undefined;
    return `Buckets: ${bucketLabels(edges).join('; ')}`;
  }
  const width = Number(p.width);
  const start = Number(p.start ?? 0);
  if (!(width > 0) || !Number.isFinite(start)) return undefined;
  const d = (n: number) => String(n).split('.')[1]?.length ?? 0;
  const places = Math.max(d(width), d(start));
  const show = (n: number) => n.toFixed(places);
  return `Buckets like ${show(start)} to under ${show(start + width)}, ${show(start + width)} to under ${show(start + 2 * width)}`;
}

defineStepForm({
  type: 'bucketNumbers',
  title: 'Bucket',
  group: 'Numbers',
  fields: [
    { key: 'column', label: 'Column', kind: 'column', expects: 'number' },
    {
      key: 'mode',
      label: 'Buckets',
      kind: 'select',
      options: [
        { value: 'width', label: 'Equal width' },
        { value: 'edges', label: 'Custom edges' },
      ],
    },
    { key: 'width', label: 'Width', kind: 'number', when: when('mode', 'width'), liveHint: bucketPreview },
    { key: 'start', label: 'Starting at', kind: 'number', when: when('mode', 'width') },
    { key: 'edges', label: 'Edges', kind: 'list', of: 'number', when: when('mode', 'edges'), hint: 'Smallest first, separated by commas.', liveHint: bucketPreview },
    { key: 'into', label: 'New column', kind: 'text', mono: true },
  ],
  defaults: (ctx) => {
    const column = pickKind(ctx, 'number')[0] ?? '';
    return { column, mode: 'width', width: 10, start: 0, edges: [], into: freeName(`${column || 'number'}_bucket`, ctx) };
  },
});

defineStepForm({
  type: 'standardise',
  title: 'Standardise',
  group: 'Numbers',
  fields: [
    numberColumns,
    {
      key: 'method',
      label: 'Method',
      kind: 'select',
      options: [
        { value: 'zscore', label: 'Z-score (distance from the mean in standard deviations)' },
        { value: 'minmax', label: 'Min-max (0 for the smallest, 1 for the largest)' },
      ],
      hint: 'Worked out over every row arriving at the step. Empty values stay empty.',
    },
  ],
  defaults: (ctx) => ({ columns: pickKind(ctx, 'number'), method: 'zscore' }),
});

const KIND_NAMES = { length: 'Length', weight: 'Weight', volume: 'Volume', temperature: 'Temperature' } as const;
const unitOptions = Object.entries(UNITS).map(([value, u]) => ({ value, label: `${KIND_NAMES[u.kind]}: ${u.kind === 'temperature' ? u.label : u.label.charAt(0).toLowerCase() + u.label.slice(1)}` }));

defineStepForm({
  type: 'convertUnits',
  title: 'Convert units',
  group: 'Numbers',
  fields: [numberColumns, { key: 'from', label: 'From', kind: 'select', options: unitOptions }, { key: 'to', label: 'To', kind: 'select', options: unitOptions }],
  defaults: (ctx) => ({ columns: pickKind(ctx, 'number'), from: 'cm', to: 'in' }),
});
