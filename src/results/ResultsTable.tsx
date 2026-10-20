import { CompactSelection, DataEditor, type CellClickedEventArgs, type DataEditorRef, type DrawCellCallback, type GridCell, type GridColumn, type GridSelection, type HeaderClickedEventArgs, type Item, type Rectangle } from '@glideapps/glide-data-grid';
import '@glideapps/glide-data-grid/dist/index.css';
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react';
import { useEngineStore } from '../app/engine';
import { useSession } from '../app/session';
import { useTheme } from '../app/theme';
import { compileDisplayPage, compileProfile, compileTypeSniff, LOAD_FAILURES, PAGE_SIZE, ruleColumns, upstreamKey, type Target } from '../compiler';
import { isCancelled, isStopped, tableRows, toEngineError, type EngineClient } from '../engine';
import { runAgain } from '../flow/rerun';
import { countRows, schemaCacheFor, useNodeStatus } from '../flow/status';
import { nodeById, type ColumnSchema, type Project } from '../model';
import { Banner, Button, columnKind, glideTheme, Icon, NODE_KIND, StatusStrip, useDisplayFormat, type NodeKind } from '../ui';
import { failingCells, nullTheme, resultCell } from './cells';
import { gridLabel } from './label';
import { follow, onlyHere, ScrollSync, supersedeKey, type Pane } from './compare';
import { HEADER_HEIGHT, headerColors, makeDrawHeader } from './header';
import { PageLoader, type Row } from './pages';
import { DetachedMessage } from '../sources/ReconnectBanner';
import { ReattachButton } from '../sources/ReattachButton';
import { UrlProblemBanner } from '../sources/UrlPanel';
import { attachmentOf } from '../sources/attachments';
import { isAccessSource } from '../sources/access';
import { AccessProblemBanner } from '../sources/AccessPanel';
import { isExcelSource } from '../sources/excel';
import { ExcelProblemBanner } from '../sources/ExcelPanel';
import { isXmlSource } from '../sources/xml';
import { XmlProblemBanner } from '../sources/XmlPanel';
import { isRewrittenText } from '../sources/text';
import { RewriteProblemBanner } from '../sources/TextPanels';
import { parseProfile, parseTypeSniff, qualityOf, type ColumnProfile } from './profile';
import { cardKind } from '../canvas/kind';
import { closeCompare, comparedNode } from './pin';
import { useResultsStore } from './state';
import { showFailing } from '../rules/view';
import { ColumnMenu, type ColumnMenuRequest } from '../quickfix/ColumnMenu';

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

/** A page loader for one result. Page 0 supersedes the pane's previous preview and times the status strip. */
function createLoader(engine: EngineClient, project: Project, target: Target, columns: string[], pane: Pane, onMs: (ms: number) => void): PageLoader {
  const supersede = supersedeKey(pane, 'preview');
  return new PageLoader(async (page) => {
    const t0 = performance.now();
    const r = await engine.query(compileDisplayPage(project, target, columns, page), page === 0 ? { supersede, label: 'Reading rows' } : { label: 'Reading rows' });
    if (page === 0) onMs(performance.now() - t0);
    return tableRows(r.table).map((row): Row => columns.map((c) => (row[c] == null ? null : String(row[c]))));
  }, PAGE_SIZE);
}

/**
 * Profile each column at background priority, after the grid appears: SUMMARIZE first (the quality bars), then
 * what text columns look like. `onUpdate` gets each stage as it lands.
 */
async function loadProfile(engine: EngineClient, project: Project, target: Target, columns: ColumnSchema[], pane: Pane, onUpdate: (p: Record<string, ColumnProfile>) => void) {
  const supersede = supersedeKey(pane, 'profile');
  const r = await engine.query(compileProfile(project, target), { priority: 'background', supersede, label: 'Profiling columns' });
  const profile = parseProfile(tableRows(r.table), Object.fromEntries(columns.map((c) => [c.name, columnKind(c.type)])));
  onUpdate(profile);
  const text = columns.filter((c) => columnKind(c.type) === 'text').map((c) => c.name);
  if (!text.length) return;
  const sniff = await engine.query(compileTypeSniff(project, target, text), { priority: 'background', supersede, label: 'Profiling columns' });
  const looks = parseTypeSniff(tableRows(sniff.table)[0] ?? {}, text);
  onUpdate(Object.fromEntries(Object.entries(profile).map(([c, p]) => [c, looks[c] ? { ...p, ...looks[c] } : p])));
}

