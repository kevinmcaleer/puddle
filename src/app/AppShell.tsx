import { ReactFlowProvider } from '@xyflow/react';
import { useRef } from 'react';
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
import { exportAll, ExportBlockedBanner, ExportButton, exportViewed } from '../export';
import { QueryDesigner } from '../query/QueryDesigner';
import { compareWith, offeredNode, togglePin, viewHere } from '../results/pin';
import { ResultsTable } from '../results/ResultsTable';
import { useResultsStore } from '../results/state';
import { ACCEPT } from '../sources/detect';
import { useExcelSources } from '../sources/excel';
import { SamplesDialog } from '../samples/SamplePicker';
import { UrlDialog } from '../sources/UrlDialog';
import { openUrlDialog } from '../sources/urlDialog';
import { cardKind } from '../canvas/kind';
import { Button, Menu, ResultsBar, StatusBadge, StatusStrip, Toolbar, type NodeKind } from '../ui';
import { ActivityControl } from './ActivityControl';
import { addFiles, addNodeAfterSelection, chooseFiles as pickSourceFiles, addPastedText, groupSelection, layoutFlow, pasteFromClipboard, searchAddStep, selectNeighbour, viewSelected } from './actions';
import { useEngineStore, type EngineStatus } from './engine';
import { ResultsPanel } from './ResultsPanel';
import { ShortcutsDialog } from './ShortcutsDialog';
import { shortcutText, withShortcut, type GlobalShortcutId } from './shortcuts';
import { useShortcuts } from './useShortcuts';
import { PROVIDERS, useSync } from '../sync';
import { openSyncDialog } from '../sync/dialogs';
import { SyncConflictBanner } from '../sync/SyncDialogs';
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

/** Pinned, a node selected elsewhere can take the table's place or sit beside it. */
function PinOffer() {
  const project = useProject();
  const selected = useSession((s) => s.selectedNodeId);
  const node = offeredNode(project, selected);
  if (!node) return null;
  return (
    <div className="flex items-center gap-2 px-3 pb-2" data-testid="pin-offer">
      <span className="text-label text-ink-muted">{node.name} is selected.</span>
      <Button size="sm" variant="secondary" icon="eye" onClick={() => viewHere(node.id)}>
        View here
      </Button>
      <Button size="sm" variant="secondary" icon="compare" onClick={() => compareWith(node.id)}>
        Compare
      </Button>
    </div>
  );
}

