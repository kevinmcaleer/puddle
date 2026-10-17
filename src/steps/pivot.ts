// The Pivot and group by editor's form, and the edits its zones make, kept pure so they're tested without React.
import { AGGREGATES, type Aggregate, type Condition, type PivotValue } from '../compiler';
import type { ColumnSchema } from '../model';
import { columnKind } from '../ui/columnKind';
import { defineStepForm } from './forms';

/** The four drop zones. `column` holds one field at most. */
export type Zone = 'filters' | 'column' | 'rows' | 'values';

export const ZONES: { zone: Zone; label: string; add: string }[] = [
  { zone: 'filters', label: 'Filters', add: 'Add to filters' },
  { zone: 'column', label: 'Columns', add: 'Use as columns' },
  { zone: 'rows', label: 'Rows', add: 'Add to rows' },
  { zone: 'values', label: 'Values', add: 'Add to values' },
];

/** What the editor reads and writes: the pivot step's params, loosely typed while they're being built. */
export interface PivotDraft {
  rows: string[];
  column: string;
  pivotValues: string[];
  moreValues: boolean;
  values: PivotValue[];
  filters: Condition[];
  names: Record<string, string>;
}

const strings = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);

/** The step's params as a draft, with anything missing filled in. */
export function pivotDraft(params: Record<string, unknown>): PivotDraft {
  return {
    rows: strings(params.rows),
    column: typeof params.column === 'string' ? params.column : '',
    pivotValues: strings(params.pivotValues),
    moreValues: params.moreValues === true,
    values: Array.isArray(params.values) ? (params.values as PivotValue[]) : [],
    filters: Array.isArray(params.filters) ? (params.filters as Condition[]) : [],
    names: params.names && typeof params.names === 'object' ? (params.names as Record<string, string>) : {},
  };
}

/** The column names in a zone, in order. */
export function zoneFields(d: PivotDraft, zone: Zone): string[] {
  switch (zone) {
    case 'rows':
      return d.rows;
    case 'column':
      return d.column ? [d.column] : [];
    case 'values':
      return d.values.map((v) => v.column);
    case 'filters':
      return d.filters.map((f) => f.column);
  }
}

const NUMBER_KINDS = new Set(['integer', 'decimal']);
/** The aggregates that need numbers: DuckDB can't sum or average text. */
const NUMERIC_ONLY = new Set<Aggregate>(['sum', 'average', 'median', 'stddev', 'variance']);

/** The aggregates a column can use, in menu order: every one for a number, the rest for anything else. */
export function aggregatesFor(column: string, columns: ColumnSchema[]): Aggregate[] {
  const type = columns.find((c) => c.name === column)?.type;
  const all = Object.keys(AGGREGATES) as Aggregate[];
  // A column the input no longer has keeps every choice, so its setting still shows.
  if (!type || NUMBER_KINDS.has(columnKind(type))) return all;
  return all.filter((a) => !NUMERIC_ONLY.has(a));
}

/** Numbers are summed; anything else is counted. A field already in Values with that aggregate gets the next one free. */
function newValue(d: PivotDraft, column: string, columns: ColumnSchema[]): PivotValue {
  const choices = aggregatesFor(column, columns);
  const first: Aggregate = choices.includes('sum') ? 'sum' : 'count';
  const order = [first, ...choices.filter((a) => a !== first)];
  const agg = order.find((a) => !d.values.some((v) => v.column === column && v.agg === a)) ?? first;
  return { column, agg };
}

