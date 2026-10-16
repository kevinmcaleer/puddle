import { ReactFlowProvider } from '@xyflow/react';
import { useEffect, useRef } from 'react';
import { Canvas } from '../canvas/Canvas';
import { useFlowEvaluation } from '../flow/useFlowEvaluation';
import { Inspector } from '../inspector/Inspector';
import { NotesPanel } from '../notes/NotesPanel';
import { nodeById, useProject, useProjectStore } from '../model';
import { openProjectDialog } from '../home/dialogs';
import { exportProject, goHome, importProject } from '../persistence/workspace';
import { QuickFixes } from '../quickfix/QuickFixes';
import { showFailing } from '../rules';
import { useKeptTotal } from '../flow/kept';
import { ruleTally, useRuleStore } from '../flow/rules';
import { sampledUpstream, useSample, useViewProject } from '../flow/sample';
import { SampleBanner } from '../results/SampleBanner';
import { describeProfile } from '../results/profile';
import { exportAll, ExportBlockedBanner, ExportButton } from '../export';
import { ResultsTable } from '../results/ResultsTable';
import { useResultsStore } from '../results/state';
import { ACCEPT } from '../sources/detect';
import { UrlDialog } from '../sources/UrlDialog';
import { openUrlDialog } from '../sources/urlDialog';
import { Button, Menu, ResultsBar, StatusBadge, StatusStrip, Toolbar, type NodeKind } from '../ui';
import { ActivityControl } from './ActivityControl';
import { addFiles, addNodeAfterSelection, chooseFiles as pickSourceFiles, addPastedText, layoutFlow, pasteFromClipboard } from './actions';
import { useEngineStore, type EngineStatus } from './engine';
import { ResultsPanel } from './ResultsPanel';
import { useSession } from './session';
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
  const failing = project.view.failingRuleId ? node.rules.find((r) => r.id === project.view.failingRuleId) : undefined;
  const title = failing ? `${node.name} · failing ${failing.label}` : step == null ? node.name : `${node.name} · step ${step + 1}`;
  return (
    <ResultsBar title={<span data-testid="results-title">{title}</span>} kind={kind} action={node.type === 'output' && !failing ? <ExportButton node={node} /> : undefined}>
      <SampleBanner />
      {node.type === 'output' && !failing && <ExportBlockedBanner node={node} className="px-3 pb-2" />}
      {failing ? (
        <div className="px-3 pb-2">
          <Button size="sm" variant="secondary" onClick={() => showFailing(node.id, undefined)}>
            Show all rows
          </Button>
        </div>
      ) : (
        <QuickFixes />
      )}
    </ResultsBar>
  );
}

function Strip() {
  const engine = useEngineStore((s) => s.status);
  const project = useProject();
  const viewed = project.view.viewedNodeId;
  const { rows, cols, ms, profile } = useResultsStore();
  const selected = useSession((s) => s.selectedColumns);
  const kept = useKeptTotal();
  const node = viewed ? nodeById(project, viewed) : undefined;
  const results = useRuleStore((s) => (viewed ? s.nodes[viewed]?.results : undefined));
  const sample = useSample(project);
  const end = (
    <>
      <ActivityControl />
      <EngineBadge status={engine} />
    </>
  );
  if (!node) return <StatusStrip kept={kept} end={end} />;
  const one = selected.length === 1 ? selected[0]! : undefined;
  const p = one ? profile?.[one] : undefined;
  const sampled = sampledUpstream(project, node.id, sample).length > 0;
  const rules = ruleTally(node.rules, results);
  const detail = (
    <>
      {rules && sampled && <span data-testid="rules-on-sample">Rules checked on the sample</span>}
      {one && p && <span data-testid="column-profile">{one} · {describeProfile(p)}</span>}
    </>
  );
  return <StatusStrip rows={rows} cols={cols} ms={ms} rules={rules} kept={kept} sample={sampled && sample ? sample.rows : undefined} detail={(rules && sampled) || (one && p) ? detail : undefined} end={end} />;
}

/**
 * The fixed layout every feature lives in: toolbar on top, canvas in the centre, inspector docked right,
 * results docked below the canvas, status strip underneath.
 */
