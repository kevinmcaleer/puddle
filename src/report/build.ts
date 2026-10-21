// A quality report: what a project's rules found, as plain data every format is written from.
import { ruleColumns, ruleRefs, ruleScope } from '../compiler';
import type { RuleResult } from '../flow/rules';
import { sampledUpstream, type Sample } from '../flow/sampling';
import { nodeById, topoSort, upstreamIds, type GraphNode, type Project, type Rule, type Source } from '../model';
// The forms file itself, not the rules index, which reaches for the engine: this module runs in puddle-run too.
import { ruleForm, ruleLabel } from '../rules/forms';
import { qualified } from '../schema/model';

/** Names the JSON format; bump the number when a field changes meaning or goes away (adding one doesn't). */
export const REPORT_SCHEMA = 'puddle-quality-report/1';

/** The node the report was asked for (with, for an Output node, the nodes its export checks), or every node with rules. */
export type ReportScope = 'node' | 'all';

export type ReportFormat = 'markdown' | 'json' | 'html';

/** How a rule stands. A failed fail rule someone exported past is `overridden`, never `pass`. */
export type ReportStatus = 'pass' | 'warn' | 'fail' | 'overridden' | 'error' | 'off' | 'pending';

/** Failing rows of one rule, every value as text (null for empty). */
export interface ReportSample {
  columns: string[];
  rows: (string | null)[][];
  /** Why the rows couldn't be read, in place of them. */
  error?: string;
}

export interface ReportOverride {
  /** When the export went past the failing rule. There are no user accounts, so who did it isn't known. */
  at: string;
  outputName: string;
  fileName: string;
}

export interface ReportRule {
  id: string;
  /** The rule as an expectation, as the rules panel names it. */
  label: string;
  /** The rule's type, e.g. noEdgeSpaces, and its name in the Add rule menu. */
  kind: string;
  kindLabel: string;
  severity: 'warn' | 'fail';
  enabled: boolean;
  /** 'table' rules (a row count) check the whole output: they have a result but no failing rows. */
  scope: 'row' | 'table';
  columns: string[];
  status: ReportStatus;
  /** Rows checked; for a table rule, the output's row count. Null until checked, or when the rule can't run. */
  total: number | null;
  /** Row rules only: rows that pass and fail, and the failing share in percent (two decimals). */
  passed: number | null;
  failed: number | null;
  failedPercent: number | null;
  error?: string;
  override?: ReportOverride;
  sample?: ReportSample;
}

/** What became of an issue analysis found: Fix all fixed it, the user ignored it, or it is still there. */
export type IssueOutcome = 'fixed' | 'ignored' | 'open';

export interface ReportIssue {
  key: string;
  kind: string;
  /** The column, or null for an issue about the whole table. */
  column: string | null;
  /** The value, for issues listed per value (a likely misspelling). */
  value?: string;
  /** The issue in words, as the Issues panel lists it. */
  label: string;
  /** Rows (or, for mixed capitals, values) the issue touched. */
  count: number;
  outcome: IssueOutcome;
}

/** The issues analysis last found in a node's output, with what became of each. */
export interface ReportAnalysis {
  /** When Fix all ran, or an issue was ignored: the analysis the node keeps is from then. */
  at: string;
  /** Rows the node had then. */
  rows: number;
  found: number;
  fixed: number;
  ignored: number;
  open: number;
  issues: ReportIssue[];
}

export interface ReportNode {
  id: string;
  name: string;
  type: GraphNode['type'];
  /** Rules were checked on a sample of large sources, so counts are of sampled rows. */
  onSample: boolean;
  rules: ReportRule[];
  /** Only for a node Fix all ran on or an issue was ignored on. */
  analysis?: ReportAnalysis;
}

export interface ReportSource {
  id: string;
  name: string;
  kind: Source['kind'];
  format: Source['format'];
  /** Full row count; null when the source couldn't be read. */
  rows: number | null;
  /** SHA-256 of the first 1 MB, as hex; null when not known (a web address fetched without one). */
  headHash: string | null;
}

