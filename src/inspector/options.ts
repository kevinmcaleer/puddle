import { PARSE_LOCALES } from '../compiler';
import type { ParseOptions, Source } from '../model';

/** Delimiter choices; "auto" leaves it to DuckDB's sniffer. */
export const DELIMITERS = [
  { value: 'auto', label: 'Detect automatically' },
  { value: ',', label: 'Comma' },
  { value: ';', label: 'Semicolon' },
  { value: '\t', label: 'Tab' },
  { value: '|', label: 'Pipe' },
];

export const ENCODINGS = [
  { value: 'utf-8', label: 'UTF-8' },
  { value: 'utf-16', label: 'UTF-16' },
  { value: 'latin-1', label: 'Latin-1' },
];

/** File and pasted sources show Read options (the Format field at least); URL sources have their own panel. */
export const hasParseOptions = (source: Source) => source.kind !== 'connection' && ((source.kind !== 'url' && !source.url?.odata) || ((source.format === 'csv' || source.format === 'tsv') && !source.url?.odata && !source.url?.table));

/** The delimiter select's value for a source. */
export function delimiterValue(source: Source): string {
  return source.parseOptions.delimiter ?? (source.format === 'tsv' ? '\t' : 'auto');
}

/** Set one parse option; "auto", empty strings and empty lists remove it so DuckDB detects it again. */
export function withOption<K extends keyof ParseOptions>(options: ParseOptions, key: K, value: ParseOptions[K] | 'auto'): ParseOptions {
  const next = { ...options };
  const empty = value === 'auto' || value === '' || value == null || (Array.isArray(value) && value.length === 0);
  if (empty) delete next[key];
  else next[key] = value as ParseOptions[K];
  return next;
}

/** A count of lines or rows to skip: a whole number, or "auto" (nothing to skip) for empty, 0 or anything else. */
export const parseCount = (text: string): number | 'auto' => (/^\s*\d+\s*$/.test(text) && Number(text) > 0 ? Number(text) : 'auto');

/** "NA, n/a ,-" to ["NA", "n/a", "-"]. */
export const parseNullStrings = (text: string) =>
  text
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

/** The locales a project's data can be written in; new parse numbers steps start with the project's. */
export const LOCALES = Object.entries(PARSE_LOCALES).map(([value, l]) => ({ value, label: l.label }));