function ResultsTitle() {
  const project = useProject();
  const node = project.view.viewedNodeId ? nodeById(project, project.view.viewedNodeId) : undefined;
  if (!node) return <ResultsBar title="Nothing to view yet" kind="output" />;
  const step = project.view.viewedStepIndex;
  const kind: NodeKind = cardKind(node.type);
  const pinned = project.view.pinned;
  const failing = project.view.failingRuleId ? node.rules.find((r) => r.id === project.view.failingRuleId) : undefined;
  const title = failing ? `${node.name} · failing ${failing.label}` : step == null ? node.name : `${node.name} · step ${step + 1}`;
  const pin = (
    <Button
      variant="ghost"
      size="sm"
      icon="pin"
      iconOnly
      aria-label={pinned ? 'Unpin results' : 'Pin results'}
      title={withShortcut(pinned ? 'Unpin results' : 'Pin results', 'pin')}
      aria-pressed={pinned}
      className={pinned ? 'text-accent-ink' : undefined}
      data-testid="pin-toggle"
      onClick={togglePin}
    />
  );
  return (
    <ResultsBar
      title={<span data-testid="results-title">{title}</span>}
      kind={kind}
      pinned={pinned}
      action={
        <>
          {pin}
          {node.type === 'output' && !failing && <ExportButton node={node} />}
        </>
      }
    >
      <PinOffer />
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

/** The strip's sync badge: nothing for a project that doesn't sync. */
function useSyncBadge() {
  const status = useSync((s) => s.status);
  const provider = useSync((s) => s.provider);
  const error = useSync((s) => s.error);
  if (status === 'off' || !provider) return {};
  const label = PROVIDERS[provider].label;
  const title = {
    synced: `Saved to ${label}`,
    pending: `Changes are on their way to ${label}`,
    offline: `Offline: changes sync to ${label} when you’re back online`,
    conflict: `The ${label} copy changed too: choose which version to keep`,
    error: error ?? `Couldn’t sync to ${label}`,
  }[status];
  return { sync: status, syncTitle: title };
}

function Strip() {
  const engine = useEngineStore((s) => s.status);
  const syncBadge = useSyncBadge();
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
  if (!node) return <StatusStrip kept={kept} end={end} {...syncBadge} />;
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
  return <StatusStrip rows={rows} cols={cols} ms={ms} rules={rules} kept={kept} sample={sampled && sample ? sample.rows : undefined} detail={(rules && sampled) || (one && p) ? detail : undefined} end={end} {...syncBadge} />;
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
  const inspectorOpen = useSession((s) => s.inspectorOpen);
  const designerId = useSession((s) => s.designerNodeId);
  const designing = designerId ? nodeById(project, designerId) : undefined;
  const fileInput = useRef<HTMLInputElement>(null);
  const canvas = useRef<HTMLElement>(null);
  useExcelSources();
  useFlowEvaluation();

  const importInput = useRef<HTMLInputElement>(null);
  const chooseFiles = () => void pickSourceFiles(() => fileInput.current?.click());

  const session = useSession.getState;
  const actions: Record<GlobalShortcutId, () => void> = {
    help: () => session().setShortcutsOpen(true),
    undo,
    redo,
    'toggle-inspector': () => session().setInspectorOpen(!session().inspectorOpen),
    'add-source': chooseFiles,
    'add-transform': () => addNodeAfterSelection('transform'),
    'add-output': () => addNodeAfterSelection('output'),
    layout: () => project.nodes.length > 0 && layoutFlow(),
    group: groupSelection,
    'focus-canvas': () => canvas.current?.focus(),
    'select-upstream': () => selectNeighbour('upstream'),
    'select-downstream': () => selectNeighbour('downstream'),
    'select-above': () => selectNeighbour('above'),
    'select-below': () => selectNeighbour('below'),
    view: viewSelected,
    export: () => void exportViewed(),
    'export-all': () => void exportAll(),
    'toggle-results': () => session().setResultsOpen(!session().resultsOpen),
    pin: togglePin,
    'add-step': searchAddStep,
  };
  useShortcuts(actions, (text) => void addPastedText(text));

  return (
    <ReactFlowProvider>
      <div className="grid h-full min-w-[960px] grid-rows-[auto_auto_minmax(0,1fr)_auto_auto] bg-surface-panel text-body text-ink">
        <Toolbar
          project={project.name}
          projectMenu={[
            { label: 'Rename', icon: 'text', onSelect: () => openProjectDialog({ kind: 'rename', id: project.id, name: project.name }) },
            { label: 'Export project', icon: 'export', hint: '.puddle.json', onSelect: exportProject },
            { label: 'Import project', icon: 'source', onSelect: () => importInput.current?.click() },
            { label: `Sync to ${PROVIDERS.gist.label}`, icon: 'refresh', onSelect: () => openSyncDialog({ kind: 'project', provider: 'gist' }) },
            { label: 'All projects', icon: 'layout', onSelect: () => void goHome() },
          ]}
        >
          <Menu
            label="Add source"
            button={{ variant: 'primary', icon: 'plus' }}
            items={[
              { label: 'Choose files', icon: 'source', hint: 'CSV, TSV, JSON, Parquet', shortcut: shortcutText('add-source'), onSelect: chooseFiles },
              { label: 'From URL', icon: 'link', hint: 'https address', onSelect: () => openUrlDialog() },
              { label: 'Paste from clipboard', icon: 'paste', onSelect: () => void pasteFromClipboard() },
            ]}
          />
          <Menu
            label="Add node"
            button={{ icon: 'transform' }}
            items={[
              { label: 'Transform', icon: 'transform', shortcut: shortcutText('add-transform'), onSelect: () => addNodeAfterSelection('transform') },
              { label: 'Join', icon: 'join', hint: 'Two inputs', onSelect: () => addNodeAfterSelection('join') },
              { label: 'Append', icon: 'append', hint: 'Stack rows', onSelect: () => addNodeAfterSelection('append') },
              { label: 'Lookup', icon: 'join', hint: 'Bring columns across', onSelect: () => addNodeAfterSelection('lookup') },
              { label: 'Query', icon: 'query', hint: 'Design with tables', onSelect: () => addNodeAfterSelection('query') },
              { label: 'Output', icon: 'output', shortcut: shortcutText('add-output'), onSelect: () => addNodeAfterSelection('output') },
            ]}
          />
          <Button variant="ghost" icon="layout" title={withShortcut('Auto layout', 'layout')} onClick={layoutFlow} disabled={!project.nodes.length}>Auto layout</Button>
          <Button variant="ghost" icon="export" title={withShortcut('Export all', 'export-all')} disabled={!project.nodes.some((n) => n.type === 'output')} onClick={() => void exportAll()}>Export all</Button>
          <Button variant="ghost" icon="undo" iconOnly aria-label="Undo" title={withShortcut('Undo', 'undo')} disabled={!canUndo} onClick={undo} />
          <Button variant="ghost" icon="redo" iconOnly aria-label="Redo" title={withShortcut('Redo', 'redo')} disabled={!canRedo} onClick={redo} />
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
          <Button
            variant="ghost"
            icon={inspectorOpen ? 'sidebar-close' : 'sidebar-open'}
            iconOnly
            aria-label={inspectorOpen ? 'Hide inspector' : 'Show inspector'}
            title={withShortcut(inspectorOpen ? 'Hide inspector' : 'Show inspector', 'toggle-inspector')}
            aria-expanded={inspectorOpen}
            data-testid="inspector-toggle"
            onClick={() => session().setInspectorOpen(!inspectorOpen)}
          />
          <Button
            variant="ghost"
            icon="keyboard"
            iconOnly
            aria-label="Keyboard shortcuts"
            title={withShortcut('Keyboard shortcuts', 'help')}
            data-testid="shortcuts-toggle"
            onClick={() => session().setShortcutsOpen(true)}
          />
        </Toolbar>
        <div>
          <SyncConflictBanner />
        </div>
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

        <div className={inspectorOpen ? 'grid min-h-0 grid-cols-[minmax(0,1fr)_var(--size-inspector)]' : 'grid min-h-0 grid-cols-[minmax(0,1fr)]'}>
          <main ref={canvas} tabIndex={-1} className="min-h-0 focus-visible:outline-none" aria-label="Canvas">
            {designing?.type === 'query' ? <QueryDesigner node={designing} /> : <Canvas onAddSource={chooseFiles} />}
          </main>

          {!inspectorOpen ? null : notesOpen ? (
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
      <SamplesDialog />
      <ShortcutsDialog />
    </ReactFlowProvider>
  );
}