export interface QualityReport {
  schema: typeof REPORT_SCHEMA;
  project: { id: string; name: string };
  generatedAt: string;
  scope: ReportScope;
  /** Failing rows per rule included (0 when the report carries no row values). */
  sampleLimit: number;
  /** Rows read from each sampled source, when any rule was checked on a sample. */
  sampleRows: number | null;
  summary: Record<ReportStatus, number> & { rules: number };
  sources: ReportSource[];
  nodes: ReportNode[];
}

/** A node the report has something to say about: it has rules, or analysis found issues that were fixed or ignored. */
export const reportable = (node: GraphNode | undefined) => !!node && (node.rules.length > 0 || node.analysis != null);

/** The nodes a report covers, upstream first: for an Output node, it and every node before it that has rules or an analysis. */
export function reportNodeIds(project: Project, nodeId: string, scope: ReportScope): string[] {
  const node = nodeById(project, nodeId);
  if (scope === 'all') return topoSort(project).filter((id) => reportable(nodeById(project, id)));
  if (node?.type !== 'output') return node ? [nodeId] : [];
  return topoSort(project, upstreamIds(project, nodeId)).filter((id) => id === nodeId || reportable(nodeById(project, id)));
}

/** The node's kept analysis as the report lists it: each issue with its outcome, and the counts. */
export function reportAnalysis(node: GraphNode): ReportAnalysis | undefined {
  const a = node.analysis;
  if (!a) return undefined;
  const ignored = node.ignoredIssues ?? [];
  const issues = a.issues.map((i): ReportIssue => ({
    key: i.key,
    kind: i.kind,
    column: i.column ?? null,
    ...(i.value != null ? { value: i.value } : {}),
    label: i.label,
    count: i.count,
    outcome: i.fixed ? 'fixed' : ignored.includes(i.key) ? 'ignored' : 'open',
  }));
  const of = (outcome: IssueOutcome) => issues.filter((i) => i.outcome === outcome).length;
  return { at: a.at, rows: a.rows, found: issues.length, fixed: of('fixed'), ignored: of('ignored'), open: of('open'), issues };
}

/** The sources the given nodes read from, once each, in project order, with the Source node that reads each. */
export function reportSources(project: Project, nodeIds: string[]): { source: Source; nodeId: string }[] {
  const upstream = new Set(nodeIds.flatMap((id) => [...upstreamIds(project, id)]));
  const seen = new Map<string, string>();
  for (const n of project.nodes) if (n.type === 'source' && upstream.has(n.id) && !seen.has(n.sourceId)) seen.set(n.sourceId, n.id);
  return project.sources.filter((s) => seen.has(s.id)).map((source) => ({ source, nodeId: seen.get(source.id)! }));
}

/** The latest export that went past this rule, from the export log (newest first). */
export function lastOverride(project: Project, node: GraphNode, rule: Rule): ReportOverride | undefined {
  for (const e of project.exportLog) {
    if (e.cancelled) continue;
    // Entries logged before the ids were kept are matched by the names they recorded.
    const hit = e.overridden?.some((o) => (o.ruleId ? o.ruleId === rule.id && o.nodeId === node.id : o.nodeName === node.name && o.rule === rule.label));
    if (hit) return { at: e.at, outputName: e.nodeName, fileName: e.fileName };
  }
  return undefined;
}

/** DuckDB quotes the value it couldn't read ("Could not convert string 'abc'"); without samples the report keeps no values. */
export const redactValues = (message: string) => message.replace(/'(?:[^']|'')*'/g, '‘…’');

/** The rule's name as the rules panel shows it: a rule reading another node names it as it is called now. */
/** A rule's label as it reads now; one derived from the schema says which table it came from. */
function labelOf(project: Project, rule: Rule): string {
  const label = ruleRefs(rule).length ? ruleLabel(rule, (id) => nodeById(project, id)?.name) : rule.label;
  return rule.fromSchema ? `Schema ${qualified(rule.fromSchema.schema, rule.fromSchema.table)}: ${label}` : label;
}

function statusOf(rule: Rule, result: RuleResult | undefined, override: ReportOverride | undefined): ReportStatus {
  if (!rule.enabled) return 'off';
  if (!result || result.state === 'pending') return 'pending';
  if (result.state === 'error') return rule.severity === 'fail' && override ? 'overridden' : 'error';
  if (!result.failures) return 'pass';
  if (rule.severity === 'warn') return 'warn';
  return override ? 'overridden' : 'fail';
}

