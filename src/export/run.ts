// Running an export: check the quality gate, have DuckDB write the file, hand it over and log it.
import { create } from 'zustand';
import { useEngineStore } from '../app/engine';
import { useSession } from '../app/session';
import { CompileError, compileExport, EXPORT_FORMATS, exportFileName, type ExportFormat } from '../compiler';
import type { EngineClient } from '../engine';
import { describeBlock, exportGate, type Gate } from '../flow/gate';
import { useRuleStore } from '../flow/rules';
import { useFlowStore } from '../flow/status';
import { logExport, newId, nodeById, topoSort, useProjectStore, type ExportLogEntry, type Project } from '../model';
import { copyText, saveBlob } from './deliver';

/** Clipboard exports above this size are refused: pasting them would hang most spreadsheets anyway. */
export const CLIPBOARD_LIMIT = 10 * 1024 * 1024;

export class ExportBlocked extends Error {
  constructor(readonly gate: Extract<Gate, { state: 'blocked' }>) {
    super(`Export blocked. ${gate.blocking.map(describeBlock).join(' ')}`);
  }
}

export type Delivery = (blob: Blob, fileName: string, format: ExportFormat) => Promise<void>;

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
  // A fresh name each time, so two exports never write to the same file.
  const { blob, rows } = await engine.exportFile(`${newId('x')}.${EXPORT_FORMATS[spec.format].ext}`, (path) => compileExport(project, nodeId, path), { priority: 'preview' });
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

const deliverToBrowser: Delivery = async (blob, fileName, format) => {
  if (format === 'clipboard') await copyText(await blob.text());
  else saveBlob(blob, fileName);
};

/** Output nodes being exported right now, so their buttons show it. */
export const useExporting = create<{ nodes: Record<string, true> }>(() => ({ nodes: {} }));

const busy = (nodeId: string, on: boolean) =>
  useExporting.setState((s) => {
    const nodes = { ...s.nodes };
    if (on) nodes[nodeId] = true;
    else delete nodes[nodeId];
    return { nodes };
  });

const messageOf = (e: unknown) => (e instanceof Error ? e.message : String(e));

const done = (entry: Omit<ExportLogEntry, 'id'>) =>
  entry.format === 'clipboard' ? `Copied ${entry.rows} ${entry.rows === 1 ? 'row' : 'rows'} from ${entry.nodeName}.` : `Exported ${entry.fileName} (${entry.rows} ${entry.rows === 1 ? 'row' : 'rows'}).`;

async function exportOne(nodeId: string, override: boolean): Promise<Omit<ExportLogEntry, 'id'>> {
  const engine = useEngineStore.getState().engine;
  if (!engine) throw new Error('The data engine is still starting.');
  const project = useProjectStore.getState().history.present;
  busy(nodeId, true);
  try {
    const entry = await runExport(engine, project, nodeId, { gate: exportGate(project, nodeId, useRuleStore.getState().nodes), override, deliver: deliverToBrowser });
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
        exported.push((await exportOne(node.id, false)).fileName);
      } catch (e) {
        skipped.push(`${node.name}: ${messageOf(e)}`);
      }
    }
  }
  const text = [exported.length ? `Exported ${exported.join(', ')}.` : 'Nothing exported.', skipped.length ? `Skipped ${skipped.join('; ')}.` : ''].filter(Boolean).join(' ');
  useSession.getState().notify({ tone: skipped.length ? 'warn' : 'info', text });
}
