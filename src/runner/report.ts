// The quality report a run leaves beside its outputs: the report the browser writes (src/report), put together from
// the run's rule results and the analysis each node keeps, written as Markdown, JSON and HTML. Pure.
import { buildReport, reportable, type QualityReport, type ReportFormat, type ReportSource } from '../report/build';
import { reportHtml } from '../report/html';
import { reportMarkdown } from '../report/markdown';
import { FORMAT_INFO } from '../report/words';
import type { RuleResult } from '../flow/ruleResult';
import { nodeById, topoSort, type Project } from '../model';

/** Every node with rules or a kept analysis, upstream first, as the browser's "Every node with rules" scope. */
export function runReport(project: Project, rules: Record<string, Record<string, RuleResult>>, sources: ReportSource[], generatedAt: string): QualityReport {
  const nodeIds = topoSort(project).filter((id) => reportable(nodeById(project, id)));
  const results = Object.fromEntries(Object.entries(rules).map(([id, r]) => [id, { results: r }]));
  return buildReport({ project, nodeIds, scope: 'all', results, sample: null, sources, sampleLimit: 0, generatedAt });
}

/** The report in one format, as text. */
export function writeReportText(report: QualityReport, format: ReportFormat): string {
  if (format === 'json') return `${JSON.stringify(report, null, 2)}\n`;
  if (format === 'markdown') return reportMarkdown(report);
  return reportHtml(report);
}

/** The three files a run writes, by name: `<slug>.quality.md`, `.quality.json` and `.quality.html`. */
export function reportFiles(report: QualityReport, slug: string): Record<string, string> {
  return Object.fromEntries((Object.keys(FORMAT_INFO) as ReportFormat[]).map((f) => [`${slug}.quality.${FORMAT_INFO[f].ext}`, writeReportText(report, f)]));
}