export interface ReportInput {
  project: Project;
  nodeIds: string[];
  scope: ReportScope;
  /** The rules panel's results, by node and rule. */
  results: Record<string, { results: Record<string, RuleResult> } | undefined>;
  sample: Sample | null;
  sources: ReportSource[];
  /** Failing rows by node and rule; only read when `sampleLimit` is above 0. */
  samples?: Record<string, Record<string, ReportSample>>;
  sampleLimit: number;
  generatedAt: string;
  /** Nodes that can't run (an error, or not wired up), so their rules are never checked. */
  cantRun?: string[];
}

/** Put a report together from results already computed. Pure. */
export function buildReport({ project, nodeIds, scope, results, sample, sources, samples = {}, sampleLimit, generatedAt, cantRun = [] }: ReportInput): QualityReport {
  const withSamples = sampleLimit > 0;
  const summary: QualityReport['summary'] = { rules: 0, pass: 0, warn: 0, fail: 0, overridden: 0, error: 0, off: 0, pending: 0 };
  const nodes = nodeIds.flatMap((id): ReportNode[] => {
    const node = nodeById(project, id);
    if (!node) return [];
    const rules = node.rules.map((rule): ReportRule => {
      const result: RuleResult | undefined = cantRun.includes(id) ? { state: 'error', message: `${node.name} can’t run, so this rule wasn’t checked.` } : results[id]?.results[rule.id];
      const scopeOf = ruleScope(rule);
      // An override only counts against a rule that fails now.
      const failing = rule.enabled && rule.severity === 'fail' && (result?.state === 'error' || (result?.state === 'ok' && result.failures > 0));
      const override = failing ? lastOverride(project, node, rule) : undefined;
      const status = statusOf(rule, result, override);
      const ok = rule.enabled && result?.state === 'ok' ? result : undefined;
      const row = scopeOf === 'row' && ok;
      const sampleOf = withSamples && row && ok.failures > 0 ? samples[id]?.[rule.id] : undefined;
      summary.rules++;
      summary[status]++;
      return {
        id: rule.id,
        label: labelOf(project, rule),
        kind: rule.type,
        kindLabel: ruleForm(rule.type)?.title ?? rule.type,
        severity: rule.severity,
        enabled: rule.enabled,
        scope: scopeOf,
        columns: ruleColumns(rule),
        status,
        total: ok ? ok.total : null,
        passed: row ? ok.total - ok.failures : null,
        failed: row ? ok.failures : null,
        failedPercent: row ? (ok.total ? Math.round((ok.failures / ok.total) * 10_000) / 100 : 0) : null,
        ...(rule.enabled && result?.state === 'error' ? { error: withSamples ? result.message : redactValues(result.message) } : {}),
        ...(override ? { override } : {}),
        ...(sampleOf ? { sample: { ...sampleOf, rows: sampleOf.rows.slice(0, sampleLimit), ...(sampleOf.error ? { error: sampleOf.error } : {}) } } : {}),
      };
    });
    const analysis = reportAnalysis(node);
    return [{ id, name: node.name, type: node.type, onSample: rules.some((r) => r.enabled) && sampledUpstream(project, id, sample).length > 0, rules, ...(analysis ? { analysis } : {}) }];
  });
  return {
    schema: REPORT_SCHEMA,
    project: { id: project.id, name: project.name },
    generatedAt,
    scope,
    sampleLimit: withSamples ? sampleLimit : 0,
    sampleRows: nodes.some((n) => n.onSample) && sample ? sample.rows : null,
    summary,
    sources,
    nodes,
  };
}

/** Rule results still being worked out for the nodes a report covers: it waits for them. */
export function reportPending(project: Project, nodeIds: string[], results: ReportInput['results'], cantRun: string[] = []): boolean {
  return nodeIds.some((id) =>
    !cantRun.includes(id) &&
    nodeById(project, id)?.rules.some((r) => {
      const res = results[id]?.results[r.id];
      return r.enabled && (!res || res.state === 'pending');
    }),
  );
}
