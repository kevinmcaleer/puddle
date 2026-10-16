// Building a new step from the Add step menu: its defaults come from the columns arriving where it goes.
import { compileDisplayPage } from '../compiler';
import { detectDateFormats, type Detection } from '../dates';
import { tableRows, type EngineClient } from '../engine/client';
import { schemaCacheFor } from '../flow/status';
import { readTransposeRows } from '../flow/transpose';
import type { ColumnSchema, Project, Step } from '../model';
import { newStep, type StepForm } from '../steps';

/** The columns arriving after step `after` (-1 for the node's input); none when they can't be read. */
export async function columnsAfter(engine: EngineClient, project: Project, nodeId: string, after: number): Promise<ColumnSchema[]> {
  try {
    return await schemaCacheFor(engine).get(project, { nodeId, stepIndex: after });
  } catch {
    return [];
  }
}

/** The first row arriving after step `after`, as text; empty when it can't be read. */
async function readFirstRow(engine: EngineClient, project: Project, nodeId: string, after: number, columns: ColumnSchema[]): Promise<Record<string, string | null>> {
  if (!columns.length) return {};
  try {
    const sql = compileDisplayPage(project, { nodeId, stepIndex: after }, columns.map((c) => c.name), 0, 1);
    const [row] = tableRows((await engine.query(sql)).table);
    return Object.fromEntries(Object.entries(row ?? {}).map(([k, v]) => [k, v == null ? null : String(v)]));
  } catch {
    return {};
  }
}

/** Date formats detected on the first of these columns as it arrives after step `after`. */
async function detectFor(engine: EngineClient, project: Project, nodeId: string, after: number, columns: unknown): Promise<Detection | undefined> {
  const column = Array.isArray(columns) && typeof columns[0] === 'string' ? columns[0] : undefined;
  if (!column) return undefined;
  return detectDateFormats(engine, project, { nodeId, stepIndex: after }, column).catch(() => undefined);
}

/** The rows arriving after step `after`, as Transpose reads them; undefined when they can't be read. */
async function readRowsFor(engine: EngineClient, project: Project, nodeId: string, after: number, columns: ColumnSchema[]) {
  if (!columns[0]) return undefined;
  return readTransposeRows(engine, project, { nodeId, stepIndex: after }, columns[0].name).catch(() => undefined);
}

/**
 * A new step of this form, to go after step `after` of the node. `known` is what the inspector already has of the
 * arriving columns; while that is still empty (the input is still being read) the columns are read here, so the
 * step's defaults never start from nothing. Without an engine the step gets whatever `known` gives.
 */
export async function buildStep(form: StepForm, engine: EngineClient | null, project: Project, nodeId: string, after: number, known: ColumnSchema[], selected: string[]): Promise<Step> {
  if (!engine) return newStep(form.type, { selected, available: known });
  const available = known.length ? known : await columnsAfter(engine, project, nodeId, after);
  const firstRow = form.needsFirstRow ? await readFirstRow(engine, project, nodeId, after, available) : undefined;
  const dates = form.detectsDates ? await detectFor(engine, project, nodeId, after, form.defaults({ selected, available }).columns) : undefined;
  const rows = form.readsRows ? await readRowsFor(engine, project, nodeId, after, available) : undefined;
  return newStep(form.type, { selected, available, firstRow, dates, rows });
}
