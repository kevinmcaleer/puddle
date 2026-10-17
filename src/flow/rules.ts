// Rule results per node: evaluated after the preview, at background priority, one query per node.
import { create } from 'zustand';
import { CompileError, compileRules, fullData, refKeys, ruleRefs, upstreamKey } from '../compiler';
// From the engine's own files, not its index: the index also exports the browser engine, which puddle-run never loads.
import { tableRows, type EngineClient } from '../engine/client';
import { toEngineError } from '../engine/errors';
import { hashValue, nodeById, type Project, type Rule } from '../model';
import { exportGate, type Gate } from './gate';
import { schemaCacheFor, useFlowStore, type NodeStatus } from './status';

export type { RuleResult } from './ruleResult';
import type { RuleResult } from './ruleResult';

interface Entry {
  key: string;
  results: Record<string, RuleResult>;
}

export const useRuleStore = create<{ nodes: Record<string, Entry> }>(() => ({ nodes: {} }));

const PENDING: RuleResult = { state: 'pending' };

/** The export gate for a node, from the rule results on screen. */
export const useExportGate = (project: Project, nodeId: string): Gate => exportGate(project, nodeId, useRuleStore((s) => s.nodes));
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

/** How a node's enabled rules stand, for the status strip; rules still being checked aren't counted. */
export function ruleTally(rules: Rule[], results: Record<string, RuleResult> | undefined): { pass: number; warn: number; fail: number } | undefined {
  const on = rules.filter((r) => r.enabled);
  if (!on.length) return undefined;
  const t = { pass: 0, warn: 0, fail: 0 };
  for (const r of on) {
    const res = results?.[r.id];
    if (!res || res.state === 'pending') continue;
    if (res.state === 'error') t.fail++;
    else if (!res.failures) t.pass++;
    else t[r.severity]++;
  }
  return t;
}

// A rule that reads another node is re-checked when that node changes too.
const keyFor = (project: Project, nodeId: string, rules: Rule[]) => hashValue([upstreamKey(project, { nodeId }), rules.map((r) => [r.id, r.type, r.params, refKeys(project, r)])]);

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
  const statusOf = (id: string) => useFlowStore.getState().nodes[id]?.status;
  const results = await checkRules(engine, project, nodeId, rules, { priority: 'background', label: 'Checking rules', supersede: `rules:${nodeId}`, statusOf });
  if (results) set(results);
}

const WHY: Partial<Record<NodeStatus['state'], string>> = {
  error: 'has an error',
  blocked: 'is held up by an error before it',
  unwired: 'isn’t connected yet',
  detached: 'has no file connected',
};

/** Why a rule can't read the other node it names, if it can't: an error, never a pass. */
function refProblem(project: Project, rule: Rule, statusOf?: (nodeId: string) => NodeStatus | undefined): string | undefined {
  for (const id of ruleRefs(rule)) {
    const other = nodeById(project, id);
    if (!other) return 'The node this rule reads is no longer in the project.';
    const why = statusOf && WHY[statusOf(id)?.state ?? 'pending'];
    if (why) return `${other.name} ${why}, so this rule can’t be checked.`;
  }
  return undefined;
}

const messageOf = (e: unknown) => (e instanceof CompileError ? e.message : toEngineError(e).message);

/**
 * Check rules of one node. Rules on the node's own rows go in one query; a rule that reads another node runs as
 * its own query, so a problem with that node only affects it. Resolves to undefined when superseded. Stop
 * marks every rule stopped rather than retrying them.
 */
export async function checkRules(
  engine: EngineClient,
  project: Project,
  nodeId: string,
  rules: Rule[],
  opts: { priority: 'preview' | 'background'; label: string; supersede?: string; statusOf?: (nodeId: string) => NodeStatus | undefined },
): Promise<Record<string, RuleResult> | undefined> {
  const run = async (batch: Rule[], supersede?: string) => {
    const r = tableRows((await engine.query(compileRules(project, nodeId, batch), { priority: opts.priority, label: opts.label, ...(supersede ? { supersede } : {}) })).table)[0]!;
    return batch.map((_, i): RuleResult => ({ state: 'ok', failures: Number(r[`f${i}`]), total: Number(r.total) }));
  };
  const results: Record<string, RuleResult> = {};
  const local = rules.filter((r) => !ruleRefs(r).length);
  const reading = rules.filter((r) => ruleRefs(r).length);
  const stoppedAll = (e: unknown) => Object.fromEntries(rules.map((r) => [r.id, { state: 'error', message: toEngineError(e).message } as RuleResult]));

  if (local.length) {
    try {
      const counts = await run(local, opts.supersede);
      local.forEach((r, i) => (results[r.id] = counts[i]!));
    } catch (e) {
      const code = toEngineError(e).code;
      if (code === 'cancelled') return undefined;
      if (code === 'stopped') return stoppedAll(e);
      // One bad rule fails the batch: check them one by one to say which.
      for (const rule of local) {
        try {
          results[rule.id] = (await run([rule]))[0]!;
        } catch (err) {
          if (toEngineError(err).code === 'stopped') return stoppedAll(err);
          results[rule.id] = { state: 'error', message: messageOf(err) };
        }
      }
    }
  }
  for (const rule of reading) {
    const problem = refProblem(project, rule, opts.statusOf);
    if (problem) {
      results[rule.id] = { state: 'error', message: problem };
      continue;
    }
    try {
      // The other node is read on the full data: a Join or Append in it needs its inputs described first.
      for (const id of ruleRefs(rule)) await schemaCacheFor(engine).prepare(fullData(project), { nodeId: id });
      results[rule.id] = (await run([rule]))[0]!;
    } catch (err) {
      const code = toEngineError(err).code;
      if (code === 'cancelled') return undefined;
      if (code === 'stopped') return stoppedAll(err);
      results[rule.id] = { state: 'error', message: messageOf(err) };
    }
  }
  return results;
}
