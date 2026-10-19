// A table's data sample for the Schema diagram: the first rows of its Schema table node when the project has one (its
// records, examples and whatever loads into it), otherwise the records written in the DBML.
import { compile, textSample } from '../compiler';
import { tableRows, type EngineClient } from '../engine/client';
import { countRows, schemaCacheFor } from '../flow/status';
import type { Project } from '../model';
import type { DbmlSchema, RecordValue, Table } from '../schema';

export const SAMPLE_ROWS = 5;

export interface TableSample {
  columns: string[];
  /** As text; null for a null. */
  rows: (string | null)[][];
  /** Every row there is, when known. */
  total?: number;
  /** Where the rows came from: the node that holds the table, or the DBML's records. */
  from: { node: string; name: string } | 'records';
}

/** The Schema table node holding a table, if the project has one. */
export const nodeFor = (project: Project, t: Pick<Table, 'schema' | 'name'>) => project.nodes.find((n) => n.type === 'table' && n.tableSpec.schema === t.schema && n.tableSpec.table === t.name);

const text = (v: RecordValue): string | null => (v.kind === 'null' || v.kind === 'empty' ? null : v.kind === 'enum' ? v.value.split('.').pop()! : v.value);

/** The records (real ones first, then examples) the DBML holds for a table. */
export function recordsSample(schema: DbmlSchema, t: Table): TableSample {
  const blocks = schema.records.filter((r) => r.schema === t.schema && r.table === t.name).sort((a, b) => Number(a.example) - Number(b.example));
  const columns = t.columns.map((c) => c.name).filter((c) => blocks.some((b) => b.columns.includes(c)));
  const all = blocks.flatMap((b) => b.rows.map((row) => columns.map((c) => (b.columns.includes(c) ? text(row[b.columns.indexOf(c)]!) : null))));
  return { columns, rows: all.slice(0, SAMPLE_ROWS), total: all.length, from: 'records' };
}

/** The first rows of a table: from its node through DuckDB when there is one, else from its records. */
export async function tableSample(engine: EngineClient | null, project: Project, schema: DbmlSchema, t: Table): Promise<TableSample> {
  const node = nodeFor(project, t);
  if (!node || !engine) return recordsSample(schema, t);
  const cache = schemaCacheFor(engine);
  await cache.prepare(project, { nodeId: node.id });
  const sql = compile(project, { nodeId: node.id }, { schemas: cache.book }).sql;
  const columns = (await engine.describe(sql)).map((c) => c.name);
  const result = await engine.query(textSample(sql, columns, SAMPLE_ROWS), { priority: 'background', label: 'Reading a data sample' });
  const rows = tableRows(result.table).map((r) => columns.map((c) => (r[c] == null ? null : String(r[c]))));
  const total = await countRows(engine, project, node.id).catch(() => undefined);
  return { columns, rows, total, from: { node: node.id, name: node.name } };
}
