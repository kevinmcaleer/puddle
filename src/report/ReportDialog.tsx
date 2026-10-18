import { useState } from 'react';
import { useSession } from '../app/session';
import { useRuleStore } from '../flow/rules';
import { useFlowStore } from '../flow/status';
import { useProject, type GraphNode } from '../model';
import { Button, Dialog, Field, Select, Switch, TextInput } from '../ui';
import { reportNodeIds, type ReportFormat, type ReportScope } from './build';
import { exportQualityReport, reportWaiting } from './run';
import { FORMAT_INFO } from './words';

export const DEFAULT_SAMPLE_ROWS = 10;
const MAX_SAMPLE_ROWS = 1000;

const FORMATS = (Object.keys(FORMAT_INFO) as ReportFormat[]).map((value) => ({
  value,
  label: { markdown: 'Markdown (for tickets and wikis)', json: 'JSON (for other tools)', html: 'HTML (one file that prints well)' }[value],
}));

/** Choose a format, which nodes and whether to include failing rows, then download the report. */
export function ReportDialog({ node, onClose }: { node: GraphNode; onClose: () => void }) {
  const project = useProject();
  const [format, setFormat] = useState<ReportFormat>('markdown');
  const [scope, setScope] = useState<ReportScope>('node');
  const [withRows, setWithRows] = useState(false);
  const [rows, setRows] = useState(String(DEFAULT_SAMPLE_ROWS));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  // Re-read on every rule result, so the dialog notices when checking finishes.
  useRuleStore((s) => s.nodes);
  useFlowStore((s) => s.nodes);
  const nodeIds = reportNodeIds(project, node.id, scope);
  const ruleCount = nodeIds.reduce((n, id) => n + (project.nodes.find((x) => x.id === id)?.rules.length ?? 0), 0);
  const waiting = reportWaiting(project, nodeIds);
  const n = Number(rows);
  const rowsProblem = withRows && (!Number.isInteger(n) || n < 0 || n > MAX_SAMPLE_ROWS) ? `Give a whole number from 0 to ${MAX_SAMPLE_ROWS}.` : undefined;

  const submit = async () => {
    if (busy || rowsProblem || !ruleCount) return;
    if (waiting) return setError('Rules are still being checked. Try again in a moment.');
    setBusy(true);
    setError(undefined);
    try {
      const fileName = await exportQualityReport(node.id, { format, scope, samples: withRows ? n : 0 });
      useSession.getState().notify({ tone: 'info', text: `Saved ${fileName}.` });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  return (
    <Dialog title="Write quality report" confirm={busy ? 'Saving…' : waiting ? 'Checking rules…' : 'Save report'} onClose={onClose} onConfirm={() => void submit()}>
      <div className="flex flex-col gap-3" data-testid="report-dialog">
        <Field label="Format" htmlFor="report-format">
          <Select id="report-format" options={FORMATS} value={format} onChange={(e) => setFormat(e.target.value as ReportFormat)} />
        </Field>
        <Field
          label="Rules from"
          htmlFor="report-scope"
          hint={ruleCount ? `${ruleCount} ${ruleCount === 1 ? 'rule' : 'rules'} on ${nodeIds.length} ${nodeIds.length === 1 ? 'node' : 'nodes'}.` : undefined}
          error={ruleCount ? undefined : 'No rules to report on here.'}
        >
          <Select
            id="report-scope"
            options={[
              { value: 'node', label: node.type === 'output' ? 'This output and the nodes before it' : 'This node' },
              { value: 'all', label: 'Every node with rules' },
            ]}
            value={scope}
            onChange={(e) => setScope(e.target.value as ReportScope)}
          />
        </Field>
        <Switch id="report-rows" label="Include sample failing rows" checked={withRows} onChange={setWithRows} />
        {withRows ? (
          <Field label="Failing rows per rule" htmlFor="report-row-count" hint="These rows contain data from your files. Set 0 for none." error={rowsProblem}>
            <TextInput id="report-row-count" type="number" inputMode="numeric" min={0} max={MAX_SAMPLE_ROWS} value={rows} error={!!rowsProblem} onChange={(e) => setRows(e.target.value)} />
          </Field>
        ) : (
          <p className="text-label text-ink-muted">Without sample rows the report holds no values from your data: only counts, rules and source details.</p>
        )}
        {error && (
          <p className="text-label text-fail" role="alert">
            {error}
          </p>
        )}
      </div>
    </Dialog>
  );
}

/** "Write quality report", opening the dialog for this node. */
export function QualityReportButton({ node }: { node: GraphNode }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size="sm" variant="secondary" icon="notes" onClick={() => setOpen(true)}>
        Write quality report
      </Button>
      {open && <ReportDialog node={node} onClose={() => setOpen(false)} />}
    </>
  );
}
