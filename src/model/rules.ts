// Pure edits to a node's quality rules.
import type { Project, Rule } from './schema';

function withRules(project: Project, nodeId: string, edit: (rules: Rule[]) => Rule[]): Project {
  return { ...project, nodes: project.nodes.map((n) => (n.id === nodeId ? { ...n, rules: edit(n.rules) } : n)) };
}

export const addRule = (project: Project, nodeId: string, rule: Rule): Project => withRules(project, nodeId, (rules) => [...rules, rule]);

export const updateRule = (project: Project, nodeId: string, ruleId: string, patch: Partial<Omit<Rule, 'id'>>): Project =>
  withRules(project, nodeId, (rules) => rules.map((r) => (r.id === ruleId ? { ...r, ...patch } : r)));

/** Remove a rule; the results table stops filtering on it if it was. */
export function removeRule(project: Project, nodeId: string, ruleId: string): Project {
  const next = withRules(project, nodeId, (rules) => rules.filter((r) => r.id !== ruleId));
  return next.view.failingRuleId === ruleId ? { ...next, view: { ...next.view, failingRuleId: undefined } } : next;
}

/** Stop suggesting a rule for a node. Kept with the project, so it stays dismissed after a reload. */
export function dismissSuggestion(project: Project, nodeId: string, key: string): Project {
  return {
    ...project,
    nodes: project.nodes.map((n) => (n.id === nodeId && !n.dismissedSuggestions?.includes(key) ? { ...n, dismissedSuggestions: [...(n.dismissedSuggestions ?? []), key] } : n)),
  };
}
