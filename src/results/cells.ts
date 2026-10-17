import { GridCellKind, type GridCell, type Theme } from '@glideapps/glide-data-grid';
import { formatValue, type ColumnKind, type DisplayFormat } from '../ui';

const NUMERIC: ColumnKind[] = ['integer', 'decimal'];

/**
 * A results cell. Nulls read "null" in subtle italics (and to screen readers) but copy as empty;
 * numbers are right-aligned; nothing is editable. Numbers and dates are shown in the display locale, but the
 * cell's data, what screen readers read and what is copied stay DuckDB's own text.
 */
export function resultCell(value: string | null | undefined, kind: ColumnKind, nullTheme: Partial<Theme>, format?: DisplayFormat): GridCell {
  if (value === undefined) return { kind: GridCellKind.Loading, allowOverlay: false };
  if (value === null) return { kind: GridCellKind.Text, data: 'null', displayData: 'null', copyData: '', allowOverlay: false, readonly: true, themeOverride: nullTheme };
  const displayData = format ? formatValue(value, kind, format) : value;
  return { kind: GridCellKind.Text, data: value, displayData, copyData: value, allowOverlay: false, readonly: true, contentAlign: NUMERIC.includes(kind) ? 'right' : 'left' };
}

/** The italic, subtle look of a null, from the current grid theme. */
export const nullTheme = (theme: { textLight: string; baseFontStyle: string }): Partial<Theme> => ({ textDark: theme.textLight, baseFontStyle: `italic ${theme.baseFontStyle}` });

/** Failing cells: fail-tint under the value and a fail inset outline, read from the current theme's tokens. */
export function failingCells(el: Element = document.documentElement) {
  const cs = getComputedStyle(el);
  return { tint: cs.getPropertyValue('--fail-tint').trim(), line: cs.getPropertyValue('--fail').trim() };
}
