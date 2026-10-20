import { ReactFlowProvider } from '@xyflow/react';
import { useEffect, useRef, useState } from 'react';
import { Canvas } from '../canvas/Canvas';
import { useFlowEvaluation } from '../flow/useFlowEvaluation';
import { Inspector } from '../inspector/Inspector';
import { nodeById, useProject, useProjectStore } from '../model';
import { openProjectDialog } from '../home/dialogs';
import { exportProject, goHome, importProject } from '../persistence/workspace';
import { QuickFixes } from '../quickfix/QuickFixes';
import { showFailing } from '../rules';
import { useKeptTotal } from '../flow/kept';
import { issuesOf, useAnalysisEntry, useAnalysisEvaluation } from '../analysis';
import { FixAll } from '../analysis/FixAll';
import { ruleTally, useRuleStore } from '../flow/rules';
import { sampledUpstream, useSample, useViewProject } from '../flow/sample';
import { SampleBanner } from '../results/SampleBanner';
import { describeProfile } from '../results/profile';
import { exportAll, ExportBlockedBanner, ExportButton, exportViewed } from '../export';
import { QueryDesigner } from '../query/QueryDesigner';
import { SchemaView } from '../schema/SchemaView';
import { Relationships } from '../relationships/Relationships';
import { compareWith, offeredNode, togglePin, viewHere } from '../results/pin';
import { ResultsTable } from '../results/ResultsTable';
import { useResultsStore } from '../results/state';
import { ACCEPT } from '../sources/detect';
import { useAccessSources } from '../sources/access';
import { useConnectionSources } from '../sources/connection';
import { useExcelSources } from '../sources/excel';
import { useSchemaTableSync } from '../schemaTables/state';
import { LOAD_FAILURES, projectSchema } from '../compiler';
import { useXmlSources } from '../sources/xml';
import { SamplesDialog } from '../samples/SamplePicker';
import { openUserGuide, startTaxiTutorial } from '../samples/open';
import { Tour } from '../tour/Tour';
import { TOUR_STOPS } from '../tour/stops';
import { canResume, readProgress, startTourSafely, useTour } from '../tour/tour';
import { FormatDialog } from '../sources/FormatDialog';
import { UrlDialog } from '../sources/UrlDialog';
import { openUrlDialog } from '../sources/urlDialog';
import { WebPageDialog } from '../sources/WebPageDialog';
import { openWebPageDialog } from '../sources/webPageDialog';
import { ODataDialog } from '../sources/ODataDialog';
import { ConnectionDialog } from '../connections/ConnectionDialog';
import { openConnectionDialog } from '../connections/dialog';
import { openODataDialog } from '../sources/odataDialog';
import { cardKind } from '../canvas/kind';
import { Button, Menu, ResultsBar, StatusBadge, StatusStrip, Toolbar, useDisplayFormat, type NodeKind } from '../ui';
import { ActivityControl } from './ActivityControl';
import { addFiles, addNodeAfterSelection, addSchemaTable, addStepFromMenu, cancelWiring, chooseFiles as pickSourceFiles, addPastedText, groupSelection, layoutFlow, openSelected, pasteFromClipboard, searchAddStep, selectNeighbour, startWiring, viewSelected } from './actions';
import { useEngineStore, type EngineStatus } from './engine';
import { ResultsPanel } from './ResultsPanel';
import { Console } from '../console/Console';
import { ShortcutsDialog } from './ShortcutsDialog';
import { openTemplates } from '../templates/actions';
import { TemplateDialogs } from '../templates/TemplateDialogs';
import { openExportRecipe, openRecipeFile } from '../recipes/actions';
import { RecipeAttachBanner, RecipeDialogs } from '../recipes/RecipeDialogs';
import { shortcutText, withShortcut, type GlobalShortcutId } from './shortcuts';
import { STEP_GROUPS, stepForms } from '../steps';
import { useShortcuts } from './useShortcuts';
import { PROVIDER_IDS, PROVIDERS, useSync } from '../sync';
import { openSyncDialog } from '../sync/dialogs';
import { SyncConflictBanner } from '../sync/SyncDialogs';
import { useSession } from './session';
import { afterSelection } from './addMenu';
import { showView } from './views';
import { ViewSwitcher } from './ViewSwitcher';

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
  const consoleOpen = useSession((s) => s.consoleOpen);
  if (!node) return <ResultsBar title="Nothing to view yet" kind="output" />;
  const step = project.view.viewedStepIndex;
  const kind: NodeKind = cardKind(node.type);
  const pinned = project.view.pinned;
  const loadFailures = project.view.failingRuleId === LOAD_FAILURES ? { label: 'rows that can’t load' } : undefined;
  const failing = loadFailures ?? (project.view.failingRuleId ? node.rules.find((r) => r.id === project.view.failingRuleId) : undefined);
  const title = loadFailures ? `${node.name} · ${loadFailures.label}` : failing ? `${node.name} · failing ${failing.label}` : step == null ? node.name : `${node.name} · step ${step + 1}`;
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
          <Button
            variant="ghost"
            size="sm"
            icon="code"
            iconOnly
            aria-label={consoleOpen ? 'Hide the SQL console' : 'Show the SQL console'}
            title={consoleOpen ? 'Hide the SQL console' : 'Show the SQL console'}
            aria-pressed={consoleOpen}
            className={consoleOpen ? 'text-accent-ink' : undefined}
            data-testid="console-toggle"
            onClick={() => useSession.getState().setConsoleOpen(!consoleOpen)}
          />
          {pin}
          {node.type === 'output' && !failing && <ExportButton node={node} formats />}
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
        <div className="flex items-start gap-2">
          <QuickFixes />
          <div className="ml-auto px-3 pb-2 empty:hidden">
            <FixAll node={node} />
          </div>
        </div>
      )}
    </ResultsBar>
  );
}

