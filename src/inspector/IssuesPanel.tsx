// The Issues section: what analysis found wrong with the selected node's data, each with the step that fixes it.
import { issueLabel, useAnalysisEntry, issuesOf } from '../analysis';
import { foundIssues } from '../analysis/analyse';
import { fixLabel } from '../analysis/fixes';
import { FixAll } from '../analysis/FixAll';
import { useNodeStatus } from '../flow/status';
import { ignoreIssue, recordAnalysis, unignoreIssue, useProjectStore, type GraphNode } from '../model';
import { Button, IssueRow, Section } from '../ui';

const apply = (edit: Parameters<ReturnType<typeof useProjectStore.getState>['apply']>[0]) => useProjectStore.getState().apply(edit);

export function IssuesPanel({ node }: { node: GraphNode }) {
  const status = useNodeStatus(node.id);
  const entry = useAnalysisEntry(node.id);
  const issues = issuesOf(node, entry);
  const ignored = node.ignoredIssues ?? [];
  if (status.state !== 'ok') return null;
  const rows = entry?.state === 'ok' ? entry.analysis.facts.rows : undefined;
  const state = !entry ? 'none' : entry.state;
  return (
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
            {ignored.length ? 'Nothing else found.' : 'Nothing found. The data looks tidy.'}
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
  );
}
