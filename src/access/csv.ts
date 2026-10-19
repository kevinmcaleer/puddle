// An Access table as CSV with every value as text, for the runner, which loads it with the column types the browser
// gives (compileAccessLoad in src/compiler/sources.ts). Pure, so it is tested without DuckDB.
import type { AccessColumn } from './types';

const quote = (v: string) => `"${v.replace(/"/g, '""')}"`;
const pad = (n: number, width = 2) => String(n).padStart(width, '0');

/** Milliseconds since 1970 (UTC) as DuckDB reads a timestamp: 2026-01-05 14:05:00.000. */
const timestamp = (ms: number) => {
  const d = new Date(ms);
  return `${pad(d.getUTCFullYear(), 4)}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}.${pad(d.getUTCMilliseconds(), 3)}`;
};

/** One value: empty for none, quoted text (so empty text stays apart from none), bytes as \x escapes. */
function field(v: AccessColumn['values'][number], type: AccessColumn['type']): string {
  if (v == null) return '';
  if (v instanceof Uint8Array) return quote(Array.from(v, (b) => `\\x${b.toString(16).padStart(2, '0').toUpperCase()}`).join(''));
  if (type === 'TIMESTAMP') return timestamp(v as number);
  return typeof v === 'string' ? quote(v) : String(v);
}

/** The columns as CSV with a header row. */
export function columnsToCsv(columns: AccessColumn[]): string {
  const rows = columns[0]?.values.length ?? 0;
  const lines = [columns.map((c) => quote(c.name)).join(',')];
  for (let i = 0; i < rows; i++) lines.push(columns.map((c) => field(c.values[i] ?? null, c.type)).join(','));
  return lines.join('\n') + '\n';
}
