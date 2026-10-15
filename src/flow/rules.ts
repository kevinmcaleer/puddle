// Rule results per node: evaluated after the preview, at background priority, one query per node.
import { create } from 'zustand';
import { CompileError, compileRules, upstreamKey } from '../compiler';
import { tableRows, toEngineError, type EngineClient } from '../engine';
import { hashValue, type Project, type Rule } from '../model';
import { useFlowStore } from './status';

export type RuleResult = { state: 'pending' } | { state: 'ok'; failures: number; total: number } | { state: 'error'; message: string };

interface Entry {
  key: string;
  results: Record<string, RuleResult>;
}

export const useRuleStore = create<{ nodes: Record<string, Entry> }>(() => ({ nodes: {} }));

const PENDING: RuleResult = { state: 'pending' };
export const useRuleResult = (nodeId: string, ruleId: string): RuleResult => useRuleStore((s) => s.nodes[nodeId]?.results[ruleId] ?? PENDING);

/** What a node's rules come to: the worst result, as the node's badge shows it. */
export type RuleSummary = { status: 'pass' | 'warn' | 'fail' | 'pending'; label: string } | undefined;

export function summarise(rules: Rule[], results: Record<string, RuleResult> | undefined): RuleSummary {
  const on = rules.filter((r) => r.enabled);
  if (!on.length) return undefined;
  const of = (r: Rule) => results?.[r.id] ?? PENDING;
  const broken = on.filter((r) => of(r).state === 'error').length;
  const failing = (sev: 'warn' | 'fail') => on.filter((r) => r.severity === sev && (of(r) as { failures?: number }).failures).length;
  const n = (k: number, what: string) => `${k} ${what}${k === 1 ? '' : 's'}`;
  if (broken) return { status: 'fail', label: `${n(broken, 'rule')} can’t run` };
  if (failing('fail')) return { status: 'fail', label: `${n(failing('fail'), 'rule')} failing` };
  if (failing('warn')) return { status: 'warn', label: `${n(failing('warn'), 'warning')}` };
  if (on.some((r) => of(r).state === 'pending')) return { status: 'pending', label: 'Checking rules' };
  return { status: 'pass', label: on.length === 1 ? 'Rule passes' : `${on.length} rules pass` };
}

const keyFor = (project: Project, nodeId: string, rules: Rule[]) => hashValue([upstreamKey(project, { nodeId }), rules.map((r) => [r.id, r.type, r.params])]);

/** Check each node's enabled rules on its output, once its preview is ok. Unchanged nodes keep their results. */
export async function evaluateRules(engine: EngineClient, project: Project): Promise<void> {
  const statuses = useFlowStore.getState().nodes;
  const prev = useRuleStore.getState().nodes;
  const next: Record<string, Entry> = {};
  const jobs: Promise<void>[] = [];
  for (const node of project.nodes) {
    const rules = node.rules.filter((r) => r.enabled);
    if (!rules.length || statuses[node.id]?.status.state !== 'ok') continue;
    const key = keyFor(project, node.id, rules);
    if (prev[node.id]?.key === key) {
      next[node.id] = prev[node.id]!;
      continue;
    }
    next[node.id] = { key, results: Object.fromEntries(rules.map((r) => [r.id, PENDING])) };
    jobs.push(checkNode(engine, project, node.id, rules, key));
  }
  useRuleStore.setState({ nodes: next });
  await Promise.all(jobs);
}

async function checkNode(engine: EngineClient, project: Project, nodeId: string, rules: Rule[], key: string) {
  const set = (results: Record<string, RuleResult>) =>
    useRuleStore.setState((s) => (s.nodes[nodeId]?.key === key ? { nodes: { ...s.nodes, [nodeId]: { key, results } } } : s));
  const run = async (batch: Rule[]) => {
    const r = tableRows((await engine.query(compileRules(project, nodeId, batch), { priority: 'background', supersede: `rules:${nodeId}` })).table)[0]!;
    return batch.map((_, i) => ({ failures: Number(r[`f${i}`]), total: Number(r.total) }));
  };
  try {
    const counts = await run(rules);
    set(Object.fromEntries(rules.map((r, i) => [r.id, { state: 'ok', ...counts[i]! }])));
  } catch (e) {
    if (toEngineError(e).code === 'cancelled') return;
    // One bad rule fails the batch: check them one by one to say which.
    const results: Record<string, RuleResult> = {};
    for (const rule of rules) {
      try {
        const [c] = await engine
          .query(compileRules(project, nodeId, [rule]), { priority: 'background' })
          .then((r) => [tableRows(r.table)[0]!]);
        results[rule.id] = { state: 'ok', failures: Number(c!.f0), total: Number(c!.total) };
      } catch (err) {
        results[rule.id] = { state: 'error', message: err instanceof CompileError ? err.message : toEngineError(err).message };
      }
    }
    set(results);
  }
}
