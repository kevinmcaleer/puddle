// Writing a quality report from what the app knows now: the rules panel's results, plus the engine for sources and samples.
import { useEngineStore } from '../app/engine';
import { saveBlob } from '../export/deliver';
import { useRuleStore } from '../flow/rules';
import { applySample, currentSample } from '../flow/sample';
import { useFlowStore } from '../flow/status';
import { nodeById, useProjectStore, type Project } from '../model';
import { buildReport, reportNodeIds, reportPending, type QualityReport, type ReportFormat, type ReportSample, type ReportScope } from './build';
import { collectSamples, collectSources } from './collect';
import { reportMarkdown } from './markdown';
import { FORMAT_INFO, reportFileName } from './words';

export interface ReportOptions {
  format: ReportFormat;
  scope: ReportScope;
  /** Failing rows per rule; 0 for none. */
  samples: number;
}

/** Nodes that won't run as things stand, so their rules are never checked: the report says so instead of waiting. */
export function cantRunIn(nodeIds: string[]): string[] {
  const statuses = useFlowStore.getState().nodes;
  return nodeIds.filter((id) => {
    const state = statuses[id]?.status.state;
    return !!state && state !== 'ok' && state !== 'pending';
  });
}

/** Whether the report on these nodes still waits for rule results. */
export function reportWaiting(project: Project, nodeIds: string[]): boolean {
  return reportPending(project, nodeIds, useRuleStore.getState().nodes, cantRunIn(nodeIds));
}

/** Gather and put together the report for a node. */
export async function makeReport(nodeId: string, { scope, samples }: Omit<ReportOptions, 'format'>, now = new Date()): Promise<QualityReport> {
  const engine = useEngineStore.getState().engine;
  if (!engine) throw new Error('The data engine is still starting.');
  const project = useProjectStore.getState().history.present;
  if (!nodeById(project, nodeId)) throw new Error('That node is no longer in the project.');
  const nodeIds = reportNodeIds(project, nodeId, scope);
  const results = useRuleStore.getState().nodes;
  const cantRun = cantRunIn(nodeIds);
  if (reportPending(project, nodeIds, results, cantRun)) throw new Error('Rules are still being checked. Try again in a moment.');
  const sample = currentSample(project);
  const view = applySample(project, sample);
  const sources = await collectSources(engine, project, nodeIds);
  const sampleRows: Record<string, Record<string, ReportSample>> = {};
  if (samples > 0) for (const id of nodeIds) if (!cantRun.includes(id)) sampleRows[id] = await collectSamples(engine, view, id, results[id]?.results, samples);
  return buildReport({ project, nodeIds, scope, results, sample, sources, samples: sampleRows, sampleLimit: samples, generatedAt: now.toISOString(), cantRun });
}

/** The report in a format, as text. HTML loads its renderer only when asked for. */
export async function writeReport(report: QualityReport, format: ReportFormat): Promise<string> {
  if (format === 'json') return `${JSON.stringify(report, null, 2)}\n`;
  if (format === 'markdown') return reportMarkdown(report);
  return (await import('./html')).reportHtml(report);
}

/** Write the report and download it; resolves to the file's name. */
export async function exportQualityReport(nodeId: string, options: ReportOptions): Promise<string> {
  const report = await makeReport(nodeId, options);
  const text = await writeReport(report, options.format);
  const fileName = reportFileName(report.project.name, options.format);
  saveBlob(new Blob([text], { type: FORMAT_INFO[options.format].mime }), fileName);
  return fileName;
}
