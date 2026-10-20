// The facts behind suggested rules for a node, gathered at background priority and kept until its output changes.
import { useEffect } from 'react';
import { create } from 'zustand';
import { useEngineStore } from '../app/engine';
import { compileCount, compileProfile, compileSuggestionChecks, compileTypeSniff, upstreamKey } from '../compiler';
import { tableRows, toEngineError, type EngineClient } from '../engine';
import { useNodeStatus } from '../flow/status';
import { useProject, type ColumnSchema, type GraphNode, type Project } from '../model';
import { parseProfile, parseTypeSniff, type ColumnProfile } from '../results/profile';
import { columnKind } from '../ui/columnKind';
import { parseSuggestionChecks, suggestionChecks, suggestRules, type CheckResult, type Suggestion } from './suggest';

export interface SuggestionFacts {
  profile: Record<string, ColumnProfile>;
  checked: { rows: number; columns: Record<string, CheckResult> };
}

type Entry = { key: string; state: 'pending' } | { key: string; state: 'ok'; columns: ColumnSchema[]; facts: SuggestionFacts } | { key: string; state: 'error' };

export const useSuggestionStore = create<{ nodes: Record<string, Entry> }>(() => ({ nodes: {} }));

const background = (nodeId: string) => ({ priority: 'background' as const, supersede: `suggest:${nodeId}` });

/**
 * Profile a node's output (as the results table does), then confirm with exact counts what the profile hints at:
 * no blanks, no edge spaces, one value per row, a short list of values.
 */
export async function gatherSuggestionFacts(engine: EngineClient, project: Project, nodeId: string, columns: ColumnSchema[]): Promise<SuggestionFacts> {
  const target = { nodeId };
  const opts = background(nodeId);
  const rows = Number(tableRows((await engine.query(compileCount(project, target), opts)).table)[0]?.n ?? 0);
  const profile = parseProfile(tableRows((await engine.query(compileProfile(project, target), opts)).table));
  const text = columns.filter((c) => columnKind(c.type) === 'text').map((c) => c.name);
  if (text.length) {
    const looks = parseTypeSniff(tableRows((await engine.query(compileTypeSniff(project, target, text), opts)).table)[0] ?? {}, text);
    for (const [c, l] of Object.entries(looks)) if (profile[c]) profile[c] = { ...profile[c], ...l };
  }
  const checks = suggestionChecks(columns, profile, rows);
  if (!checks.length) return { profile, checked: { rows, columns: {} } };
  const row = tableRows((await engine.query(compileSuggestionChecks(project, target, checks), opts)).table)[0] ?? {};
  return { profile, checked: parseSuggestionChecks(row, checks) };
}

const EMPTY: Suggestion[] = [];

/**
 * Suggested rules for a node, once its output is known. Facts are gathered once per output (its upstream key);
 * adding or dismissing a suggestion only filters them, with no new query.
 */
export function useSuggestions(node: GraphNode): Suggestion[] {
  const project = useProject();
  const status = useNodeStatus(node.id);
  const engine = useEngineStore((s) => s.engine);
  const columns = status.state === 'ok' ? status.columns : undefined;
  const key = columns ? upstreamKey(project, { nodeId: node.id }) : undefined;
  const entry = useSuggestionStore((s) => s.nodes[node.id]);

  useEffect(() => {
    if (!engine || !columns || !key) return;
    if (useSuggestionStore.getState().nodes[node.id]?.key === key) return;
    const set = (e: Entry) => useSuggestionStore.setState((s) => (s.nodes[node.id]?.key === key ? { nodes: { ...s.nodes, [node.id]: e } } : s));
    useSuggestionStore.setState((s) => ({ nodes: { ...s.nodes, [node.id]: { key, state: 'pending' } } }));
    gatherSuggestionFacts(engine, project, node.id, columns).then(
      (facts) => set({ key, state: 'ok', columns, facts }),
      (e: unknown) => {
        // Superseded by a newer request for this node: that one fills the entry in.
        if (toEngineError(e).code !== 'cancelled') return set({ key, state: 'error' });
        useSuggestionStore.setState((s) => {
          if (s.nodes[node.id]?.key !== key) return s;
          const nodes = { ...s.nodes };
          delete nodes[node.id];
          return { nodes };
        });
      },
    );
    // project changes with every edit; the key says when the output itself changed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine, key, node.id]);

  if (!entry || entry.key !== key || entry.state !== 'ok') return EMPTY;
  return suggestRules(entry.columns, entry.facts.profile, entry.facts.checked, node.rules, node.dismissedSuggestions);
}
