// Issues (src/analysis) a node's owner chose to ignore: kept with the project, so they stay ignored after a reload.
import { nodeById } from './graph';
import type { Project } from './schema';

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
