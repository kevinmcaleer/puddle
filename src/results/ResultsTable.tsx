import { CompactSelection, DataEditor, type GridCell, type GridColumn, type GridSelection, type Item, type Rectangle } from '@glideapps/glide-data-grid';
import '@glideapps/glide-data-grid/dist/index.css';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useEngineStore } from '../app/engine';
import { useSession } from '../app/session';
import { useTheme } from '../app/theme';
import { compileDisplayPage, compileProfile, PAGE_SIZE, upstreamKey, type Target } from '../compiler';
import { isCancelled, tableRows, toEngineError, type EngineClient } from '../engine';
import { countRows, schemaCacheFor, useNodeStatus } from '../flow/status';
import type { ColumnSchema, Project } from '../model';
import { Banner, columnKind, glideTheme, type Quality } from '../ui';
import { nullTheme, resultCell } from './cells';
import { HEADER_HEIGHT, headerColors, makeDrawHeader } from './header';
import { PageLoader, type Row } from './pages';
import { detachedMessage } from '../sources/attach';
import { ReattachButton } from '../sources/ReattachButton';
import { useResultsStore } from './state';

/** Re-read token colours when the theme preference or the OS scheme changes. */
function useThemeTick() {
  const pref = useTheme((s) => s.preference);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const on = () => setTick((t) => t + 1);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return `${pref}:${tick}`;
}

/** A page loader for one result. Page 0 supersedes the previous preview and times the status strip. */
function createLoader(engine: EngineClient, project: Project, target: Target, columns: string[]): PageLoader {
  return new PageLoader(async (page) => {
    const t0 = performance.now();
    const r = await engine.query(compileDisplayPage(project, target, columns, page), page === 0 ? { supersede: 'preview' } : {});
    if (page === 0) useResultsStore.getState().set({ ms: performance.now() - t0 });
    return tableRows(r.table).map((row): Row => columns.map((c) => (row[c] == null ? null : String(row[c]))));
  }, PAGE_SIZE);
}

/** Profile each column for the header quality bars, at background priority. */
async function loadProfile(engine: EngineClient, project: Project, target: Target): Promise<Record<string, Quality>> {
  const r = await engine.query(compileProfile(project, target), { priority: 'background', supersede: 'profile' });
  const out: Record<string, Quality> = {};
  for (const row of tableRows(r.table)) {
    const empty = Number(row.null_pct ?? 0) / 100;
    out[String(row.column_name)] = { valid: 1 - empty, empty, error: 0 };
  }
  return out;
}

const EMPTY_SELECTION: GridSelection = { columns: CompactSelection.empty(), rows: CompactSelection.empty() };

