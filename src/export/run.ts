// Running an export: check the quality gate, have DuckDB write the file, hand it over and log it.
import { create } from 'zustand';
import { useEngineStore } from '../app/engine';
import { useSession } from '../app/session';
import { tableToIPC } from 'apache-arrow';
import { CompileError, compileExport, compileFullCount, compileFullData, compileRules, compileSheetExport, EXPORT_FORMATS, exportFileName, exportOptions, type ExportFormat, type XlsxExportOptions } from '../compiler';
import { excelClient } from '../excel/client';
import { SHEET_COLUMNS, SHEET_ROWS, sheetNameProblem, tooManyRows, toSheetName } from '../excel/limits';
import { isStopped, tableRows, toEngineError, type EngineClient } from '../engine';
import { describeBlock, exportGate, type Gate } from '../flow/gate';
import { useRuleStore, type RuleResult } from '../flow/rules';
import { currentSample, sampledUpstream, type Sample } from '../flow/sample';
import { schemaCacheFor, useFlowStore } from '../flow/status';
import { logExport, newId, nodeById, topoSort, upstreamIds, useProjectStore, type ExportLogEntry, type OutputNode, type Project } from '../model';
import { copyText, saveBlob } from './deliver';

/** Clipboard exports above this size are refused: pasting them would hang most spreadsheets anyway. */
export const CLIPBOARD_LIMIT = 10 * 1024 * 1024;

export class ExportBlocked extends Error {
  constructor(readonly gate: Extract<Gate, { state: 'blocked' }>) {
    super(`Export blocked. ${gate.blocking.map(describeBlock).join(' ')}`);
  }
}

export type Delivery = (blob: Blob, fileName: string, format: ExportFormat) => Promise<void>;

/** The sheet an Excel export writes: its own name if set, else one made from the Output node's name. */
export function sheetNameFor(node: OutputNode): string {
  const o = exportOptions(node.outputSpec) as XlsxExportOptions;
  return o.sheetName?.trim() || toSheetName(node.name);
}

/**
 * Write an Output node as an Excel workbook. DuckDB can't write .xlsx, so the rows come back as Arrow batches and
 * SheetJS writes them in the Excel worker; they never become one big array of row objects on the main thread.
 * Above a sheet's row limit nothing is written: the export says why and suggests CSV or Parquet.
 */
async function writeExcel(engine: EngineClient, project: Project, node: OutputNode, label: string): Promise<{ blob: Blob; rows: number }> {
  const o = exportOptions(node.outputSpec) as XlsxExportOptions;
  const sheetName = sheetNameFor(node);
  const problem = sheetNameProblem(sheetName);
  if (problem) throw new Error(`${problem} Change the sheet name in the export settings.`);
  const [{ n }] = tableRows((await engine.query(compileFullCount(project, node.id), { priority: 'preview', label })).table) as [{ n: number }];
  if (Number(n) > SHEET_ROWS - (o.header ? 1 : 0)) throw new Error(tooManyRows(Number(n), o.header));
  const columns = await engine.describe(compileFullData(project, node.id), { priority: 'preview', label });
  if (columns.length > SHEET_COLUMNS) throw new Error(`This output has ${columns.length} columns; an Excel sheet holds at most ${SHEET_COLUMNS.toLocaleString('en-GB')}. Export it as CSV or Parquet instead.`);
  const result = await engine.query(compileSheetExport(project, node.id, columns), { priority: 'preview', label });
  const ipc = tableToIPC(result.table, 'stream');
  // Arrow writes nothing for a table built by another copy of its classes; say so rather than export an empty sheet.
  if (!ipc.byteLength) throw new Error('The rows couldn’t be handed to the Excel writer. Reload Puddle and try again.');
  const { data } = await excelClient().call('write', { ipc, options: { sheetName, header: o.header, freezeHeader: o.freezeHeader } });
  return { blob: new Blob([data as Uint8Array<ArrayBuffer>], { type: EXPORT_FORMATS.xlsx.mime }), rows: result.numRows };
}

/**
 * Export one Output node. A blocked gate stops it unless `override` is set, and the override is logged with the
 * rules it went past. Returns the log entry; the caller records it.
 */