export function AppShell() {
  const project = useProject();
  const viewProject = useViewProject();
  const { undo, redo } = useProjectStore();
  const canUndo = useProjectStore((s) => s.history.past.length > 0);
  const canRedo = useProjectStore((s) => s.history.future.length > 0);
  const theme = useTheme();
  const notesOpen = useSession((s) => s.notesOpen);
  const fileInput = useRef<HTMLInputElement>(null);
  useFlowEvaluation();
  useShortcuts();

  const importInput = useRef<HTMLInputElement>(null);
  const chooseFiles = () => void pickSourceFiles(() => fileInput.current?.click());

  return (
    <ReactFlowProvider>
      <div className="grid h-full min-w-[960px] grid-rows-[auto_minmax(0,1fr)_auto_auto] bg-surface-panel text-body text-ink">
        <Toolbar
          project={project.name}
          projectMenu={[
            { label: 'Rename', icon: 'text', onSelect: () => openProjectDialog({ kind: 'rename', id: project.id, name: project.name }) },
            { label: 'Export project', icon: 'export', hint: '.puddle.json', onSelect: exportProject },
            { label: 'Import project', icon: 'source', onSelect: () => importInput.current?.click() },
            { label: 'All projects', icon: 'layout', onSelect: () => void goHome() },
          ]}
        >
          <Menu
            label="Add source"
            button={{ variant: 'primary', icon: 'plus' }}
            items={[
              { label: 'Choose files', icon: 'source', hint: 'CSV, TSV, JSON, Parquet', onSelect: chooseFiles },
              { label: 'From URL', icon: 'link', hint: 'https address', onSelect: () => openUrlDialog() },
              { label: 'Paste from clipboard', icon: 'paste', onSelect: () => void pasteFromClipboard() },
            ]}
          />
          <Menu
            label="Add node"
            button={{ icon: 'transform' }}
            items={[
              { label: 'Transform', icon: 'transform', onSelect: () => addNodeAfterSelection('transform') },
              { label: 'Join', icon: 'join', hint: 'Two inputs', onSelect: () => addNodeAfterSelection('join') },
              { label: 'Append', icon: 'append', hint: 'Stack rows', onSelect: () => addNodeAfterSelection('append') },
              { label: 'Output', icon: 'output', onSelect: () => addNodeAfterSelection('output') },
            ]}
          />
          <Button variant="ghost" icon="layout" onClick={layoutFlow} disabled={!project.nodes.length}>Auto layout</Button>
          <Button variant="ghost" icon="export" disabled={!project.nodes.some((n) => n.type === 'output')} onClick={() => void exportAll()}>Export all</Button>
          <Button variant="ghost" icon="undo" iconOnly aria-label="Undo" title="Undo (Ctrl+Z)" disabled={!canUndo} onClick={undo} />
          <Button variant="ghost" icon="redo" iconOnly aria-label="Redo" title="Redo (Ctrl+Shift+Z)" disabled={!canRedo} onClick={redo} />
          <Button
            variant="ghost"
            icon="notes"
            iconOnly
            aria-label="Notes"
            title="Project notes"
            aria-pressed={notesOpen}
            className={notesOpen ? 'bg-surface-hover text-ink' : undefined}
            data-testid="notes-toggle"
            onClick={() => useSession.getState().setNotesOpen(!notesOpen)}
          />
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
          ref={importInput}
          type="file"
          accept=".json,application/json"
          hidden
          data-testid="import-input"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (file) void importProject(file);
          }}
        />
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

          {notesOpen ? (
            <aside className="min-h-0 overflow-hidden border-l border-line bg-surface-panel" aria-label="Project notes">
              <NotesPanel />
            </aside>
          ) : (
            <aside className="min-h-0 overflow-auto border-l border-line bg-surface-panel" aria-label="Inspector" data-testid="inspector">
              <Inspector />
            </aside>
          )}
        </div>

        <ResultsPanel bar={<ResultsTitle />}>
          <ResultsTable project={viewProject} />
        </ResultsPanel>

        <Strip />
      </div>
      <UrlDialog onChooseFile={chooseFiles} />
    </ReactFlowProvider>
  );
}
