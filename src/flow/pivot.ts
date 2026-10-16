// Reading the values a pivot's Columns field turns into columns, when the step is set up or refreshed.
import { compilePivotValues, MAX_PIVOT_VALUES, type Condition, type Target } from '../compiler';
import { tableRows, type EngineClient } from '../engine';
import type { Project } from '../model';

export interface PivotValuesRead {
  /** The values that become columns, in the column's order, at most MAX_PIVOT_VALUES. */
  values: string[];
  /** Whether there were more than that. */
  more: boolean;
}

/** The distinct values of `column` arriving at `target` (the step's input), after the pivot's filters. */
export async function readPivotValues(engine: EngineClient, project: Project, target: Target, pivot: { column: string; filters: Condition[] }): Promise<PivotValuesRead> {
  const rows = tableRows((await engine.query(compilePivotValues(project, target, pivot))).table);
  const all = rows.map((r) => String(r.v));
  return { values: all.slice(0, MAX_PIVOT_VALUES), more: all.length > MAX_PIVOT_VALUES };
}