/** Stop was pressed while this was being read. */
function Stopped() {
  return (
    <div className="p-4" data-testid="results-stopped">
      <Banner
        tone="info"
        title="Stopped"
        action={
          <Button size="sm" variant="secondary" onClick={runAgain}>
            Run again
          </Button>
        }
      >
        Puddle stopped reading this result before it finished.
      </Banner>
    </div>
  );
}

const EMPTY_SELECTION: GridSelection = { columns: CompactSelection.empty(), rows: CompactSelection.empty() };

/**
 * Comparing two results: which pane a grid is in, how the two scroll together, and the other side's columns. The
 * main pane alone drives the status strip and the selected columns.
 */
interface PaneProps {
  pane?: Pane;
  sync?: ScrollSync;
  other?: string[];
  onColumns?: (pane: Pane, columns: string[] | undefined) => void;
}

/** Each row's height in the grid. */
const ROW_HEIGHT = 28;

/**
 * Which grid leads when comparing: the one the person last scrolled, clicked or typed in. Only the leading grid's
 * moves are passed on; the other only follows. A time window after following (the earlier way) failed in Firefox,
 * whose smooth scrolling keeps moving a grid well after the wheel stops: the grids took turns following each
 * other's leftovers and came to rest on different rows.
 */

/** One result's grid. The parent keys it by the result, so a new result starts from fresh state. */
function Grid({ engine, project, target, columns, pane = 'main', sync, other, onColumns }: { engine: EngineClient; project: Project; target: Target; columns: ColumnSchema[] } & PaneProps) {
  const main = pane === 'main';
  const [ms, setMs] = useState<number | undefined>();
  const [loader] = useState(() =>
    createLoader(engine, project, target, columns.map((c) => c.name), pane, (t) => {
      setMs(t);
      if (main) useResultsStore.getState().set({ ms: t });
    }),
  );
  const [loaded, setLoaded] = useState(0);
  const [profile, setProfile] = useState<Record<string, ColumnProfile>>({});
  const [total, setTotal] = useState<number | undefined>();
  const [selection, setSelection] = useState<GridSelection>(EMPTY_SELECTION);
  const [spot, setSpot] = useState({ x: 0, y: 0 });
  const themeTick = useThemeTick();
  const names = useMemo(() => columns.map((c) => c.name), [columns]);
  const only = useMemo(() => onlyHere(names, other), [names, other]);
  const editor = useRef<DataEditorRef>(null);
  const box = useRef<HTMLDivElement>(null);
  const at = useRef({ x: 0, y: 0 });
  const leading = useRef(false);

  const kinds = useMemo(() => columns.map((c) => columnKind(c.type)), [columns]);
  const display = useDisplayFormat();
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
    if (main) {
      useResultsStore.getState().set({ rows: undefined, cols: columns.length, ms: undefined, profile: undefined });
      useSession.getState().setSelectedColumns([]);
    }
    onColumns?.(pane, names);
    void loader.ensure(0, PAGE_SIZE).catch(() => undefined);
    countRows(engine, project, target.nodeId, target.stepIndex, target.failingRuleId).then(
      (n) => {
        if (!live) return;
        setTotal(n);
        if (main) useResultsStore.getState().set({ rows: n });
      },
      () => undefined,
    );
    loadProfile(engine, project, target, columns, pane, (p) => {
      if (!live) return;
      setProfile(p);
      if (main) useResultsStore.getState().set({ profile: p });
    }).catch(() => undefined);
    return () => {
      live = false;
      off();
      onColumns?.(pane, undefined);
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
      return resultCell(r ? (r[col] ?? null) : undefined, kinds[col] ?? 'text', subtle, display);
    },
    // `loaded` changes as pages arrive, so the grid redraws them.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [loader, kinds, subtle, loaded, display],
  );

  const drawHeader = useMemo(
    () => makeDrawHeader((i) => ({ kind: kinds[i] ?? 'text', quality: qualityOf(profile[names[i] ?? '']), only: only.has(names[i] ?? '') }), colors),
    [kinds, profile, names, only, colors],
  );

  // Comparing: follow the other grid's row, and its column where this side has the same one.
  useEffect(
    () =>
      sync?.on(pane, (to) => {
        leading.current = false;
        const next = follow(to, names, at.current.x);
        if (next.row === at.current.y && next.col === at.current.x) return;
        // The row is set where it belongs, a pixel into it, rather than through the grid's scrollTo, which moves by a
        // distance measured on screen: in WebKit that came out a fraction short (the row before), and in Firefox the
        // grids came to rest rows apart. Only the leading grid passes its moves on, so nothing corrected either.
        // (`.dvn-scroller` is the grid's scrolling element.) The column goes first, through the grid, as its scrollTo
        // writes the vertical position back.
        if (next.horizontal) editor.current?.scrollTo(next.col, next.row, 'horizontal', -1, 0, { hAlign: 'start' });
        const scroller = box.current?.querySelector<HTMLElement>('.dvn-scroller');
        if (scroller) scroller.scrollTop = next.row * ROW_HEIGHT + 1;
        else editor.current?.scrollTo(next.col, next.row, 'vertical', 0, -1, { vAlign: 'start' });
      }),
    [sync, pane, names],
  );

  const onVisible = useCallback(
    (r: Rectangle) => {
      void loader.ensure(r.y, r.height + 20).catch(() => undefined);
      if (r.x === at.current.x && r.y === at.current.y) return;
      at.current = { x: r.x, y: r.y };
      setSpot(at.current);
      if (sync && leading.current) sync.publish(pane, { row: r.y, column: names[r.x] });
    },
    [loader, sync, pane, names],
  );

  // Glide draws on a canvas and mirrors the visible cells in a table with role="grid" inside it, its row and column
  // counts included; it has no name of its own, so it's given one, and so is the region around it, which every
  // screen reader can find whether or not it reads a canvas's contents.
  const label = gridLabel(nodeById(project, target.nodeId)?.name ?? '', total, columns.length);
  const labelNow = useRef(label);
  useEffect(() => {
    labelNow.current = label;
    box.current?.querySelector('table[role="grid"]')?.setAttribute('aria-label', label);
  }, [label]);
  // Glide draws its table a moment after each render of its own, so it's named again whenever it's drawn.
  const gridBox = useCallback((el: HTMLDivElement | null) => {
    box.current = el;
    if (!el) return;
    const name = () => {
      const table = el.querySelector('table[role="grid"]');
      if (table && table.getAttribute('aria-label') !== labelNow.current) table.setAttribute('aria-label', labelNow.current);
    };
    const watch = new MutationObserver(name);
    watch.observe(el, { childList: true, subtree: true });
    name();
    return () => watch.disconnect();
  }, []);

  const onSelection = (s: GridSelection) => {
    setSelection(s);
    if (main) useSession.getState().setSelectedColumns(s.columns.toArray().map((i) => columns[i]!.name));
  };

  // The column menu (main pane only): a right click on a header or cell, or a click on a header's chevron. It acts on
  // the selected columns when the clicked one is among them; otherwise the clicked column alone is selected first.
  const [menu, setMenu] = useState<ColumnMenuRequest | null>(null);
  const openMenu = (col: number, at: { x: number; y: number }, cell?: ColumnMenuRequest['cell']) => {
    if (!main || col < 0 || !columns[col]) return;
    const already = selection.columns.hasIndex(col);
    if (!already) onSelection({ columns: CompactSelection.fromSingleSelection(col), rows: CompactSelection.empty() });
    const picked = already ? selection.columns.toArray().map((i) => columns[i]!.name) : [columns[col]!.name];
    setMenu({ ...at, columns: picked, cell });
  };
  const pointer = (e: HeaderClickedEventArgs | CellClickedEventArgs) => ({ x: e.bounds.x + e.localEventX, y: e.bounds.y + e.localEventY });
  const onHeaderContextMenu = (col: number, e: HeaderClickedEventArgs) => {
    e.preventDefault();
    openMenu(col, pointer(e));
  };
  // The chevron drawn at the header's right edge opens the same menu, under the header.
  const onHeaderClicked = (col: number, e: HeaderClickedEventArgs) => {
    if (e.localEventX < e.bounds.width - 24 || e.localEventY > HEADER_HEIGHT - 8) return;
    openMenu(col, { x: e.bounds.x + e.bounds.width - 24, y: e.bounds.y + e.bounds.height });
  };
  // From the keyboard: the context menu key, or Shift+F10, on the selected columns.
  const onMenuKey = (e: ReactKeyboardEvent) => {
    const first = selection.columns.first();
    if (!(e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) || first === undefined) return;
    e.preventDefault();
    const box = (e.currentTarget as HTMLElement).getBoundingClientRect();
    openMenu(first, { x: box.left + 48, y: box.top + HEADER_HEIGHT });
  };
  const onCellContextMenu = ([col, row]: Item, e: CellClickedEventArgs) => {
    e.preventDefault();
    const r = loader.row(row);
    if (!r || !columns[col]) return;
    openMenu(col, pointer(e), { column: columns[col]!.name, value: r[col] ?? null });
  };

  if (isStopped(loader.error)) return <Stopped />;
  if (loader.error && !isCancelled(loader.error))
    return (
      <div className="p-4">
        <Banner tone="fail" title="This result can’t be shown">{toEngineError(loader.error).message}</Banner>
      </div>
    );

  const rows = total ?? loaded;
  const userScrolls = () => {
    leading.current = true;
  };
  const grid = (
    <div
      ref={gridBox}
      role="region"
      aria-label={label}
      className="min-h-0 w-full flex-1"
      data-testid={main ? 'results-table' : 'results-table-compare'}
      data-failing-columns={[...failingCols].map((i) => columns[i]?.name).join(',')}
      data-columns={names.join(',')}
      data-only-columns={[...only].join(',')}
      data-rows={total ?? ''}
      data-loaded={loaded}
      data-selected={selection.columns.toArray().map((i) => columns[i]?.name).join(',')}
      data-first-row={spot.y}
      data-first-column={names[spot.x] ?? ''}
      onWheelCapture={userScrolls}
      onPointerDownCapture={userScrolls}
      onKeyDownCapture={userScrolls}
      onKeyDown={main ? onMenuKey : undefined}
    >
      <DataEditor
        ref={editor}
        columns={gridColumns}
        rows={rows}
        getCellContent={getCellContent}
        drawCell={failingCols.size ? drawCell : undefined}
        drawHeader={drawHeader}
        headerHeight={HEADER_HEIGHT}
        rowHeight={ROW_HEIGHT}
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
        onHeaderContextMenu={main ? onHeaderContextMenu : undefined}
        onHeaderClicked={main ? onHeaderClicked : undefined}
        onCellContextMenu={main ? onCellContextMenu : undefined}
      />
      {menu && <ColumnMenu request={menu} available={columns} onClose={() => setMenu(null)} />}
    </div>
  );
  if (!sync) return <div className="flex h-full w-full flex-col">{grid}</div>;
  // Side by side, each grid has its own counts under it.
  return (
    <div className="flex h-full w-full flex-col" data-testid={`pane-strip-${pane}`}>
      {grid}
      <StatusStrip rows={total} cols={columns.length} ms={ms} />
    </div>
  );
}

