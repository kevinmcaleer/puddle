import { compileDateDetection, type Target } from '../compiler';
import { tableRows, type EngineClient } from '../engine/client';
import type { Project } from '../model';
import { formatsToTry, rankFormats, type Detection } from './formats';

/**
 * Try every format on a sample of the column at the target, rank them and choose the ones to use. Used by the step editor and the quick fix.
 * With the parse dates step's locale, its month and day names are read and its day and month order settles an unclear one.
 */
export async function detectDateFormats(engine: EngineClient, project: Project, target: Target, column: string, locale?: string): Promise<Detection> {
  return detectDateFormatsWith(async (sql) => tableRows((await engine.query(sql)).table), project, target, column, locale);
}

/** The same detection on any way of running SQL for rows: the runner's DuckDB, or the engine. */
export async function detectDateFormatsWith(query: (sql: string) => Promise<Record<string, unknown>[]>, project: Project, target: Target, column: string, locale?: string): Promise<Detection> {
  const projectFormats = project.settings.defaultDateFormats;
  const tried = formatsToTry(projectFormats, locale);
  const rows = await query(compileDateDetection(project, target, column, tried, undefined, locale));
  const values = rows.map((r) => ({ value: String(r.value), count: Number(r.n), reads: String(r.reads ?? '').split(',').filter(Boolean).map((i) => tried[Number(i)]!) }));
  return { ...rankFormats(values, projectFormats, locale), tried };
}
