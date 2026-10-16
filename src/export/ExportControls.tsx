import { useEffect, useState } from 'react';
import { useEngineStore } from '../app/engine';
import { describeBlock, useExportGate } from '../flow/gate';
import { useNodeStatus } from '../flow/status';
import { useProject, type OutputNode } from '../model';
import { Banner, Button, formatDuration } from '../ui';
import { exportLabel } from './labels';
import { exportNode, useExporting } from './run';

/** Milliseconds since `since`, ticking while it is set. */
function useElapsed(since: number | undefined): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (since == null) return;
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, [since]);
  return since == null ? 0 : Math.max(0, now - since);
}

/** The export button for an Output node, disabled while it can't run, is exporting or is still checking rules. */
export function ExportButton({ node, size = 'sm' }: { node: OutputNode; size?: 'sm' | 'md' }) {
  const project = useProject();
  const gate = useExportGate(project, node.id);
  const status = useNodeStatus(node.id);
  const started = useExporting((s) => s.nodes[node.id]);
  const busy = started != null;
  const elapsed = useElapsed(started);
  // DuckDB-WASM can't report a COPY's progress, so a long export shows how long it has been running.
  const label = busy ? (elapsed >= 1000 ? `Exporting · ${formatDuration(elapsed)}` : 'Exporting') : gate.state === 'checking' ? 'Checking rules' : exportLabel(node);
  return (
    <>
      <Button
        size={size}
        variant="primary"
        icon="export"
        disabled={busy || status.state !== 'ok' || gate.state !== 'clear'}
        title={gate.state === 'blocked' ? 'A failing rule blocks this export. See why below.' : undefined}
        onClick={() => void exportNode(node.id)}
      >
        {label}
      </Button>
      {busy && (
        <Button size={size} variant="secondary" icon="cross" data-testid="export-stop" onClick={() => useEngineStore.getState().engine?.stop()}>
          Stop
        </Button>
      )}
    </>
  );
}

/** Why an Output node's export is blocked, naming each rule, with the override. */
export function ExportBlockedBanner({ node, className }: { node: OutputNode; className?: string }) {
  const project = useProject();
  const gate = useExportGate(project, node.id);
  const busy = useExporting((s) => !!s.nodes[node.id]);
  if (gate.state !== 'blocked') return null;
  return (
    <div className={className} data-testid="export-blocked">
      <Banner
        tone="fail"
        title="Export blocked"
        action={
          <Button size="sm" variant="secondary" disabled={busy} onClick={() => void exportNode(node.id, true)}>
            Export anyway
          </Button>
        }
      >
        <ul>
          {gate.blocking.map((b) => (
            <li key={`${b.nodeId}:${b.ruleId}`}>{describeBlock(b)}</li>
          ))}
        </ul>
        Exporting anyway is noted in the export log.
      </Banner>
    </div>
  );
}
