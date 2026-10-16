import { CompactSelection, DataEditor, type DrawCellCallback, type GridCell, type GridColumn, type GridSelection, type Item, type Rectangle } from '@glideapps/glide-data-grid';
import '@glideapps/glide-data-grid/dist/index.css';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useEngineStore } from '../app/engine';
import { useSession } from '../app/session';
import { useTheme } from '../app/theme';
import { compileDisplayPage, compileProfile, compileTypeSniff, PAGE_SIZE, ruleColumns, upstreamKey, type Target } from '../compiler';
import { isCancelled, tableRows, toEngineError, type EngineClient } from '../engine';
import { countRows, schemaCacheFor, useNodeStatus } from '../flow/status';
import { nodeById, type ColumnSchema, type Project } from '../model';
import { Banner, columnKind, glideTheme } from '../ui';
import { failingCells, nullTheme, resultCell } from './cells';
import { HEADER_HEIGHT, headerColors, makeDrawHeader } from './header';
import { PageLoader, type Row } from './pages';
import { DetachedMessage } from '../sources/ReconnectBanner';
import { ReattachButton } from '../sources/ReattachButton';
import { UrlProblemBanner } from '../sources/UrlPanel';
import { attachmentOf } from '../sources/attachments';
import { isExcelSource } from '../sources/excel';
import { ExcelProblemBanner } from '../sources/ExcelPanel';
import { parseProfile, parseTypeSniff, qualityOf, type ColumnProfile } from './profile';
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

/**
 * Profile each column at background priority, after the grid appears: SUMMARIZE first (the quality bars), then
 * what text columns look like. `onUpdate` gets each stage as it lands.
 */
async function loadProfile(engine: EngineClient, project: Project, target: Target, columns: ColumnSchema[], onUpdate: (p: Record<string, ColumnProfile>) => void) {
  const r = await engine.query(compileProfile(project, target), { priority: 'background', supersede: 'profile' });
  const profile = parseProfile(tableRows(r.table));
  onUpdate(profile);
  const text = columns.filter((c) => columnKind(c.type) === 'text').map((c) => c.name);
  if (!text.length) return;
  const sniff = await engine.query(compileTypeSniff(project, target, text), { priority: 'background', supersede: 'profile' });
  const looks = parseTypeSniff(tableRows(sniff.table)[0] ?? {}, text);
  onUpdate(Object.fromEntries(Object.entries(profile).map(([c, p]) => [c, looks[c] ? { ...p, looksLike: looks[c] } : p])));
}

const EMPTY_SELECTION: GridSelection = { columns: CompactSelection.empty(), rows: CompactSelection.empty() };

/** One result's grid. The parent keys it by the result, so a new result starts from fresh state. */
function Grid({ engine, project, target, columns }: { engine: EngineClient; project: Project; target: Target; columns: ColumnSchema[] }) {
  const [loader] = useState(() => createLoader(engine, project, target, columns.map((c) => c.name)));
  const [loaded, setLoaded] = useState(0);
  const [profile, setProfile] = useState<Record<string, ColumnProfile>>({});
  const [total, setTotal] = useState<number | undefined>();
  const [selection, setSelection] = useState<GridSelection>(EMPTY_SELECTION);
  const themeTick = useThemeTick();

  const kinds = useMemo(() => columns.map((c) => columnKind(c.type)), [columns]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const theme = useMemo(() => glideTheme(), [themeTick]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const colors = useMemo(() => headerColors(), [themeTick]);
  const subtle = useMemo(() => nullTheme(theme), [theme]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const failColors = useMemo(() => failingCells(), [themeTick]);
  // Showing a rule's failing rows: the cells it checks are marked.
  const failingRule = target.failingRuleId ? nodeById(project, target.nodeId)?.rules.find((r) => r.id === target.failingRuleId) : undefined;
  const failingCols = useMemo(() => {
    const names = failingRule ? ruleColumns(failingRule) : [];
    return new Set(columns.flatMap((c, i) => (names.includes(c.name) ? [i] : [])));
  }, [failingRule, columns]);
  const drawCell: DrawCellCallback = useCallback(
    ({ ctx, rect, col }, drawContent) => {
      if (!failingCols.has(col)) return drawContent();
      ctx.fillStyle = failColors.tint;
      ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
      drawContent();
      ctx.strokeStyle = failColors.line;
      ctx.lineWidth = 1;
      ctx.strokeRect(rect.x + 1.5, rect.y + 1.5, rect.width - 3, rect.height - 3);
    },
    [failingCols, failColors],
  );

  useEffect(() => {
    let live = true;
    const off = loader.subscribe(() => setLoaded(loader.loadedRows));
    useResultsStore.getState().set({ rows: undefined, cols: columns.length, ms: undefined, profile: undefined });
    useSession.getState().setSelectedColumns([]);
    void loader.ensure(0, PAGE_SIZE).catch(() => undefined);
    countRows(engine, project, target.nodeId, target.stepIndex, target.failingRuleId).then(
      (n) => {
        if (!live) return;
        setTotal(n);
        useResultsStore.getState().set({ rows: n });
      },
      () => undefined,
    );
    loadProfile(engine, project, target, columns, (p) => {
      if (!live) return;
      setProfile(p);
      useResultsStore.getState().set({ profile: p });
    }).catch(() => undefined);
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

  const drawHeader = useMemo(() => makeDrawHeader((i) => ({ kind: kinds[i] ?? 'text', quality: qualityOf(profile[columns[i]?.name ?? '']) }), colors), [kinds, profile, columns, colors]);

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
    <div className="h-full w-full" data-testid="results-table" data-failing-columns={[...failingCols].map((i) => columns[i]?.name).join(',')} data-columns={columns.map((c) => c.name).join(',')} data-rows={total ?? ''} data-loaded={loaded} data-selected={selection.columns.toArray().map((i) => columns[i]?.name).join(',')}>
      <DataEditor
        columns={gridColumns}
        rows={rows}
        getCellContent={getCellContent}
        drawCell={failingCols.size ? drawCell : undefined}
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
    if (source?.kind === 'url')
      return (
        <div className="p-4" data-testid="results-url">
          <UrlProblemBanner source={source} />
        </div>
      );
    if (source && isExcelSource(source) && attachmentOf(source.id) !== 'detached')
      return (
        <div className="p-4" data-testid="results-excel">
          <ExcelProblemBanner source={source} />
        </div>
      );
    return (
      <div className="p-4" data-testid="results-detached">
        <Banner tone="warn" title="This file isn’t connected" action={source && <ReattachButton source={source} />}>
          {source ? <DetachedMessage source={source} /> : 'Choose the file again to read it.'}
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
  return <StepGrid engine={engine} project={project} target={{ nodeId, stepIndex: project.view.viewedStepIndex, failingRuleId: project.view.failingRuleId }} nodeColumns={status.columns} />;
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