export async function runExport(
  engine: EngineClient,
  project: Project,
  nodeId: string,
  { gate, override = false, deliver }: { gate: Gate; override?: boolean; deliver: Delivery },
): Promise<Omit<ExportLogEntry, 'id'>> {
  const node = nodeById(project, nodeId);
  if (!node || node.type !== 'output') throw new CompileError('Only Output nodes export.', nodeId);
  if (gate.state === 'blocked' && !override) throw new ExportBlocked(gate);
  if (gate.state === 'checking' && !override) throw new Error('Rules are still being checked. Try again in a moment.');
  const spec = node.outputSpec;
  const fileName = exportFileName(node.name, spec);
  const label = `Exporting ${node.name}`;
  // A fresh name each time, so two exports never write to the same file.
  const { blob, rows } =
    spec.format === 'xlsx'
      ? await writeExcel(engine, project, node, label)
      : await engine.exportFile(`${newId('x')}.${EXPORT_FORMATS[spec.format].ext}`, (path) => compileExport(project, nodeId, path), { priority: 'preview', label });
  if (spec.format === 'clipboard' && blob.size > CLIPBOARD_LIMIT)
    throw new Error(`That’s too much to copy (${Math.round(blob.size / 1024 / 1024)} MB). Export it as a file instead.`);
  await deliver(blob, fileName, spec.format);
  return {
    at: new Date().toISOString(),
    nodeId,
    nodeName: node.name,
    format: spec.format,
    fileName: spec.format === 'clipboard' ? 'Clipboard' : fileName,
    rows,
    ...(gate.state === 'blocked' ? { overridden: gate.blocking.map((b) => ({ nodeName: b.nodeName, rule: b.label })) } : {}),
  };
}

/**
 * In sample mode the flow only described the sampled copy, so a Join upstream doesn't know its inputs' columns on
 * the full data yet. Describe them (cheap: DESCRIBE doesn't read rows) before compiling the full-data queries.
 */
async function prepareFullData(engine: EngineClient, project: Project, nodeId: string) {
  await schemaCacheFor(engine).prepare(project, { nodeId });
}

/**
 * The quality gate an export goes through. Rule results on screen come from the sample in sample mode, and a
 * sample passing says nothing about the rest, so the upstream rules are checked again on the full data first.
 */
export async function exportGateFor(engine: EngineClient, project: Project, nodeId: string, sample: Sample | null): Promise<Gate> {
  const stored = useRuleStore.getState().nodes;
  if (!sampledUpstream(project, nodeId, sample).length) return exportGate(project, nodeId, stored);
  await prepareFullData(engine, project, nodeId);
  const results: Record<string, { results: Record<string, RuleResult> }> = {};
  for (const id of topoSort(project, upstreamIds(project, nodeId))) {
    const rules = nodeById(project, id)?.rules.filter((r) => r.enabled && r.severity === 'fail') ?? [];
    if (!rules.length) continue;
    const entry: Record<string, RuleResult> = {};
    try {
      const r = tableRows((await engine.query(compileRules(project, id, rules), { priority: 'preview', label: 'Checking rules on the full data' })).table)[0]!;
      rules.forEach((rule, i) => (entry[rule.id] = { state: 'ok', failures: Number(r[`f${i}`]), total: Number(r.total) }));
    } catch (e) {
      if (isStopped(e)) throw e;
      for (const rule of rules) entry[rule.id] = { state: 'error', message: e instanceof CompileError ? e.message : toEngineError(e).message };
    }
    results[id] = { results: entry };
  }
  return exportGate(project, nodeId, results);
}

const deliverToBrowser: Delivery = async (blob, fileName, format) => {
  if (format === 'clipboard') await copyText(await blob.text());
  else saveBlob(blob, fileName);
};

/** Output nodes being exported right now, with when each started, so their buttons show the time taken. */
export const useExporting = create<{ nodes: Record<string, number> }>(() => ({ nodes: {} }));

const busy = (nodeId: string, on: boolean) =>
  useExporting.setState((s) => {
    const nodes = { ...s.nodes };
    if (on) nodes[nodeId] = Date.now();
    else delete nodes[nodeId];
    return { nodes };
  });

