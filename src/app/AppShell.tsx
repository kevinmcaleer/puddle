import { ReactFlowProvider } from '@xyflow/react';
import { useEffect, useRef } from 'react';
import { Canvas } from '../canvas/Canvas';
import { useFlowEvaluation } from '../flow/useFlowEvaluation';
import { Inspector } from '../inspector/Inspector';
import { nodeById, useProject, useProjectStore } from '../model';
import { ResultsTable } from '../results/ResultsTable';
import { useResultsStore } from '../results/state';
import { ACCEPT } from '../sources/detect';
import { Button, Menu, ResultsBar, StatusBadge, StatusStrip, Toolbar, type NodeKind } from '../ui';
import { addFiles, addNodeAfterSelection, addPastedText, layoutFlow, pasteFromClipboard } from './actions';
import { useEngineStore, type EngineStatus } from './engine';
import { ResultsPanel } from './ResultsPanel';
import { THEME_ICON, THEME_LABEL, useTheme } from './theme';

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

const isTyping = (t: EventTarget | null) => t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));

/** Undo and redo from the keyboard, and pasting rows onto the canvas, anywhere outside a text field. */
function useShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e.target) || !(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== 'z' && e.key.toLowerCase() !== 'y') return;
      e.preventDefault();
      const { undo, redo } = useProjectStore.getState();
      if (e.key.toLowerCase() === 'y' || e.shiftKey) redo();
      else undo();
    };
    const onPaste = (e: ClipboardEvent) => {
      if (isTyping(e.target)) return;
      const text = e.clipboardData?.getData('text/plain');
      if (!text) return;
      e.preventDefault();
      void addPastedText(text);
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('paste', onPaste);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('paste', onPaste);
    };
  }, []);
}

function ResultsTitle() {
  const project = useProject();
  const node = project.view.viewedNodeId ? nodeById(project, project.view.viewedNodeId) : undefined;
  if (!node) return <ResultsBar title="Nothing to view yet" kind="output" />;
  const step = project.view.viewedStepIndex;
  const kind: NodeKind = node.type;
  return <ResultsBar title={<span data-testid="results-title">{step == null ? node.name : `${node.name} · step ${step + 1}`}</span>} kind={kind} />;
}

function Strip() {
  const engine = useEngineStore((s) => s.status);
  const viewed = useProject().view.viewedNodeId;
  const { rows, cols, ms } = useResultsStore();
  return viewed ? <StatusStrip rows={rows} cols={cols} ms={ms} end={<EngineBadge status={engine} />} /> : <StatusStrip end={<EngineBadge status={engine} />} />;
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
  const fileInput = useRef<HTMLInputElement>(null);
  useFlowEvaluation();
  useShortcuts();

  const chooseFiles = () => fileInput.current?.click();

  return (
    <ReactFlowProvider>
      <div className="grid h-full min-w-[960px] grid-rows-[auto_minmax(0,1fr)_auto_auto] bg-surface-panel text-body text-ink">
        <Toolbar project={project.name}>
          <Menu
            label="Add source"
            button={{ variant: 'primary', icon: 'plus' }}
            items={[
              { label: 'Choose files', icon: 'source', hint: 'CSV, TSV, JSON, Parquet', onSelect: chooseFiles },
              { label: 'Paste from clipboard', icon: 'paste', onSelect: () => void pasteFromClipboard() },
            ]}
          />
          <Menu
            label="Add node"
            button={{ icon: 'transform' }}
            items={[
              { label: 'Transform', icon: 'transform', onSelect: () => addNodeAfterSelection('transform') },
              { label: 'Output', icon: 'output', onSelect: () => addNodeAfterSelection('output') },
            ]}
          />
          <Button variant="ghost" icon="layout" onClick={layoutFlow} disabled={!project.nodes.length}>Auto layout</Button>
          <Button variant="ghost" icon="export">Export all</Button>
          <Button variant="ghost" icon="undo" iconOnly aria-label="Undo" title="Undo (Ctrl+Z)" disabled={!canUndo} onClick={undo} />
          <Button variant="ghost" icon="redo" iconOnly aria-label="Redo" title="Redo (Ctrl+Shift+Z)" disabled={!canRedo} onClick={redo} />
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
        <input
          ref={fileInput}
          type="file"
          multiple
          accept={ACCEPT}
          hidden
          data-testid="file-input"
          onChange={(e) => {
            const files = Array.from(e.target.files ?? []);
            e.target.value = '';
            void addFiles(files);
          }}
        />

        <div className="grid min-h-0 grid-cols-[minmax(0,1fr)_var(--size-inspector)]">
          <main className="min-h-0" aria-label="Canvas">
            <Canvas onAddSource={chooseFiles} />
          </main>

          <aside className="min-h-0 overflow-auto border-l border-line bg-surface-panel" aria-label="Inspector" data-testid="inspector">
            <Inspector />
          </aside>
        </div>

        <ResultsPanel bar={<ResultsTitle />}>
          <ResultsTable project={project} />
        </ResultsPanel>

        <Strip />
      </div>
    </ReactFlowProvider>
  );
}