/**
 * The results table: the viewed node's rows, paged as you scroll, with type and quality in each header. Pinned and
 * comparing, a second node's rows sit beside them.
 */
export function ResultsTable({ project }: { project: Project }) {
  const engine = useEngineStore((s) => s.engine);
  const nodeId = project.view.viewedNodeId;

  useEffect(() => {
    if (!nodeId) useResultsStore.getState().set({ rows: undefined, cols: undefined, ms: undefined });
  }, [nodeId]);

  if (!nodeId || !project.nodes.some((n) => n.id === nodeId))
    return (
      <div className="p-4">
        <Banner tone="info" title="No data yet">Click a node to show its data here.</Banner>
      </div>
    );
  const target: Target = { nodeId, stepIndex: project.view.viewedStepIndex, failingRuleId: project.view.failingRuleId };
  const compared = comparedNode(project);
  if (!compared) return <NodeResult engine={engine} project={project} target={target} />;
  return <Compare engine={engine} project={project} target={target} compareId={compared.id} />;
}

/** Two results side by side, scrolling together where their columns match. */
function Compare({ engine, project, target, compareId }: { engine: EngineClient | null; project: Project; target: Target; compareId: string }) {
  const [sync] = useState(() => new ScrollSync());
  const [columns, setColumns] = useState<Partial<Record<Pane, string[]>>>({});
  const onColumns = useCallback((pane: Pane, cols: string[] | undefined) => setColumns((c) => (c[pane] === cols ? c : { ...c, [pane]: cols })), []);
  const viewed = nodeById(project, target.nodeId)!;
  const compared = nodeById(project, compareId)!;
  const step = target.stepIndex == null ? '' : ` · step ${target.stepIndex + 1}`;
  return (
    <div className="grid h-full grid-cols-2 divide-x divide-line" data-testid="results-compare">
      <section className="flex min-h-0 min-w-0 flex-col" aria-label={`Results of ${viewed.name}`} data-testid="pane-main">
        <PaneTitle kind={cardKind(viewed.type)} name={`${viewed.name}${step}`} />
        <div className="min-h-0 flex-1">
          <NodeResult engine={engine} project={project} target={target} pane="main" sync={sync} other={columns.compare} onColumns={onColumns} />
        </div>
      </section>
      <section className="flex min-h-0 min-w-0 flex-col" aria-label={`Results of ${compared.name}`} data-testid="pane-compare">
        <PaneTitle
          kind={cardKind(compared.type)}
          name={compared.name}
          action={<Button variant="ghost" size="sm" iconOnly icon="cross" aria-label="Stop comparing" title="Stop comparing" onClick={closeCompare} />}
        />
        <div className="min-h-0 flex-1">
          <NodeResult key={compareId} engine={engine} project={project} target={{ nodeId: compareId }} pane="compare" sync={sync} other={columns.main} onColumns={onColumns} />
        </div>
      </section>
    </div>
  );
}