/** Put a field into a zone, before `at` (at the end by default). Rows and Columns can't share a field. */
export function addToZone(d: PivotDraft, column: string, zone: Zone, columns: ColumnSchema[], at?: number): PivotDraft {
  const insert = <T>(items: T[], item: T) => {
    const i = at == null ? items.length : Math.max(0, Math.min(at, items.length));
    return [...items.slice(0, i), item, ...items.slice(i)];
  };
  switch (zone) {
    case 'rows':
      if (d.rows.includes(column)) return d;
      return { ...d, rows: insert(d.rows, column), ...(d.column === column ? { column: '', pivotValues: [], moreValues: false } : {}) };
    case 'column':
      if (d.column === column) return d;
      // A new Columns field's values are read again by the editor.
      return { ...d, column, pivotValues: [], moreValues: false, rows: d.rows.filter((r) => r !== column) };
    case 'values':
      return { ...d, values: insert(d.values, newValue(d, column, columns)) };
    case 'filters':
      return { ...d, filters: insert(d.filters, { column, op: 'notEmpty', value: '' }) };
  }
}

/** Take the field at `index` out of a zone. */
export function removeFromZone(d: PivotDraft, zone: Zone, index: number): PivotDraft {
  const without = <T>(items: T[]) => items.filter((_, i) => i !== index);
  switch (zone) {
    case 'rows':
      return { ...d, rows: without(d.rows) };
    case 'column':
      return { ...d, column: '', pivotValues: [], moreValues: false };
    case 'values':
      return { ...d, values: without(d.values) };
    case 'filters':
      return { ...d, filters: without(d.filters) };
  }
}

/**
 * Move the field at `index` in zone `from` to zone `to`, before `at`. Within a zone this reorders; between zones a
 * value or filter keeps only its column.
 */
export function moveField(d: PivotDraft, from: Zone, index: number, to: Zone, columns: ColumnSchema[], at?: number): PivotDraft {
  const column = zoneFields(d, from)[index];
  if (column == null) return d;
  if (from === to) {
    if (from === 'column') return d;
    const key = from === 'rows' ? 'rows' : from === 'values' ? 'values' : 'filters';
    const items = [...(d[key] as unknown[])];
    const [item] = items.splice(index, 1);
    const target = at == null ? items.length : Math.max(0, Math.min(at > index ? at - 1 : at, items.length));
    items.splice(target, 0, item);
    return { ...d, [key]: items };
  }
  return addToZone(removeFromZone(d, from, index), column, to, columns, at);
}

export const setAggregate = (d: PivotDraft, index: number, agg: Aggregate): PivotDraft => ({ ...d, values: d.values.map((v, i) => (i === index ? { ...v, agg } : v)) });

/** Name an output column, or clear its name back to the default. */
export function renameOutput(d: PivotDraft, defaultName: string, name: string): PivotDraft {
  const names = { ...d.names };
  const trimmed = name.trim();
  if (!trimmed || trimmed === defaultName) delete names[defaultName];
  else names[defaultName] = trimmed;
  return { ...d, names };
}

/** Whether an edit changed what the Columns field's values are read from, so they need reading again. */
export const valuesStale = (before: PivotDraft, after: PivotDraft) => !!after.column && (before.column !== after.column || JSON.stringify(before.filters) !== JSON.stringify(after.filters));

const some = (values: string[]) => (values.length > 5 ? `${values.slice(0, 5).join(', ')} and ${values.length - 5} more` : values.join(', '));

/** What reading the values again changed, as a sentence for the editor to report. */
export function pivotValuesChange(before: string[], after: string[]): string {
  const added = after.filter((v) => !before.includes(v));
  const removed = before.filter((v) => !after.includes(v));
  if (!added.length && !removed.length) return `No change: the same ${after.length} ${after.length === 1 ? 'value' : 'values'}.`;
  return [added.length ? `Added ${some(added)}.` : '', removed.length ? `Removed ${some(removed)}.` : ''].filter(Boolean).join(' ');
}

defineStepForm({
  type: 'pivot',
  title: 'Pivot or group by',
  group: 'Reshape',
  // One field for the whole editor, keyed by the first setting it edits; it reads and writes all of them.
  fields: [{ key: 'rows', label: 'Pivot', kind: 'pivot' }],
  // Selected columns start in Rows: grouping by them is the usual first move.
  defaults: (ctx) => ({ rows: ctx.selected.filter((s) => ctx.available.some((c) => c.name === s)), column: '', pivotValues: [], moreValues: false, values: [], filters: [], names: {} }),
});
