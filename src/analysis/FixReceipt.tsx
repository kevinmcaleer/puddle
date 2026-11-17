// The receipt Fix all ends on, in the inspector's place: what was fixed and by which step, each line opening its
// step, with Export at the end so a tidied file can leave straight away.
import { useSession } from '../app/session';
import { ExportHereButton } from '../export/ExportControls';
import { nodeById, useProject, useProjectStore } from '../model';
import { Button, formatInstant, Section, StatusBadge } from '../ui';
import { fixReceipt, receiptTitle, type ReceiptLine } from './receipt';
import { nodeIssues, useAnalysisEntry } from './state';

/** Open what a line names: its step in its Transform, viewed up to that step, or the source for a read option. */
function openLine(line: ReceiptLine) {
  const { select, selectStep } = useSession.getState();
  select(line.nodeId);
  if (line.stepId) selectStep(line.stepId);
  useProjectStore.getState().setView({ viewedNodeId: line.nodeId, viewedStepIndex: line.stepIndex });
}

export function FixReceipt({ nodeId }: { nodeId: string }) {
  const project = useProject();
  const entry = useAnalysisEntry(nodeId);
  const receipt = fixReceipt(project, nodeId);
  const node = nodeById(project, nodeId);
  const close = () => useSession.getState().showReceipt(null);
  if (!receipt || !node) return null;
  const last = nodeById(project, receipt.lastNodeId);
  const open = nodeIssues(project, node, entry).open.length;
  const steps = receipt.lines.filter((l) => l.stepId).length;
  return (
    <div data-testid="fix-receipt">
      <div className="flex items-start justify-between gap-2 border-b border-line px-4 py-3">
        <div className="min-w-0">
          <div className="text-body-strong text-ink" data-testid="receipt-title">
            {receiptTitle(receipt)}
          </div>
          <div className="text-label text-ink-muted">
            In {receipt.nodeName}
            {steps > 0 && `, with ${steps} ${steps === 1 ? 'step' : 'steps'} after it`}. {formatInstant(receipt.at)}.
          </div>
        </div>
        <Button variant="ghost" size="sm" icon="cross" iconOnly aria-label="Close the receipt" onClick={close} />
      </div>
      <Section title="What was fixed">
        <ul className="flex flex-col gap-3" data-testid="receipt-lines">
          {receipt.lines.map((line) => (
            <li key={line.key} className="flex flex-col gap-1" data-testid="receipt-line">
              <div className="flex items-center justify-between gap-2">
                <Button variant="ghost" size="sm" title={line.stepId ? 'Open this step' : 'Open the source’s read options'} onClick={() => openLine(line)}>
                  {line.label}
                </Button>
                {line.off && <StatusBadge status="warn">Turned off</StatusBadge>}
              </div>
              <ul className="flex flex-col gap-1 px-2">
                {line.issues.map((issue) => (
                  <li key={issue.key} className="flex items-baseline justify-between gap-2 text-label">
                    <span className="truncate text-ink" title={issue.label}>
                      {issue.label}
                    </span>
                    <span className="shrink-0 text-ink-muted">{issue.touched}</span>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      </Section>
      <div className="flex flex-col gap-3 px-4 py-3">
        {open > 0 && (
          <p className="text-label text-ink-muted" data-testid="receipt-open">
            {open === 1 ? '1 issue is' : `${open} issues are`} left to look at.{' '}
            <Button variant="ghost" size="sm" onClick={() => useSession.getState().showIssues(nodeId)}>
              Show {open === 1 ? 'it' : 'them'}
            </Button>
          </p>
        )}
        <div className="flex items-center justify-between gap-2">
          {last && <ExportHereButton node={last} />}
          <Button variant="ghost" size="sm" onClick={close}>
            Done
          </Button>
        </div>
      </div>
    </div>
  );
}
