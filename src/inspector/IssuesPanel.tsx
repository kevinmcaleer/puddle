// The Issues section: what analysis found wrong with the selected node's data, each with the step that fixes it.
import { useEffect, useRef } from 'react';
import { useSession } from '../app/session';
import { issueLabel, nodeIssues, useAnalysisEntry } from '../analysis';
import { foundIssues } from '../analysis/analyse';
import { fixLabel } from '../analysis/fixes';
import { FixAll } from '../analysis/FixAll';
import { useNodeStatus } from '../flow/status';
import { ignoreIssue, recordAnalysis, unignoreIssue, useProject, useProjectStore, type GraphNode } from '../model';
import { Button, IssueRow, Section, StatusBadge } from '../ui';

const apply = (edit: Parameters<ReturnType<typeof useProjectStore.getState>['apply']>[0]) => useProjectStore.getState().apply(edit);

export function IssuesPanel({ node }: { node: GraphNode }) {
  const status = useNodeStatus(node.id);
  const entry = useAnalysisEntry(node.id);
  const { open: issues, fixed } = nodeIssues(useProject(), node, entry);
  const ignored = node.ignoredIssues ?? [];
  // A click on the node's or the status strip's issues badge brings this list into view, once it shows.
  const ref = useRef<HTMLDivElement>(null);
  const reveal = useSession((s) => s.revealIssues === node.id);
  useEffect(() => {
    if (!reveal || !ref.current) return;
    ref.current.scrollIntoView({ block: 'start' });
    useSession.getState().clearRevealIssues();
  }, [reveal, status.state]);
  if (status.state !== 'ok') return null;
  const rows = entry?.state === 'ok' ? entry.analysis.facts.rows : undefined;
  const state = !entry ? 'none' : entry.state;
  return (
    <div ref={ref} data-testid="issues-section">
      <Section title="Issues" count={entry?.state === 'ok' ? issues.length : undefined} action={<FixAll node={node} />}>
        <div className="flex flex-col" data-testid="issues" data-state={state}>
          {entry?.state === 'error' && <p className="text-label text-fail">Couldn’t analyse this node: {entry.message}</p>}
          {entry?.state === 'pending' && <p className="text-label text-ink-muted">Looking at the data…</p>}
          {entry?.state === 'ok' && entry.analysis.facts.sample && (
            <p className="text-label text-ink-muted" data-testid="issues-sample">
              {`Checked on the first ${entry.analysis.facts.sample.rows.toLocaleString('en-GB')} of ${entry.analysis.facts.sample.total.toLocaleString('en-GB')} rows.`}
            </p>
          )}
          {entry?.state === 'ok' && !issues.length && (
            <p className="text-label text-ink-muted" data-testid="issues-none">
              {fixed.length ? 'Nothing left to fix.' : ignored.length ? 'Nothing else found.' : 'Nothing found. The data looks tidy.'}
            </p>
          )}
          {entry?.state === 'ok' &&
            issues.map((issue) => (
              <div key={issue.key} data-testid={`issue-${issue.key}`} data-severity={issue.severity}>
                <IssueRow
                  name={issueLabel(issue)}
                  severity={issue.severity}
                  count={issue.count}
                  total={issue.kind === 'mixedCase' ? undefined : issue.column == null ? rows : entry.analysis.facts.columns[issue.column]?.nonNull}
                  examples={issue.examples}
                  fix={fixLabel(issue)}
                  // Ignoring keeps the analysis with the node too, so the quality report can list the issue as ignored.
                  onIgnore={() => apply((p) => recordAnalysis(ignoreIssue(p, node.id, issue.key), node.id, foundIssues(entry.analysis), [], new Date().toISOString(), entry.analysis.facts.rows))}
                />
              </div>
            ))}
          {entry?.state === 'ok' && fixed.length > 0 && (
            <div className="flex flex-col gap-1 pt-2" data-testid="issues-fixed">
              <div className="flex items-center justify-between gap-2">
                <span className="text-label text-ink-muted">{fixed.length === 1 ? 'Fixed by a step after this node' : 'Fixed by the steps after this node'}</span>
                <Button size="sm" variant="ghost" onClick={() => useSession.getState().showReceipt(node.id)}>
                  What was fixed
                </Button>
              </div>
              <ul className="flex flex-col gap-1">
                {fixed.map((issue) => (
                  <li key={issue.key} className="flex items-baseline justify-between gap-2 text-label" data-testid={`fixed-${issue.key}`}>
                    <span className="flex min-w-0 items-center gap-1">
                      <StatusBadge status="pass">Fixed</StatusBadge>
                      <span className="truncate" title={issueLabel(issue)}>{issueLabel(issue)}</span>
                    </span>
                    <span className="shrink-0 text-ink-muted">{fixLabel(issue)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {ignored.length > 0 && (
            <div className="flex items-center justify-between pt-2 text-label text-ink-muted" data-testid="issues-ignored">
              <span>{ignored.length === 1 ? '1 issue ignored' : `${ignored.length} issues ignored`}</span>
              <Button size="sm" variant="ghost" onClick={() => apply((p) => ignored.reduce((q, k) => unignoreIssue(q, node.id, k), p))}>
                Show ignored
              </Button>
            </div>
          )}
        </div>
      </Section>
    </div>
  );
}
