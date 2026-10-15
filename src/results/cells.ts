import { GridCellKind, type GridCell, type Theme } from '@glideapps/glide-data-grid';
import type { ColumnKind } from '../ui';

const NUMERIC: ColumnKind[] = ['integer', 'decimal'];

/**
 * A results cell. Nulls read "null" in subtle italics (and to screen readers) but copy as empty;
 * numbers are right-aligned; nothing is editable.
 */
export function resultCell(value: string | null | undefined, kind: ColumnKind, nullTheme: Partial<Theme>): GridCell {
  if (value === undefined) return { kind: GridCellKind.Loading, allowOverlay: false };
  if (value === null) return { kind: GridCellKind.Text, data: 'null', displayData: 'null', copyData: '', allowOverlay: false, readonly: true, themeOverride: nullTheme };
  return { kind: GridCellKind.Text, data: value, displayData: value, allowOverlay: false, readonly: true, contentAlign: NUMERIC.includes(kind) ? 'right' : 'left' };
}

/** The italic, subtle look of a null, from the current grid theme. */
export const nullTheme = (theme: { textLight: string; baseFontStyle: string }): Partial<Theme> => ({ textDark: theme.textLight, baseFontStyle: `italic ${theme.baseFontStyle}` });
