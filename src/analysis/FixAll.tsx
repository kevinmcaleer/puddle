// Fix all: the split button on the Issues panel and over the results table. One click applies every fix-level issue's
// fix (and the suggestions too, when the project setting says so); the arrow opens the list to choose from.
import { useState } from 'react';
import { useProject, type GraphNode } from '../model';
import { SplitButton, type CheckItem } from '../ui';
import { applyFixes } from './apply';
import { fixName } from './fixName';
import { defaultTicked, fixGroup } from './fixes';
import { issueLabel, type Issue } from './issues';
import { useAnalysisEntry, issuesOf } from './state';

export function FixAll({ node, align = 'end' }: { node: GraphNode; align?: 'start' | 'end' }) {
  const entry = useAnalysisEntry(node.id);
  const suggestions = useProject().settings.fixAllSuggestions;
  const fixable = issuesOf(node, entry).filter((i) => i.fix);
  // The user's ticks, kept while the same issues are listed; a new set of issues starts from the defaults again.
  const [ticks, setTicks] = useState<{ of: string; keys: string[] } | null>(null);
  const [busy, setBusy] = useState(false);
  if (entry?.state !== 'ok' || !fixable.length) return null;
  const of = fixable.map((i) => i.key).join('\n');
  const ticked = ticks?.of === of ? ticks.keys : defaultTicked(fixable, suggestions);
  const chosen = fixable.filter((i) => ticked.includes(i.key));
  const items: CheckItem[] = fixable.map((i) => ({ id: i.key, label: issueLabel(i), group: fixGroup(i), hint: fixName(i.fix?.type), checked: ticked.includes(i.key) }));
  const run = (issues: Issue[]) => {
    if (!issues.length || busy) return;
    setBusy(true);
    void applyFixes(node, issues, entry.analysis.columns).finally(() => setBusy(false));
  };
  const n = chosen.length;
  return (
    <SplitButton
      testId="fix-all"
      label={busy ? 'Fixing…' : n ? `Fix ${n} ${n === 1 ? 'issue' : 'issues'}` : 'Fix all'}
      onClick={() => run(chosen)}
      disabled={busy || !n}
      items={items}
      onToggle={(id, on) => setTicks({ of, keys: on ? [...ticked, id] : ticked.filter((k) => k !== id) })}
      applyLabel={n ? `Apply ${n} ${n === 1 ? 'fix' : 'fixes'}` : 'Apply'}
      onApply={() => run(chosen)}
      menuLabel="Choose fixes"
      align={align}
    />
  );
}