const messageOf = (e: unknown) => (e instanceof Error ? e.message : String(e));

const done = (entry: Omit<ExportLogEntry, 'id'>) =>
  entry.cancelled
    ? `Stopped exporting ${entry.nodeName}. Nothing was saved.`
    : entry.format === 'clipboard' ? `Copied ${entry.rows} ${entry.rows === 1 ? 'row' : 'rows'} from ${entry.nodeName}.` : `Exported ${entry.fileName} (${entry.rows} ${entry.rows === 1 ? 'row' : 'rows'}).`;

async function exportOne(nodeId: string, override: boolean): Promise<Omit<ExportLogEntry, 'id'>> {
  const engine = useEngineStore.getState().engine;
  if (!engine) throw new Error('The data engine is still starting.');
  const project = useProjectStore.getState().history.present;
  const node = nodeById(project, nodeId);
  busy(nodeId, true);
  try {
    await prepareFullData(engine, project, nodeId);
    const gate = await exportGateFor(engine, project, nodeId, currentSample(project));
    if (gate.state === 'blocked' && !override && sampledUpstream(project, nodeId, currentSample(project)).length)
      throw new Error(`Export blocked on the full data. ${gate.blocking.map(describeBlock).join(' ')} Run on full data to see the failing rows, or to export anyway.`);
    const entry = await runExport(engine, project, nodeId, { gate, override, deliver: deliverToBrowser });
    useProjectStore.getState().amend((p) => logExport(p, entry));
    return entry;
  } catch (e) {
    // A stopped export leaves nothing behind (DuckDB's file is discarded before any download) and is logged as cancelled.
    if (!isStopped(e) || node?.type !== 'output') throw e;
    const spec = node.outputSpec;
    const entry: Omit<ExportLogEntry, 'id'> = {
      at: new Date().toISOString(),
      nodeId,
      nodeName: node.name,
      format: spec.format,
      fileName: spec.format === 'clipboard' ? 'Clipboard' : exportFileName(node.name, spec),
      rows: 0,
      cancelled: true,
    };
    useProjectStore.getState().amend((p) => logExport(p, entry));
    return entry;
  } finally {
    busy(nodeId, false);
  }
}

/** Export one Output node from the UI, saying how it went. */
export async function exportNode(nodeId: string, override = false): Promise<void> {
  try {
    useSession.getState().notify({ tone: 'info', text: done(await exportOne(nodeId, override)) });
  } catch (e) {
    useSession.getState().notify({ tone: 'fail', text: messageOf(e) });
  }
}

/** Export every Output node that can run and isn't blocked; blocked ones are named, never overridden. */
export async function exportAll(): Promise<void> {
  const project = useProjectStore.getState().history.present;
  const statuses = useFlowStore.getState().nodes;
  const outputs = topoSort(project).map((id) => nodeById(project, id)!).filter((n) => n.type === 'output');
  if (!outputs.length) return useSession.getState().notify({ tone: 'info', text: 'Add an Output node to say what to export.' });
  const exported: string[] = [];
  const skipped: string[] = [];
  for (const node of outputs) {
    const gate = exportGate(project, node.id, useRuleStore.getState().nodes);
    if (statuses[node.id]?.status.state !== 'ok') skipped.push(`${node.name} can’t run`);
    else if (gate.state === 'blocked') skipped.push(`${node.name} is blocked by ${gate.blocking.map((b) => b.label).join(', ')}`);
    else if (gate.state === 'checking') skipped.push(`${node.name} is still checking rules`);
    else {
      try {
        const entry = await exportOne(node.id, false);
        if (entry.cancelled) {
          skipped.push(`${node.name} was stopped`);
          break;
        }
        exported.push(entry.fileName);
      } catch (e) {
        skipped.push(`${node.name}: ${messageOf(e)}`);
      }
    }
  }
  const text = [exported.length ? `Exported ${exported.join(', ')}.` : 'Nothing exported.', skipped.length ? `Skipped ${skipped.join('; ')}.` : ''].filter(Boolean).join(' ');
  useSession.getState().notify({ tone: skipped.length ? 'warn' : 'info', text });
}
