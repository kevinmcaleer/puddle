// Analysis per node: the facts gathered at background priority once a node's output is known, kept until that
// output changes (its upstream key), and the issues read from them. Source nodes are analysed as soon as they run,
// since that is where files arrive; other nodes when they are viewed or selected, so a long chain costs nothing until
// someone looks at it.
import { useEffect } from 'react';
import { create } from 'zustand';
import { useEngineStore } from '../app/engine';
import { useSession } from '../app/session';
import { compileAnalysis, compileCount, compileProfile, compileShape, compileTypeSniff, upstreamKey } from '../compiler';
import { tableRows, toEngineError, type EngineClient } from '../engine';
import { useViewProject } from '../flow/sample';
import { useFlowStore } from '../flow/status';
import { nodeById, useProject, type ColumnSchema, type GraphNode, type Project } from '../model';
import { parseProfile, parseTypeSniff, type ColumnProfile } from '../results/profile';
import { columnKind } from '../ui/columnKind';
import { analysisChecks, findIssues, parseAnalysis, type AnalysisFacts } from './columns';
import { parseShape } from './shape';
import { sortIssues, type Issue } from './issues';

export interface NodeAnalysis {
  columns: ColumnSchema[];
  profile: Record<string, ColumnProfile>;
  facts: AnalysisFacts;
}

export type AnalysisEntry = { key: string; state: 'pending' } | { key: string; state: 'ok'; analysis: NodeAnalysis } | { key: string; state: 'error'; message: string };

export const useAnalysisStore = create<{ nodes: Record<string, AnalysisEntry> }>(() => ({ nodes: {} }));

const background = (nodeId: string) => ({ priority: 'background' as const, label: 'Analysing', supersede: `analyse:${nodeId}` });

/** Count, profile and sniff a node's output (as the results table does), then one query for the exact counts. */
export async function analyseNode(engine: EngineClient, project: Project, nodeId: string, columns: ColumnSchema[]): Promise<NodeAnalysis> {
  const target = { nodeId };
  const opts = background(nodeId);
  await engine.query(compileCount(project, target), opts);
  const profile = parseProfile(tableRows((await engine.query(compileProfile(project, target), opts)).table));
  const text = columns.filter((c) => columnKind(c.type) === 'text').map((c) => c.name);
  if (text.length) {
    const looks = parseTypeSniff(tableRows((await engine.query(compileTypeSniff(project, target, text), opts)).table)[0] ?? {}, text);
    for (const [c, l] of Object.entries(looks)) if (profile[c] && l) profile[c] = { ...profile[c], looksLike: l };
  }
  const checks = analysisChecks(columns, profile);
  const row = tableRows((await engine.query(compileAnalysis(project, target, checks, columns.map((c) => c.name)), opts)).table)[0] ?? {};
  const facts = parseAnalysis(row, checks);
  // A source read from delimited text: one more query for the rows around and inside the table that aren't data.
  const source = textSourceOf(project, nodeId);
  if (source && columns.length) {
    const shapeRow = tableRows((await engine.query(compileShape(project, target, columns.map((c) => c.name)), opts)).table)[0] ?? {};
    facts.shape = { facts: parseShape(shapeRow), options: source.parseOptions };
  }
  return { columns, profile, facts };
}

/** The source a node reads, when it is delimited text (CSV or TSV from a file, an address or the clipboard). */
export function textSourceOf(project: Project, nodeId: string) {
  const node = nodeById(project, nodeId);
  if (node?.type !== 'source') return undefined;
  const source = project.sources.find((s) => s.id === node.sourceId);
  return source && (source.format === 'csv' || source.format === 'tsv') && !source.url?.odata && !source.url?.table ? source : undefined;
}

/** Which nodes to analyse now: every source that runs, plus the viewed and the selected node. */
export function nodesToAnalyse(project: Project, viewedId: string | null | undefined, selectedId: string | null | undefined): string[] {
  const ids = project.nodes.filter((n) => n.type === 'source').map((n) => n.id);
  for (const id of [viewedId, selectedId]) if (id && nodeById(project, id) && !ids.includes(id)) ids.push(id);
  return ids;
}

/**
 * Analyse the nodes that need it whose output is known and not yet analysed for this output. Entries of nodes no
 * longer in the project go; an unchanged node keeps its entry.
 */
export async function evaluateAnalysis(engine: EngineClient, project: Project, ids: string[]): Promise<void> {
  const statuses = useFlowStore.getState().nodes;
  const prev = useAnalysisStore.getState().nodes;
  const next: Record<string, AnalysisEntry> = {};
  const jobs: Promise<void>[] = [];
  for (const node of project.nodes) {
    const st = statuses[node.id]?.status;
    if (st?.state !== 'ok') continue;
    const key = upstreamKey(project, { nodeId: node.id });
    if (prev[node.id]?.key === key) {
      next[node.id] = prev[node.id]!;
      continue;
    }
    if (!ids.includes(node.id)) continue;
    next[node.id] = { key, state: 'pending' };
    jobs.push(analyseOne(engine, project, node.id, st.columns, key));
  }
  useAnalysisStore.setState({ nodes: next });
  await Promise.all(jobs);
}

async function analyseOne(engine: EngineClient, project: Project, nodeId: string, columns: ColumnSchema[], key: string) {
  const set = (e: AnalysisEntry) => useAnalysisStore.setState((s) => (s.nodes[nodeId]?.key === key ? { nodes: { ...s.nodes, [nodeId]: e } } : s));
  try {
    set({ key, state: 'ok', analysis: await analyseNode(engine, project, nodeId, columns) });
  } catch (e) {
    const err = toEngineError(e);
    // Superseded by a newer request for this node: that one fills the entry in.
    if (err.code === 'cancelled') return;
    set({ key, state: 'error', message: err.message });
  }
}

/** Keep the analysis in step with the flow: whenever a node's output settles, or the viewed or selected node changes. */
export function useAnalysisEvaluation() {
  const view = useViewProject();
  const engine = useEngineStore((s) => s.engine);
  const statuses = useFlowStore((s) => s.nodes);
  const viewed = useProject().view.viewedNodeId;
  const selected = useSession((s) => s.selectedNodeId);
  useEffect(() => {
    if (!engine) return;
    void evaluateAnalysis(engine, view, nodesToAnalyse(view, viewed, selected));
  }, [engine, view, statuses, viewed, selected]);
}

const NONE: Issue[] = [];

/** The entry for a node as it stands, or undefined when its output has changed since. */
export function useAnalysisEntry(nodeId: string): AnalysisEntry | undefined {
  const view = useViewProject();
  const entry = useAnalysisStore((s) => s.nodes[nodeId]);
  if (!entry || !nodeById(view, nodeId)) return undefined;
  return entry.key === upstreamKey(view, { nodeId }) ? entry : undefined;
}

/** Issues of a node from the facts gathered for its current output; the node's ignored issues are left out. */
export function issuesOf(node: GraphNode, entry: AnalysisEntry | undefined): Issue[] {
  if (!entry || entry.state !== 'ok') return NONE;
  const { columns, profile, facts } = entry.analysis;
  return sortIssues(findIssues(columns, profile, facts, node.ignoredIssues), columns.map((c) => c.name));
}

export function useIssues(node: GraphNode): Issue[] {
  return issuesOf(node, useAnalysisEntry(node.id));
}