/** One result's grid. The parent keys it by the result, so a new result starts from fresh state. */
function Grid({ engine, project, target, columns }: { engine: EngineClient; project: Project; target: Target; columns: ColumnSchema[] }) {
  const [loader] = useState(() => createLoader(engine, project, target, columns.map((c) => c.name)));
  const [loaded, setLoaded] = useState(0);
  const [profile, setProfile] = useState<Record<string, Quality>>({});
  const [total, setTotal] = useState<number | undefined>();
  const [selection, setSelection] = useState<GridSelection>(EMPTY_SELECTION);
  const themeTick = useThemeTick();

  const kinds = useMemo(() => columns.map((c) => columnKind(c.type)), [columns]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const theme = useMemo(() => glideTheme(), [themeTick]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const colors = useMemo(() => headerColors(), [themeTick]);
  const subtle = useMemo(() => nullTheme(theme), [theme]);

  useEffect(() => {
    let live = true;
    const off = loader.subscribe(() => setLoaded(loader.loadedRows));
    useResultsStore.getState().set({ rows: undefined, cols: columns.length, ms: undefined });
    useSession.getState().setSelectedColumns([]);
    void loader.ensure(0, PAGE_SIZE).catch(() => undefined);
    countRows(engine, project, target.nodeId, target.stepIndex).then(
      (n) => {
        if (!live) return;
        setTotal(n);
        useResultsStore.getState().set({ rows: n });
      },
      () => undefined,
    );
    loadProfile(engine, project, target).then(
      (p) => live && setProfile(p),
      () => undefined,
    );
    return () => {
      live = false;
      off();
    };
    // Runs once per mounted result; the parent remounts the grid when the result changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const gridColumns: GridColumn[] = useMemo(
    () => columns.map((c) => ({ id: c.name, title: c.name, width: Math.min(280, Math.max(120, c.name.length * 9 + 56)) })),
    [columns],
  );

  const getCellContent = useCallback(
    ([col, row]: Item): GridCell => {
      const r = loader.row(row);
      return resultCell(r ? (r[col] ?? null) : undefined, kinds[col] ?? 'text', subtle);
    },
    // `loaded` changes as pages arrive, so the grid redraws them.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [loader, kinds, subtle, loaded],
  );

  const drawHeader = useMemo(() => makeDrawHeader((i) => ({ kind: kinds[i] ?? 'text', quality: profile[columns[i]?.name ?? ''] }), colors), [kinds, profile, columns, colors]);

  const onVisible = useCallback((r: Rectangle) => void loader.ensure(r.y, r.height + 20).catch(() => undefined), [loader]);

  const onSelection = (s: GridSelection) => {
    setSelection(s);
    useSession.getState().setSelectedColumns(s.columns.toArray().map((i) => columns[i]!.name));
  };

  if (loader.error && !isCancelled(loader.error))
    return (
      <div className="p-4">
        <Banner tone="fail" title="This result can’t be shown">{toEngineError(loader.error).message}</Banner>
      </div>
    );

  const rows = total ?? loaded;
  return (
    <div className="h-full w-full" data-testid="results-table" data-columns={columns.map((c) => c.name).join(',')} data-rows={total ?? ''} data-loaded={loaded} data-selected={selection.columns.toArray().map((i) => columns[i]?.name).join(',')}>
      <DataEditor
        columns={gridColumns}
        rows={rows}
        getCellContent={getCellContent}
        drawHeader={drawHeader}
        headerHeight={HEADER_HEIGHT}
        rowHeight={28}
        rowMarkers="number"
        smoothScrollX
        smoothScrollY
        theme={theme}
        width="100%"
        height="100%"
        gridSelection={selection}
        onGridSelectionChange={onSelection}
        columnSelect="multi"
        rangeSelect="rect"
        onVisibleRegionChanged={onVisible}
        getCellsForSelection
      />
    </div>
  );
}

/** The results table: the viewed node's rows, paged as you scroll, with type and quality in each header. */
export function ResultsTable({ project }: { project: Project }) {
  const engine = useEngineStore((s) => s.engine);
  const nodeId = project.view.viewedNodeId;
  const status = useNodeStatus(nodeId ?? '');

  useEffect(() => {
    if (!nodeId) useResultsStore.getState().set({ rows: undefined, cols: undefined, ms: undefined });
  }, [nodeId]);

  if (!nodeId || !project.nodes.some((n) => n.id === nodeId))
    return (
      <div className="p-4">
        <Banner tone="info" title="No data yet">Click a node to show its data here.</Banner>
      </div>
    );
  if (!engine || status.state === 'pending') return <div className="p-4 text-ink-muted" data-testid="results-loading">Reading data…</div>;
  if (status.state === 'unwired')
    return (
      <div className="p-4">
        <Banner tone="info">Connect a wire into this node to see its rows.</Banner>
      </div>
    );
  if (status.state === 'detached') {
    const node = project.nodes.find((n) => n.id === nodeId);
    const source = node?.type === 'source' ? project.sources.find((x) => x.id === node.sourceId) : undefined;
    return (
      <div className="p-4" data-testid="results-detached">
        <Banner tone="warn" title="This file isn’t connected" action={source && <ReattachButton source={source} />}>
          {source ? detachedMessage(source) : 'Choose the file again to read it.'}
        </Banner>
      </div>
    );
  }
  if (status.state === 'blocked')
    return (
      <div className="p-4">
        <Banner tone="warn">A node upstream is broken or its file isn’t connected. Fix it to see these rows.</Banner>
      </div>
    );
  if (status.state === 'error')
    return (
      <div className="p-4" data-testid="results-error">
        <Banner tone="fail" title="This node can’t run">{status.message}</Banner>
      </div>
    );
  return <StepGrid engine={engine} project={project} target={{ nodeId, stepIndex: project.view.viewedStepIndex }} nodeColumns={status.columns} />;
}

const gridKey = (project: Project, target: Target, columns: ColumnSchema[]) => upstreamKey(project, target) + columns.map((c) => c.name).join('\u0000');

/** Viewing a step inside a node needs that step's columns, which the schema cache knows. */
function StepGrid({ engine, project, target, nodeColumns }: { engine: EngineClient; project: Project; target: Target; nodeColumns: ColumnSchema[] }) {
  const [stepColumns, setStepColumns] = useState<{ key: string; columns: ColumnSchema[] } | { key: string; error: string } | null>(null);
  const key = target.stepIndex == null ? '' : upstreamKey(project, target);
  useEffect(() => {
    if (!key) return;
    let live = true;
    schemaCacheFor(engine)
      .get(project, target)
      .then(
        (columns) => live && setStepColumns({ key, columns }),
        (e: unknown) => live && setStepColumns({ key, error: toEngineError(e).message }),
      );
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine, key]);
  if (!key) return <Grid key={gridKey(project, target, nodeColumns)} engine={engine} project={project} target={target} columns={nodeColumns} />;
  if (stepColumns?.key !== key) return <div className="p-4 text-ink-muted">Reading data…</div>;
  if ('error' in stepColumns)
    return (
      <div className="p-4" data-testid="results-error">
        <Banner tone="fail" title="This step can’t run">{stepColumns.error}</Banner>
      </div>
    );
  return <Grid key={gridKey(project, target, stepColumns.columns)} engine={engine} project={project} target={target} columns={stepColumns.columns} />;
}
