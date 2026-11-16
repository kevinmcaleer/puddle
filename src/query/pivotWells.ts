// The Pivot view's wells, and how the design grid's fields map onto them.
import { typeFamily } from '../compiler';
import type { ColumnSchema, QueryField } from '../model';

/** The four places a field can go, as in a spreadsheet's pivot table. */
export type PivotWell = 'rows' | 'columns' | 'values' | 'filters';

/** Which well a grid field is in. Its Total says, whether or not the Totals row is on yet. */
export function wellOf(f: QueryField): PivotWell | undefined {
  if (f.column === '*') return undefined;
  const total = f.total ?? 'group';
  if (total === 'group') return 'rows';
  if (total === 'pivot') return 'columns';
  if (total === 'where') return 'filters';
  return 'values';
}

/** What a field takes on when it lands in a well: its Total, and whether it shows. Numbers are summed, the rest counted. */
export function landing(well: PivotWell, column: ColumnSchema | undefined): Partial<QueryField> {
  if (well === 'rows') return { total: undefined, show: true };
  if (well === 'columns') return { total: 'pivot', show: true, sort: 'none' };
  if (well === 'filters') return { total: 'where', show: false, sort: 'none' };
  return { total: column && typeFamily(column.type) === 'number' ? 'sum' : 'count', show: true };
}
