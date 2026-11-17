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
export type FoundIssue = Omit<RecordedIssue, 'fixed' | 'fixedBy'>;

/**
 * Keep what analysis found in a node's output, for the quality report: every issue, with the ones Fix all is fixing
 * now marked. An issue fixed by an earlier Fix all stays fixed, since the fix sits after the node and the issue is
 * still in its output.
 */
export function recordAnalysis(project: Project, nodeId: string, found: FoundIssue[], fixedKeys: string[], at: string, rows: number, fixedBy: Record<string, string[]> = {}): Project {
  const previous = nodeById(project, nodeId)?.analysis;
  const wasFixed = new Map(previous?.issues.filter((i) => i.fixed).map((i) => [i.key, i.fixedBy]));
  const analysis: AnalysisRecord = {
    at,
    rows,
    issues: found.map((i) => {
      const fixed = fixedKeys.includes(i.key) || wasFixed.has(i.key);
      // The steps fixing it now, or the ones that fixed it before.
      const by = fixedKeys.includes(i.key) ? fixedBy[i.key] : wasFixed.get(i.key);
      return { ...i, ...(fixed ? { fixed: true } : {}), ...(fixed && by?.length ? { fixedBy: by } : {}) };
    }),
  };
  return { ...project, nodes: project.nodes.map((n) => (n.id === nodeId ? { ...n, analysis } : n)) };
}

/**
 * The issues of a node that steps after it are fixing, by issue key: those Fix all fixed whose steps are all still in
 * the project and turned on. Deleting or turning off a fix's step makes its issue open again. An issue fixed by a
 * read option isn't listed: the source then reads without it, so analysis no longer finds it.
 */
export function fixedIssueKeys(project: Project, nodeId: string): Set<string> {
  const recorded = nodeById(project, nodeId)?.analysis?.issues.filter((i) => i.fixed && i.fixedBy?.length);
  if (!recorded?.length) return NONE;
  const on = new Set(project.nodes.flatMap((n) => (n.type === 'transform' ? n.steps.filter((s) => s.enabled).map((s) => s.id) : [])));
  return new Set(recorded.filter((i) => i.fixedBy!.every((id) => on.has(id))).map((i) => i.key));
}

const NONE: Set<string> = new Set();
