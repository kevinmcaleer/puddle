// Editor forms for Unpivot and Transpose, in the Reshape group, and the checks their forms show before running.
import { MAX_TRANSPOSE_ROWS, transposedNames } from '../compiler';
import type { ColumnSchema } from '../model';
import { columnKind, type ColumnKind } from '../ui/columnKind';
import { defineStepForm } from './forms';

const KINDS: Record<ColumnKind, string> = { text: 'text', integer: 'numbers', decimal: 'numbers', boolean: 'true or false', date: 'dates', timestamp: 'dates', json: 'lists and structs' };

const strings = (v: unknown) => (Array.isArray(v) ? v.map(String) : []);

/**
 * Unpivoting puts every value in one column, which holds one type. When the columns being unpivoted hold
 * different kinds of values, say which, and what to do. Undefined when they share one, or values are unpivoted as text.
 */
export function mixedTypesProblem(params: Record<string, unknown>, columns: ColumnSchema[]): string | undefined {
  if (params.asText === true) return undefined;
  const picked = new Set(strings(params.columns));
  if (!picked.size) return undefined;
  const moved = columns.filter((c) => (params.except === true ? !picked.has(c.name) : picked.has(c.name)));
  const byKind = new Map<string, string[]>();
  for (const c of moved) {
    const kind = KINDS[columnKind(c.type)];
    byKind.set(kind, [...(byKind.get(kind) ?? []), c.name]);
  }
  if (byKind.size < 2) return undefined;
  const kinds = [...byKind].map(([kind, names]) => `${kind} (${names.join(', ')})`);
  return `The columns to unpivot hold ${kinds.slice(0, -1).join(', ')} and ${kinds.at(-1)}, and one value column can only hold one kind. Turn on Treat all values as text, or change their types first.`;
}

/** What reading the rows again changed, as a sentence. */
export function rowsChange(before: number | undefined, after: number, beforeColumns: unknown, afterColumns: string[]): string {
  const rows = (n: number) => `${n.toLocaleString('en')} ${n === 1 ? 'row' : 'rows'}`;
  const sameColumns = JSON.stringify(strings(beforeColumns)) === JSON.stringify(afterColumns);
  const columns = sameColumns ? '' : ' The input’s columns have changed too.';
  if (before === after) return `No change: still ${rows(after)}.${columns}`;
  return `Now ${rows(after)}${before == null ? '' : `, not ${before.toLocaleString('en')}`}.${columns}`;
}

defineStepForm({
  type: 'unpivot',
  title: 'Unpivot columns',
  group: 'Reshape',
  fields: [
    {
      key: 'columns',
      label: 'Columns',
      kind: 'columns',
      liveHint: (p) => (p.except === true ? 'These columns stay as they are. Every other column becomes rows of attribute and value.' : 'These columns become rows of attribute and value. The others stay as they are.'),
      problem: mixedTypesProblem,
    },
    { key: 'except', label: 'Unpivot every column except these', kind: 'switch' },
    { key: 'attribute', label: 'Attribute column', kind: 'text', mono: true, hint: 'Holds each unpivoted column’s name.' },
    { key: 'value', label: 'Value column', kind: 'text', mono: true, hint: 'Holds its value.' },
    { key: 'keepEmpty', label: 'Keep rows with empty values', kind: 'switch' },
    { key: 'asText', label: 'Treat all values as text', kind: 'switch' },
  ],
  // Selected columns are the ones to unpivot, as in a spreadsheet.
  defaults: (ctx) => ({ columns: ctx.selected.filter((s) => ctx.available.some((c) => c.name === s)), except: false, attribute: 'attribute', value: 'value', keepEmpty: false, asText: false }),
});

defineStepForm({
  type: 'transpose',
  title: 'Transpose',
  group: 'Reshape',
  fields: [
    {
      key: 'rowCount',
      label: 'Rows',
      kind: 'transposeRows',
      hint: `Each row becomes a column, so transpose runs on up to ${MAX_TRANSPOSE_ROWS.toLocaleString('en')} rows.`,
      liveHint: (p) => {
        const names = transposedPreview(p);
        if (!names.length) return undefined;
        return `New columns: column, ${names.length > 5 ? `${names.slice(0, 5).join(', ')} and ${names.length - 5} more` : names.join(', ')}.`;
      },
    },
    {
      key: 'headers',
      label: 'Use the first column as headers',
      kind: 'switch',
    },
  ],
  readsRows: true,
  defaults: (ctx) => ({ columns: ctx.available.map((c) => c.name), headers: false, rowCount: undefined, headerValues: [], ...ctx.rows }),
});

/** The new column names a transpose would make, for its form to show. */
export const transposedPreview = (params: Record<string, unknown>) =>
  transposedNames({ rowCount: typeof params.rowCount === 'number' ? params.rowCount : 0, headerValues: Array.isArray(params.headerValues) ? (params.headerValues as (string | null)[]) : [], headers: params.headers === true });
