// Analysis per node: the facts gathered at background priority once a node's output is known, kept until that
// output changes (its upstream key), and the issues read from them. Source nodes are analysed as soon as they run,
// since that is where files arrive; other nodes when they are viewed or selected, so a long chain costs nothing until
// someone looks at it.
import { useEffect } from 'react';
import { create } from 'zustand';
import { useEngineStore } from '../app/engine';
import { useSession } from '../app/session';
import { compileAnalysis, compileCount, compileDistinctFacts, compileProfile, compileShape, compileSkew, compileTypeSniff, compileValueCounts, upstreamKey } from '../compiler';
import { detectDateFormats } from '../dates';
import { tableRows, toEngineError, type EngineClient } from '../engine';
import { useViewProject } from '../flow/sample';
import { useFlowStore } from '../flow/status';
import { nodeById, useProject, type ColumnSchema, type GraphNode, type Project } from '../model';
import { parseProfile, parseTypeSniff, type ColumnProfile } from '../results/profile';
import { columnKind } from '../ui/columnKind';
import { analysisChecks, findIssues, parseAnalysis, parseDistinctFacts, parseValueCounts, type AnalysisFacts } from './columns';
import { parseShape } from './shape';
import { findSkew, parseSkew, skewFix } from './skew';
import { sortIssues, type Issue } from './issues';

export interface NodeAnalysis {
  columns: ColumnSchema[];
  profile: Record<string, ColumnProfile>;
  facts: AnalysisFacts;
}

export type AnalysisEntry = { key: string; state: 'pending' } | { key: string; state: 'ok'; analysis: NodeAnalysis } | { key: string; state: 'error'; message: string };

export const useAnalysisStore = create<{ nodes: Record<string, AnalysisEntry> }>(() => ({ nodes: {} }));

/** How many rows of a table are looked at: its first this many, when it has more, so a big file is analysed in seconds (three million taxi trips took minutes). */
export const ANALYSIS_ROWS = 200_000;

const background = (nodeId: string, what: string) => ({ priority: 'background' as const, label: `Analysing ${what}`, supersede: `analyse:${nodeId}` });

/**
 * Count, profile and sniff a node's output (as the results table does), then one query for the exact counts, one
 * grouped per column for what the distinct values say, one for the values of columns with few of them, and for text
 * sources one for the rows that aren't data.
 */
export async function analyseNode(engine: EngineClient, project: Project, nodeId: string, columns: ColumnSchema[], sample = ANALYSIS_ROWS): Promise<NodeAnalysis> {
  const target = { nodeId };
  const opts = (what: string) => background(nodeId, what);
  const total = Number(Object.values(tableRows((await engine.query(compileCount(project, target), opts('rows'))).table)[0] ?? {})[0] ?? 0);
  // A big table is looked at through its first rows: the whole of three million rows of trips took minutes.
  const limit = total > sample ? sample : undefined;
  const profile = parseProfile(tableRows((await engine.query(compileProfile(project, target, limit), opts('columns'))).table));
  const text = columns.filter((c) => columnKind(c.type) === 'text').map((c) => c.name);
  if (text.length) {
    const looks = parseTypeSniff(tableRows((await engine.query(compileTypeSniff(project, target, text, limit), opts('text'))).table)[0] ?? {}, text);
    for (const [c, l] of Object.entries(looks)) if (profile[c]) profile[c] = { ...profile[c], ...l };
  }
  const checks = analysisChecks(columns, profile);
  const row = tableRows((await engine.query(compileAnalysis(project, target, checks, columns.map((c) => c.name), limit), opts('values'))).table)[0] ?? {};
  const facts = parseAnalysis(row, checks);
  facts.columnNames = project.settings.columnNames;
  if (limit) facts.sample = { rows: limit, total };
  if (checks.length) parseDistinctFacts(tableRows((await engine.query(compileDistinctFacts(project, target, checks, limit), opts('distinct values'))).table), checks, facts.columns);
  const valued = checks.filter((c) => c.values).map((c) => c.column);
  if (valued.length) {
    const counts = parseValueCounts(tableRows((await engine.query(compileValueCounts(project, target, valued, limit), opts('value counts'))).table));
    for (const c of valued) {
      const vc = counts[c] ?? [];
      facts.columns[c]!.valueCounts = vc;
      facts.columns[c]!.values = vc.map((v) => v.value).sort();
    }
  }
  // Rows whose cells sit a column to the left or right of where they belong: the kinds of every row, grouped.
  if (columns.length >= 2 && facts.rows >= 4) {
    const groups = parseSkew(tableRows((await engine.query(compileSkew(project, target, columns, limit), opts('rows out of line'))).table));
    const skew = findSkew(columns.map((c) => c.name), groups);
    if (skew) {
      // Dates moved into a column come as text: from a date column as ISO, from a text column in whatever way it writes them.
      const { dateSources } = skewFix(columns, skew);
      const formats: Record<string, string[]> = {};
      for (const [column, sources] of Object.entries(dateSources)) {
        const found = new Set<string>();
        for (const name of sources) {
          const type = columns.find((c) => c.name === name)?.type.toUpperCase() ?? 'VARCHAR';
          if (type === 'DATE') found.add('%Y-%m-%d');
          else if (type.startsWith('TIMESTAMP')) found.add('%Y-%m-%d %H:%M:%S');
          else {
            const detection = await detectDateFormats(engine, project, target, name, project.settings.locale);
            for (const f of detection.formats ?? detection.ranked.slice(0, 1).map((r) => r.format)) found.add(f);
          }
        }
        formats[column] = [...found];
      }
      facts.skew = { skew, fix: skewFix(columns, skew, formats) };
    }
  }
  // A source read from delimited text: one more query for the rows around and inside the table that aren't data.
  const source = textSourceOf(project, nodeId);
  if (source && columns.length) {
    const shapeRow = tableRows((await engine.query(compileShape(project, target, columns.map((c) => c.name), limit), opts('rows that aren’t data'))).table)[0] ?? {};
    facts.shape = { facts: parseShape(shapeRow), options: source.parseOptions };
  }
  return { columns, profile, facts };
}

/** What an analysis stands for: the node's output, and the column-name style the issues are judged by. */
const analysisKey = (project: Project, nodeId: string) => `${upstreamKey(project, { nodeId })}|${project.settings.columnNames}`;

/** The source a node reads, when it is text (CSV, TSV, fixed width or a pipe table from a file, an address or the clipboard). */
export function textSourceOf(project: Project, nodeId: string) {
  const node = nodeById(project, nodeId);
  if (node?.type !== 'source') return undefined;
  const source = project.sources.find((s) => s.id === node.sourceId);
  const text = source && (source.format === 'csv' || source.format === 'tsv' || source.format === 'fixed' || source.format === 'pipes');
  return text && !source.url?.odata && !source.url?.table ? source : undefined;
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
