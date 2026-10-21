// Analysis per node: the facts gathered at background priority once a node's output is known, kept until that
// output changes (its upstream key), and the issues read from them. Source nodes are analysed as soon as they run,
// since that is where files arrive; other nodes when they are viewed or selected, so a long chain costs nothing until
// someone looks at it.
import { useEffect } from 'react';
import { create } from 'zustand';
import { useEngineStore } from '../app/engine';
import { useSession } from '../app/session';
import { upstreamKey } from '../compiler';
import { tableRows, toEngineError, type EngineClient } from '../engine';
import { useViewProject } from '../flow/sample';
import { useFlowStore } from '../flow/status';
import { useExcelReads } from '../sources/excel';
import { nodeById, useProject, type ColumnSchema, type GraphNode, type Project } from '../model';
import { ANALYSIS_ROWS, analyseWith, type NodeAnalysis } from './analyse';
import { findIssues } from './columns';
import { sortIssues, type Issue } from './issues';

export type { NodeAnalysis } from './analyse';
export { ANALYSIS_ROWS, sheetSourceOf, textSourceOf } from './analyse';

export type AnalysisEntry = { key: string; state: 'pending' } | { key: string; state: 'ok'; analysis: NodeAnalysis } | { key: string; state: 'error'; message: string };

export const useAnalysisStore = create<{ nodes: Record<string, AnalysisEntry> }>(() => ({ nodes: {} }));

const background = (nodeId: string, what: string) => ({ priority: 'background' as const, label: `Analysing ${what}`, supersede: `analyse:${nodeId}` });

/** The analysis (analyse.ts) on the engine, at background priority, with the Excel worker's merges for a workbook. */
export function analyseNode(engine: EngineClient, project: Project, nodeId: string, columns: ColumnSchema[], sample = ANALYSIS_ROWS): Promise<NodeAnalysis> {
  return analyseWith(
    {
      rows: async (sql, what) => tableRows((await engine.query(sql, background(nodeId, what))).table),
      sheetMerges: (source) => {
        const read = useExcelReads.getState().reads[source.id];
        return read?.state === 'ok' ? { merges: read.merges, filled: source.parseOptions.fillMerges !== false } : undefined;
      },
    },
    project,
    nodeId,
    columns,
    sample,
  );
}

/** What an analysis stands for: the node's output, and the column-name style the issues are judged by. */
const analysisKey = (project: Project, nodeId: string) => `${upstreamKey(project, { nodeId })}|${project.settings.columnNames}`;

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
    const key = analysisKey(project, node.id);
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

/** How long the project is left alone before a node is analysed, so a run of edits to it costs one analysis, not one per edit. */
export const ANALYSIS_SETTLE_MS = 800;

/**
 * Keep the analysis in step with the flow: whenever a node's output settles, or the viewed or selected node changes.
 * The analysis of a node being edited is a chain of queries over its whole output, so it waits until the edits
 * have stopped for a moment rather than starting again on each one.
 */
export function useAnalysisEvaluation() {
  const view = useViewProject();
  const engine = useEngineStore((s) => s.engine);
  const statuses = useFlowStore((s) => s.nodes);
  const viewed = useProject().view.viewedNodeId;
  const selected = useSession((s) => s.selectedNodeId);
  useEffect(() => {
    if (!engine) return;
    const timer = setTimeout(() => void evaluateAnalysis(engine, view, nodesToAnalyse(view, viewed, selected)), ANALYSIS_SETTLE_MS);
    return () => clearTimeout(timer);
  }, [engine, view, statuses, viewed, selected]);
}

const NONE: Issue[] = [];

/** The entry for a node as it stands, or undefined when its output has changed since. */
export function useAnalysisEntry(nodeId: string): AnalysisEntry | undefined {
  const view = useViewProject();
  const entry = useAnalysisStore((s) => s.nodes[nodeId]);
  if (!entry || !nodeById(view, nodeId)) return undefined;
  return entry.key === analysisKey(view, nodeId) ? entry : undefined;
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
