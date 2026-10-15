import { compileDateDetection, type Target } from '../compiler';
import { tableRows, type EngineClient } from '../engine/client';
import type { Project } from '../model';
import { formatsToTry, rankFormats, type Detection, type FormatMatch } from './formats';

/** Try every format on a sample of the column at the target and rank them. Used by the step editor and the quick fix. */
export async function detectDateFormats(engine: EngineClient, project: Project, target: Target, column: string): Promise<Detection> {
  const projectFormats = project.settings.defaultDateFormats;
  const sql = compileDateDetection(project, target, column, formatsToTry(projectFormats));
  const rows = tableRows((await engine.query(sql)).table);
  const matches: FormatMatch[] = rows.map((r) => ({ format: String(r.format), matched: Number(r.matched), total: Number(r.total), example: r.example == null ? null : String(r.example) }));
  return rankFormats(matches, projectFormats);
}
