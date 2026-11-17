import { useEffect, useState } from 'react';
import { useEngineStore } from '../app/engine';
import { describeBlock } from '../flow/gate';
import { useExportGate } from '../flow/rules';
import { useNodeStatus } from '../flow/status';
import { outputAfter, useProject, type GraphNode, type OutputNode } from '../model';
import { Banner, Button, formatDuration, Menu } from '../ui';
import { exportChoices, exportLabel } from './labels';
import { exportAs, exportFrom, exportNode, useExporting } from './run';

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

/**
 * The export button for an Output node, disabled while it can't run, is exporting or is still checking rules. With
 * `formats`, a menu beside it exports in any other format, switching the node to it.
 */
export function ExportButton({ node, size = 'sm', formats = false }: { node: OutputNode; size?: 'sm' | 'md'; formats?: boolean }) {
  const project = useProject();
  const gate = useExportGate(project, node.id);
  const status = useNodeStatus(node.id);
  const started = useExporting((s) => s.nodes[node.id]);
  const busy = started != null;
  const elapsed = useElapsed(started);
  const disabled = busy || status.state !== 'ok' || gate.state !== 'clear';
  // DuckDB-WASM can't report a COPY's progress, so a long export shows how long it has been running.
  const label = busy ? (elapsed >= 1000 ? `Exporting · ${formatDuration(elapsed)}` : 'Exporting') : gate.state === 'checking' ? 'Checking rules' : exportLabel(node);
  return (
    <>
      <Button
        size={size}
        variant="primary"
        icon="export"
        disabled={disabled}
        title={gate.state === 'blocked' ? 'A failing rule blocks this export. See why below.' : undefined}
        onClick={() => void exportNode(node.id)}
      >
        {label}
      </Button>
      {formats && !busy && (
        <Menu
          label={<span className="sr-only">Export as</span>}
          button={{ size, variant: 'secondary', icon: 'chevron-down', iconOnly: true, 'aria-label': 'Export as', title: 'Export as another file type', disabled, ...{ 'data-testid': 'export-formats' } }}
          items={exportChoices(node).map((c) => ({ label: c.label, hint: c.hint, checked: c.checked, onSelect: () => void exportAs(node.id, c.format) }))}
        />
      )}
      {busy && (
        <Button size={size} variant="secondary" icon="cross" data-testid="export-stop" onClick={() => useEngineStore.getState().engine?.stop()}>
          Stop
        </Button>
      )}
    </>
  );
}

/**
 * Export, on a node that isn't an Output: the rows being looked at leave through an Output node after it, which the
 * click adds when there is none (see exportFrom). The menu beside it picks the file type. So the way out of Puddle is
 * on screen wherever the data is, without knowing that Output nodes exist.
 */
export function ExportHereButton({ node, size = 'sm' }: { node: GraphNode; size?: 'sm' | 'md' }) {
  const project = useProject();
  const status = useNodeStatus(node.id);
  const output = outputAfter(project, node.id);
  const busy = useExporting((s) => (output ? s.nodes[output.id] != null : false));
  const disabled = busy || status.state !== 'ok';
  const title = output ? `Exports through ${output.name}, the Output after this node` : 'Adds an Output after this node and exports it';
  return (
    <span className="inline-flex items-center gap-1" data-testid="export-here">
      <Button size={size} variant="secondary" icon="export" disabled={disabled} title={title} onClick={() => void exportFrom(node.id)}>
        {busy ? 'Exporting' : 'Export'}
      </Button>
      <Menu
        label={<span className="sr-only">Export as</span>}
        button={{ size, variant: 'secondary', icon: 'chevron-down', iconOnly: true, 'aria-label': 'Export as', title: 'Export as another file type', disabled, ...{ 'data-testid': 'export-formats' } }}
        items={exportChoices(output).map((c) => ({ label: c.label, hint: c.hint, checked: c.checked, onSelect: () => void exportFrom(node.id, c.format) }))}
      />
    </span>
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