function PaneTitle({ kind, name, action }: { kind: NodeKind; name: string; action?: ReactNode }) {
  return (
    <div className="flex h-8 flex-none items-center gap-2 border-b border-line px-3 text-label text-ink-muted">
      <Icon name={NODE_KIND[kind].icon} size={14} />
      <span className="min-w-0 flex-1 truncate font-semibold text-ink" data-testid="pane-title">{name}</span>
      {action}
    </div>
  );
}

/** One node's result, or why it can't be shown yet. */
function NodeResult({ engine, project, target, ...pane }: { engine: EngineClient | null; project: Project; target: Target } & PaneProps) {
  const nodeId = target.nodeId;
  const status = useNodeStatus(nodeId);
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
    if (source && isXmlSource(source) && attachmentOf(source.id) !== 'detached')
      return (
        <div className="p-4" data-testid="results-xml">
          <XmlProblemBanner source={source} />
        </div>
      );
    if (source && isRewrittenText(source) && attachmentOf(source.id) !== 'detached')
      return (
        <div className="p-4" data-testid="results-rewrite">
          <RewriteProblemBanner source={source} />
        </div>
      );
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
    if (source && isAccessSource(source) && attachmentOf(source.id) !== 'detached')
      return (
        <div className="p-4" data-testid="results-access">
          <AccessProblemBanner source={source} />
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
  if (status.state === 'error' && status.stopped) return <Stopped />;
  // A Schema table refusing a load shows the rows it refuses, each with why, when asked to.
  if (status.state === 'error' && status.failures && target.failingRuleId === LOAD_FAILURES) return <StepGrid engine={engine} project={project} target={target} nodeColumns={[]} {...pane} />;
  if (status.state === 'error')
    return (
      <div className="p-4" data-testid="results-error">
        <Banner
          tone="fail"
          title={status.failures ? 'Some rows can’t load' : 'This node can’t run'}
          action={
            status.failures && (
              <Button size="sm" variant="secondary" onClick={() => showFailing(nodeId, LOAD_FAILURES)}>
                Show failing rows
              </Button>
            )
          }
        >
          {status.message}
        </Banner>
      </div>
    );
  return <StepGrid engine={engine} project={project} target={target} nodeColumns={status.columns} {...pane} />;
}

const gridKey = (project: Project, target: Target, columns: ColumnSchema[]) => upstreamKey(project, target) + columns.map((c) => c.name).join('\u0000');

/** Viewing a step inside a node needs that step's columns, which the schema cache knows. */
function StepGrid({ engine, project, target, nodeColumns, ...pane }: { engine: EngineClient; project: Project; target: Target; nodeColumns: ColumnSchema[] } & PaneProps) {
  const [stepColumns, setStepColumns] = useState<{ key: string; columns: ColumnSchema[] } | { key: string; error: string } | null>(null);
  // A step's columns, or a load's failing rows (its raw input with why each fails), are described on their own.
  const key = target.stepIndex == null && target.failingRuleId !== LOAD_FAILURES ? '' : upstreamKey(project, target);
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
  if (!key) return <Grid key={gridKey(project, target, nodeColumns)} engine={engine} project={project} target={target} columns={nodeColumns} {...pane} />;
  if (stepColumns?.key !== key) return <div className="p-4 text-ink-muted">Reading data…</div>;
  if ('error' in stepColumns)
    return (
      <div className="p-4" data-testid="results-error">
        <Banner tone="fail" title="This step can’t run">{stepColumns.error}</Banner>
      </div>
    );
  return <Grid key={gridKey(project, target, stepColumns.columns)} engine={engine} project={project} target={target} columns={stepColumns.columns} {...pane} />;
}
