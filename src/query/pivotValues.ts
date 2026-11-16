// Reading the values a Pivot columns field turns into columns: asked of DuckDB once, then kept in the design.
import { compile, MAX_PIVOT_COLUMNS, pivotValuesSpec, pivotValuesSql } from '../compiler';
import { tableRows, type EngineClient } from '../engine/client';
import { schemaCacheFor } from '../flow/status';
import { nodeById, setQueryDesign, type Project } from '../model';

/** Thrown when a field has more values than can become columns. */
export class TooManyPivotValues extends Error {}

/**
 * The values of a Query's field, each once and in order, as text: what its Pivot columns would be. Read from the
 * query's own tables and joins, behind its Where fields, as DuckDB writes them as text (what the pivot columns compare
 * with). Nulls are left out: no column is named for them.
 */
export async function readPivotValues(engine: EngineClient, project: Project, nodeId: string, fieldId: string): Promise<string[]> {
  const node = nodeById(project, nodeId);
  const probe = node?.type === 'query' ? pivotValuesSpec(node.querySpec, fieldId) : undefined;
  if (!probe) return [];
  const asked = setQueryDesign(project, nodeId, probe);
  const cache = schemaCacheFor(engine);
  await cache.prepare(asked, { nodeId });
  const result = await engine.query(pivotValuesSql(compile(asked, { nodeId }, { schemas: cache.book }).sql), { label: 'Reading the values to pivot on' });
  const values = tableRows(result.table)
    .map((row) => Object.values(row)[0])
    .filter((v) => v != null)
    .map(String);
  const unique = [...new Set(values)];
  if (unique.length > MAX_PIVOT_COLUMNS) throw new TooManyPivotValues(`It has more than ${MAX_PIVOT_COLUMNS} values, and only ${MAX_PIVOT_COLUMNS} can become columns. Filter it, or put it in Rows.`);
  return unique;
}