/** Help: the user guide, its taxi tutorial, the guided tour (from the start, or from where it was left) and the keyboard shortcuts. */
function HelpMenu() {
  // Read when the menu opens, so it knows how far the tour got.
  const [progress, setProgress] = useState(readProgress);
  const running = useTour((s) => s.projectId != null);
  const resume = !running && canResume(progress) ? progress.stop : undefined;
  return (
    <Menu
      label={<span className="sr-only">Help</span>}
      button={{ variant: 'ghost', icon: 'help', iconOnly: true, 'aria-label': 'Help', title: 'Help', ...{ 'data-testid': 'help-menu' } }}
      onOpenChange={(open) => open && setProgress(readProgress())}
      items={[
        { label: 'User guide', icon: 'notes', onSelect: openUserGuide },
        { label: 'Start the taxi tutorial', icon: 'source', onSelect: () => void startTaxiTutorial() },
        ...(resume != null ? [{ label: 'Resume the tour', icon: 'info' as const, hint: `Stop ${resume + 1} of ${TOUR_STOPS.length}`, onSelect: () => startTourSafely(resume) }] : []),
        { label: 'Take the tour', icon: 'info', onSelect: () => startTourSafely() },
        { label: 'Keyboard shortcuts', icon: 'keyboard', shortcut: shortcutText('help'), onSelect: () => useSession.getState().setShortcutsOpen(true) },
      ]}
    />
  );
}


/** The strip's sync badge: nothing for a project that doesn't sync. */
function useSyncBadge() {
  const status = useSync((s) => s.status);
  const provider = useSync((s) => s.provider);
  const error = useSync((s) => s.error);
  const label = provider && PROVIDERS[provider]?.label;
  if (status === 'off' || !label) return {};
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
  const analysis = useAnalysisEntry(viewed ?? '');
  const sample = useSample(project);
  const display = useDisplayFormat();
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
  const issues = analysis?.state === 'ok' ? issuesOf(node, analysis).length : undefined;
  const detail = (
    <>
      {rules && sampled && <span data-testid="rules-on-sample">Rules checked on the sample</span>}
      {one && p && <span data-testid="column-profile">{one} · {describeProfile(p, display)}</span>}
    </>
  );
  return <StatusStrip rows={rows} cols={cols} ms={ms} rules={rules} issues={issues} kept={kept} sample={sampled && sample ? sample.rows : undefined} detail={(rules && sampled) || (one && p) ? detail : undefined} end={end} {...syncBadge} />;
}

