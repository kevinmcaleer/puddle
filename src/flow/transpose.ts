// Reading what Transpose fixes when it's set up or refreshed: how many rows its input has, and the first column's values.
import { compileTransposeRows, MAX_TRANSPOSE_ROWS, type Target } from '../compiler';
import { tableRows, type EngineClient } from '../engine';
import type { Project } from '../model';

export interface TransposeRowsRead {
  /** The input's row count. */
  rowCount: number;
  /** The first column's values as text, one per row; empty when there are too many rows to transpose. */
  headerValues: (string | null)[];
}

/** Read the rows arriving at `target` (the step's input), with `header`'s values. */
export async function readTransposeRows(engine: EngineClient, project: Project, target: Target, header: string): Promise<TransposeRowsRead> {
  const rows = tableRows((await engine.query(compileTransposeRows(project, target, header))).table);
  const rowCount = rows.length ? Number(rows[0]!.n) : 0;
  return { rowCount, headerValues: rowCount > MAX_TRANSPOSE_ROWS ? [] : rows.map((r) => (r.v == null ? null : String(r.v))) };
}
