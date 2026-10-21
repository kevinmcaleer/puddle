// Issues (src/analysis) a node's owner chose to ignore: kept with the project, so they stay ignored after a reload.
import { nodeById } from './graph';
import type { AnalysisRecord, Project, RecordedIssue } from './schema';

export function ignoreIssue(project: Project, nodeId: string, key: string): Project {
  return {
    ...project,
    nodes: project.nodes.map((n) => (n.id === nodeId && !n.ignoredIssues?.includes(key) ? { ...n, ignoredIssues: [...(n.ignoredIssues ?? []), key] } : n)),
  };
}

/** Show an ignored issue again. */
export function unignoreIssue(project: Project, nodeId: string, key: string): Project {
  if (!nodeById(project, nodeId)?.ignoredIssues?.includes(key)) return project;
  return {
    ...project,
    nodes: project.nodes.map((n) => {
      if (n.id !== nodeId || !n.ignoredIssues?.includes(key)) return n;
      const ignoredIssues = n.ignoredIssues.filter((k) => k !== key);
      const { ignoredIssues: _, ...rest } = n;
      return ignoredIssues.length ? { ...n, ignoredIssues } : rest;
    }),
  };
}

/** An issue as analysis found it, without the examples: nothing from the data is kept with the project. */
export type FoundIssue = Omit<RecordedIssue, 'fixed'>;

/**
 * Keep what analysis found in a node's output, for the quality report: every issue, with the ones Fix all is fixing
 * now marked. An issue fixed by an earlier Fix all stays fixed, since the fix sits after the node and the issue is
 * still in its output.
 */
export function recordAnalysis(project: Project, nodeId: string, found: FoundIssue[], fixedKeys: string[], at: string, rows: number): Project {
  const previous = nodeById(project, nodeId)?.analysis;
  const wasFixed = new Set(previous?.issues.filter((i) => i.fixed).map((i) => i.key));
  const analysis: AnalysisRecord = {
    at,
    rows,
    issues: found.map((i) => ({ ...i, ...(fixedKeys.includes(i.key) || wasFixed.has(i.key) ? { fixed: true } : {}) })),
  };
  return { ...project, nodes: project.nodes.map((n) => (n.id === nodeId ? { ...n, analysis } : n)) };
}