/**
 * The fixed layout every feature lives in: toolbar on top, canvas in the centre, inspector docked right,
 * results docked below the canvas, status strip underneath. The toolbar keeps to seven controls: the wordmark
 * (the way back to every project), the project menu, Add, undo, redo, Help and the inspector toggle; the rest lives in menus or on the canvas.
 */
export function AppShell() {
  const project = useProject();
  const viewProject = useViewProject();
  const { undo, redo } = useProjectStore();
  const canUndo = useProjectStore((s) => s.history.past.length > 0);
  const canRedo = useProjectStore((s) => s.history.future.length > 0);
  const inspectorOpen = useSession((s) => s.inspectorOpen);
  const consoleOpen = useSession((s) => s.consoleOpen);
  const designerId = useSession((s) => s.designerNodeId);
  const selectedId = useSession((s) => s.selectedNodeId);
  const hasSelection = !!selectedId && !!nodeById(project, selectedId);
  const designing = designerId ? nodeById(project, designerId) : undefined;
  const schemaOpen = useSession((s) => s.schemaOpen);
  // The Schema view belongs to the project it was opened on.
  useEffect(() => () => useSession.getState().setSchemaOpen(false), [project.id]);
  const relationshipsOpen = useSession((s) => s.relationshipsOpen);
  // The relationships view belongs to the project it was opened on.
  useEffect(() => () => useSession.getState().setRelationshipsOpen(false), [project.id]);
  const fileInput = useRef<HTMLInputElement>(null);
  const canvas = useRef<HTMLElement>(null);
  const inspector = useRef<HTMLElement>(null);
  // The inspector may only be drawn on the next render (it was hidden, or the notes were showing).
  const focusInspector = () => requestAnimationFrame(() => inspector.current?.focus());
  const hasOutput = project.nodes.some((n) => n.type === 'output');
  const schemaTables = projectSchema(project.schema.dbml).tables;
  useExcelSources();
  useAccessSources();
  useConnectionSources();
  useXmlSources();
  useSchemaTableSync();
  useFlowEvaluation();
  useAnalysisEvaluation();

  const importInput = useRef<HTMLInputElement>(null);
  const recipeInput = useRef<HTMLInputElement>(null);
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const addMenuPending = useSession((s) => s.addMenuPending);
  const chooseFiles = () => void pickSourceFiles(() => fileInput.current?.click());

  const session = useSession.getState;
  /** A canvas key does nothing while the Schema view covers the canvas, and the key goes on to the view. */
  const onCanvas = (run: () => void | boolean) => () => (session().schemaOpen || session().relationshipsOpen ? false : run());
  const actions: Record<GlobalShortcutId, () => void | boolean> = {
    help: () => session().setShortcutsOpen(true),
    undo,
    redo,
    'toggle-inspector': () => session().setInspectorOpen(!session().inspectorOpen),
    'add-source': chooseFiles,
    'add-database': () => openConnectionDialog('add'),
    'add-transform': onCanvas(() => session().requestAddMenu()),
    'add-output': onCanvas(() => addNodeAfterSelection('output')),
    layout: onCanvas(() => project.nodes.length > 0 && layoutFlow()),
    group: onCanvas(groupSelection),
    'focus-canvas': () => canvas.current?.focus(),
    'select-upstream': onCanvas(() => selectNeighbour('upstream')),
    'select-downstream': onCanvas(() => selectNeighbour('downstream')),
    'select-above': onCanvas(() => selectNeighbour('above')),
    'select-below': onCanvas(() => selectNeighbour('below')),
    view: viewSelected,
    export: () => void exportViewed(),
    'export-all': () => void exportAll(),
    'toggle-results': () => session().setResultsOpen(!session().resultsOpen),
    pin: togglePin,
    'add-step': searchAddStep,
    'open-node': () => (session().schemaOpen || session().relationshipsOpen ? false : openSelected(focusInspector)),
    connect: onCanvas(startWiring),
    cancel: onCanvas(cancelWiring),
    'show-canvas': () => showView(project, 'canvas'),
    'show-relationships': () => showView(project, 'relationships'),
    'show-designer': () => showView(project, 'designer'),
    'show-schema': () => showView(project, 'schema'),
  };
  useShortcuts(actions, (text) => void addPastedText(text));

  return (
    <ReactFlowProvider>
      <div className="grid h-full min-w-[960px] grid-rows-[auto_auto_minmax(0,1fr)_auto_auto] bg-surface-panel text-body text-ink">
        <h1 className="sr-only">{project.name}</h1>
        <Toolbar
          onHome={() => void goHome()}
          project={project.name}
          projectMenu={[
            { label: 'Rename', icon: 'text', onSelect: () => openProjectDialog({ kind: 'rename', id: project.id, name: project.name }) },
            { label: 'Relationships', icon: 'relationships', hint: 'Tables and keys, DBML', onSelect: () => session().setRelationshipsOpen(true) },
            { label: 'Schema', icon: 'schema', hint: 'Design tables in DBML', onSelect: () => session().setSchemaOpen(true) },
            { label: 'Databases', icon: 'database', hint: 'Connections', onSelect: () => openConnectionDialog('manage') },
            { label: 'Save project file', icon: 'export', hint: '.puddle.json', onSelect: exportProject },
            { label: 'Open project file', icon: 'source', onSelect: () => importInput.current?.click() },
            { label: 'Share as recipe', icon: 'template', hint: 'Steps, no data', onSelect: () => openExportRecipe() },
            { label: 'Open recipe', icon: 'template', hint: '.puddle-recipe.json', onSelect: () => recipeInput.current?.click() },
            ...PROVIDER_IDS.map((id) => ({ label: `Sync to ${PROVIDERS[id]!.label}`, icon: 'refresh' as const, onSelect: () => openSyncDialog({ kind: 'project', provider: id }) })),
            { label: 'Export all', icon: 'export', hint: hasOutput ? 'Every Output node' : 'No Output node yet', shortcut: shortcutText('export-all'), disabled: !hasOutput, onSelect: () => void exportAll() },
            { label: 'All projects', icon: 'layout', onSelect: () => void goHome() },
          ]}
        >
          <Menu
            label="Add"
            button={{ variant: 'primary', icon: 'plus', ...{ 'data-tour': 'add-node' } }}
            search="Search steps and nodes"
            scroll
            open={addMenuOpen || addMenuPending}
            onOpenChange={(next) => {
              setAddMenuOpen(next);
              if (!next) session().clearAddMenu();
            }}
            items={[
              { label: 'Choose files', icon: 'source', hint: 'CSV, TSV, JSON, Parquet', shortcut: shortcutText('add-source'), group: 'Sources', onSelect: chooseFiles },
              { label: 'From URL', icon: 'link', hint: 'https address', group: 'Sources', onSelect: () => openUrlDialog() },
              { label: 'From web page', icon: 'web', hint: 'Its tables', group: 'Sources', onSelect: () => openWebPageDialog() },
              { label: 'From OData feed', icon: 'database', hint: 'Its entity sets', group: 'Sources', onSelect: () => openODataDialog() },
              { label: 'From database', icon: 'database', hint: 'A connection', shortcut: shortcutText('add-database'), group: 'Sources', onSelect: () => openConnectionDialog('add') },
              { label: 'Paste from clipboard', icon: 'paste', group: 'Sources', onSelect: () => void pasteFromClipboard() },
              { label: 'From template', icon: 'template', hint: 'Saved steps', group: 'Nodes', onSelect: openTemplates },
              // Every table designed in the Schema view, as a node holding its rows (the selected node, if any, loads into it).
              ...schemaTables.map((t) => ({ label: t.name, icon: 'schema' as const, hint: t.schema === 'public' ? 'Schema table' : `Schema table in ${t.schema}`, group: 'Schema tables', onSelect: () => addSchemaTable(t.schema, t.name) })),
              // Nodes and steps go after the selected node, so with nothing selected they wait (principle 2).
              ...afterSelection([
                { label: 'Join', icon: 'join', hint: 'Two inputs', group: 'Nodes', onSelect: () => addNodeAfterSelection('join') },
                { label: 'Append', icon: 'append', hint: 'Stack rows', group: 'Nodes', onSelect: () => addNodeAfterSelection('append') },
                { label: 'Lookup', icon: 'join', hint: 'Bring columns across', group: 'Nodes', onSelect: () => addNodeAfterSelection('lookup') },
                { label: 'Query', icon: 'query', hint: 'Design with tables', group: 'Nodes', onSelect: () => addNodeAfterSelection('query') },
                { label: 'SQL', icon: 'code', hint: 'Write a query', group: 'Nodes', onSelect: () => addNodeAfterSelection('sql') },
                { label: 'Output', icon: 'output', shortcut: shortcutText('add-output'), group: 'Nodes', onSelect: () => addNodeAfterSelection('output') },
                // Every step, each making a node of its own after the selected node (T opens the menu with its search focused).
                ...STEP_GROUPS.flatMap((g) => stepForms().filter((f) => f.group === g).map((f) => ({ label: f.title, group: `${g} steps`, hint: f.newColumn ? 'New column' : undefined, onSelect: () => void addStepFromMenu(f) }))),
              ], hasSelection),
            ]}
          />
          <Button variant="ghost" icon="undo" iconOnly aria-label="Undo" title={withShortcut('Undo', 'undo')} disabled={!canUndo} onClick={undo} />
          <Button variant="ghost" icon="redo" iconOnly aria-label="Redo" title={withShortcut('Redo', 'redo')} disabled={!canRedo} onClick={redo} />
          <HelpMenu />
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
        </Toolbar>
        <div>
          <SyncConflictBanner />
          <RecipeAttachBanner />
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
          ref={recipeInput}
          type="file"
          accept=".json,application/json"
          hidden
          data-testid="recipe-input"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (file) void openRecipeFile(file);
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
          <main ref={canvas} tabIndex={-1} className="grid min-h-0 grid-rows-[auto_minmax(0,1fr)] focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand" aria-label="Canvas">
            <ViewSwitcher />
            <div className="min-h-0">
              {schemaOpen ? <SchemaView /> : relationshipsOpen ? <Relationships /> : designing?.type === 'query' ? <QueryDesigner node={designing} /> : <Canvas onAddSource={chooseFiles} onLayout={layoutFlow} />}
            </div>
          </main>

          {inspectorOpen && (
            <aside ref={inspector} tabIndex={-1} className="min-h-0 overflow-hidden border-l border-line bg-surface-panel focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand" aria-label="Inspector" data-testid="inspector">
              <Inspector />
            </aside>
          )}
        </div>

        <ResultsPanel bar={<ResultsTitle />}>
          <div className="flex h-full min-h-0 flex-col">
            <div className="min-h-0 flex-1">
              <ResultsTable project={viewProject} />
            </div>
            {consoleOpen && <Console project={viewProject} />}
          </div>
        </ResultsPanel>

        <Strip />
      </div>
      <UrlDialog onChooseFile={chooseFiles} />
      <FormatDialog />
      <WebPageDialog />
      <ODataDialog />
      <ConnectionDialog />
      <SamplesDialog />
      <ShortcutsDialog />
      <TemplateDialogs />
      <RecipeDialogs />
      <Tour />
    </ReactFlowProvider>
  );
}
