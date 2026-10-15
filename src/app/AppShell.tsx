import { useProject, useProjectStore } from '../model';
import { Banner, Button, Icon, ResultsBar, Section, StatusBadge, StatusStrip, Toolbar } from '../ui';
import { ResultsPanel } from './ResultsPanel';
import { THEME_ICON, THEME_LABEL, useTheme } from './theme';
import { useEngineStatus, type EngineStatus } from './useEngineInfo';

function EngineBadge({ status }: { status: EngineStatus }) {
  if (status.state === 'loading') return <StatusBadge status="pending">Starting DuckDB</StatusBadge>;
  if (status.state === 'failed') return <StatusBadge status="fail" title={status.message}>DuckDB didn't start</StatusBadge>;
  const { bundle, version } = status.info;
  return (
    <span data-testid="engine-ready" data-bundle={bundle} title={`DuckDB ${version}, ${bundle} bundle`}>
      DuckDB {version} · {bundle}
    </span>
  );
}

/**
 * The fixed layout every feature lives in: toolbar on top, canvas in the centre, inspector docked right,
 * results docked below the canvas, status strip underneath.
 */
export function AppShell() {
  const project = useProject();
  const { undo, redo } = useProjectStore();
  const canUndo = useProjectStore((s) => s.history.past.length > 0);
  const canRedo = useProjectStore((s) => s.history.future.length > 0);
  const theme = useTheme();
  const engine = useEngineStatus();

  return (
    <div className="grid h-full min-w-[960px] grid-rows-[auto_minmax(0,1fr)_auto_auto] bg-surface-panel text-body text-ink">
      <Toolbar project={project.name}>
        <Button variant="primary" icon="plus">Add source</Button>
        <Button icon="transform">
          Add node
          <Icon name="chevron-down" size={14} />
        </Button>
        <Button variant="ghost" icon="layout">Auto layout</Button>
        <Button variant="ghost" icon="export">Export all</Button>
        <Button variant="ghost" icon="undo" iconOnly aria-label="Undo" disabled={!canUndo} onClick={undo} />
        <Button variant="ghost" icon="redo" iconOnly aria-label="Redo" disabled={!canRedo} onClick={redo} />
        <Button variant="ghost" icon="notes" iconOnly aria-label="Notes" />
        <Button
          variant="ghost"
          icon={THEME_ICON[theme.preference]}
          iconOnly
          aria-label={THEME_LABEL[theme.preference]}
          title={THEME_LABEL[theme.preference]}
          data-testid="theme-toggle"
          onClick={theme.cycle}
        />
      </Toolbar>

      <div className="grid min-h-0 grid-cols-[minmax(0,1fr)_var(--size-inspector)]">
        <main className="ui-canvas grid place-items-center" aria-label="Canvas" data-testid="canvas">
          <div className="flex max-w-[420px] flex-col items-center gap-3 text-center">
            <h1 className="font-display text-title text-ink">Start with a source</h1>
            <p className="text-ink-muted">Add a CSV, TSV, JSON or Parquet file, or paste from the clipboard. Nothing leaves your browser. Projects save the steps, not the data.</p>
            <Button variant="primary" icon="plus">Add source</Button>
          </div>
        </main>

        <aside className="min-h-0 overflow-auto border-l border-line bg-surface-panel" aria-label="Inspector" data-testid="inspector">
          <Section title="Inspector">
            <p className="text-ink-muted">Select a node on the canvas to see its steps, settings and rules.</p>
          </Section>
        </aside>
      </div>

      <ResultsPanel bar={<ResultsBar title="Nothing to view yet" kind="output" />}>
        <div className="p-4">
          <Banner tone="info" title="No data yet">Click a node to show its data here.</Banner>
        </div>
      </ResultsPanel>

      <StatusStrip end={<EngineBadge status={engine} />} />
    </div>
  );
}
