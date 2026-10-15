// The quality gate: an Output node is blocked while a fail-severity rule on it or upstream of it fails.
import { nodeById, topoSort, upstreamIds, type Project } from '../model';
import { useRuleStore, type RuleResult } from './rules';

export interface BlockingRule {
  nodeId: string;
  nodeName: string;
  ruleId: string;
  label: string;
  /** Failing rows, or undefined when the rule can't run. */
  failures?: number;
  error?: string;
}

export type Gate = { state: 'clear' } | { state: 'checking' } | { state: 'blocked'; blocking: BlockingRule[] };

/** What stands between a node's output and an export, from the latest rule results. Blocking rules win over checking. */
export function exportGate(project: Project, nodeId: string, results: Record<string, { results: Record<string, RuleResult> } | undefined>): Gate {
  const blocking: BlockingRule[] = [];
  let checking = false;
  // Upstream first, so the rule nearest the source is named first.
  for (const id of topoSort(project, upstreamIds(project, nodeId))) {
    const node = nodeById(project, id);
    if (!node) continue;
    for (const rule of node.rules) {
      if (!rule.enabled || rule.severity !== 'fail') continue;
      const r = results[id]?.results[rule.id];
      if (!r || r.state === 'pending') checking = true;
      else if (r.state === 'error') blocking.push({ nodeId: id, nodeName: node.name, ruleId: rule.id, label: rule.label, error: r.message });
      else if (r.failures > 0) blocking.push({ nodeId: id, nodeName: node.name, ruleId: rule.id, label: rule.label, failures: r.failures });
    }
  }
  if (blocking.length) return { state: 'blocked', blocking };
  return checking ? { state: 'checking' } : { state: 'clear' };
}

export const useExportGate = (project: Project, nodeId: string): Gate => exportGate(project, nodeId, useRuleStore((s) => s.nodes));

/** One line saying why an export is blocked, e.g. "id is unique fails on 2 rows in Clean." */
export function describeBlock(b: BlockingRule): string {
  if (b.error) return `${b.label} in ${b.nodeName} can’t run: ${b.error}`;
  return `${b.label} fails on ${b.failures} ${b.failures === 1 ? 'row' : 'rows'} in ${b.nodeName}.`;
}
