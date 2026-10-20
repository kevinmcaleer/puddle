import { Fingerprint, KeyRound, Link2, StickyNote } from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { Button, ContextMenu, cx, type MenuItem } from '../../ui';
import { addRef, addStickyNote, addTable, freeName, type ColumnRef, type TableRef } from '../edit';
import { AskBox, RefAsk } from './DiagramEditing';
import { answer, columnMenu, tableMenu, tableRef, type Ask, type DiagramEdit, type PaneSpot } from './editing';
import { qualified, type Column, type DbmlSchema, type Table } from '../model';
import { CHAR, columnLabel, ENUM_TAG, GLYPH, layoutDiagram, LINE, PAD, ROW, type DetailLevel, type Diagram, type Point, type Rect, type TableBox } from './geometry';
import { autoArrange } from './arrange';
import { centreOn, clampZoom, fitView, START, toDiagram, zoomAt, type View } from './viewport';

const NUDGE = 16;
const NUDGE_FAR = 64;
const PAN = 48;
const PAN_FAR = 192;
const ZOOM_STEP = 1.25;
/** The popover's width (the design system's 240px popover), its tallest usual height, and its gap from the element. */
const POP_WIDTH = 240;
/** A table's popover with its data sample. */
const POP_WIDE = 360;
const POP_HEIGHT = 160;
const POP_GAP = 8;

export interface SchemaDiagramProps {
  schema: DbmlSchema;
  positions: Record<string, Point>;
  detail?: DetailLevel;
  /** The table the editor's caret is in, by diagram id. */
  current?: string | null;
  /** Elements were moved (dragged, nudged with the arrow keys, or a group dragged with its tables). */
  onMove: (moves: Record<string, Point>) => void;
  /** A table, or one of its columns, was clicked or chosen with Enter. */
  onPick?: (tableId: string, column?: string) => void;
  /**
   * Editing on the diagram: menus on tables and columns, renaming in place, dragging a column onto another for a ref,
   * and adding tables and notes. Each change is made on the DBML text. Without it the diagram only moves things.
   */
  onEdit?: DiagramEdit;
  /** Only these tables, by diagram id (a view); every table when absent. Sticky notes show only with every table. */
  only?: Set<string>;
  /** Where the diagram opens panned and zoomed to; fitted or at 100% when absent. */
  initialView?: View;
  /** The pan and zoom, a moment after they stop changing. */
  onViewChange?: (view: View) => void;
  /** The tables selected with Shift+click changed, by diagram id. */
  onSelectionChange?: (ids: string[]) => void;
  /** In a view: take these tables (by diagram id) out of it. Adds "Hide from view" to the table menu. */
  onHide?: (ids: string[]) => void;
  /** Tables to select, by diagram id, each time a new list is given (the tables just imported). */
  choose?: string[];
  /** A table's data sample, shown under its details when it is hovered or focused. */
  sample?: (table: Table) => ReactNode;
  /** More actions on a table's menu (its data: open its rows, fill it with sample rows). */
  tableActions?: (table: Table) => MenuItem[];
  /** Tables, by diagram id, that aren't in the DBML (drawn from the canvas): they move, but can't be edited. Their menu has only `tableActions`. */
  locked?: Set<string>;
}

/** A table's menu with more actions, put before its Delete. */
const withActions = (items: MenuItem[], more: MenuItem[]) => [...items.slice(0, -1), ...more, ...items.slice(-1)];

/** What the popover shows, and where: next to a table or a column's row. */
interface Pop {
  table: string;
  column?: string;
  at: { left: number; top: number };
}

/** The tables, enums and refs that touch a table: what stays bright while it is hovered or current. */
function related(d: Diagram, id: string | null | undefined): Set<string> | null {
  if (!id || !d.tables.some((t) => t.id === id)) return null;
  const out = new Set([id]);
  for (const r of d.refs)
    if (r.from.id === id || r.to.id === id) {
      out.add(r.from.id);
      out.add(r.to.id);
      out.add(`ref:${r.index}`);
    }
  for (const l of d.enumLinks)
    if (l.table.id === id) {
      out.add(l.enumBox.id);
      out.add(`link:${l.enumBox.id}:${l.table.id}.${l.column}`);
    }
  return out;
}

const endpoint = (e: { schema: string; table: string; columns: string[] }) =>
  `${qualified(e.schema, e.table)}.${e.columns.length > 1 ? `(${e.columns.join(', ')})` : e.columns[0]}`;

function ColumnDetails({ schema, table, column }: { schema: DbmlSchema; table: Table; column: Column }) {
  const marks = [column.pk && 'primary key', column.unique && 'unique', column.notNull && 'not null', column.increment && 'increment'].filter(Boolean).join(', ');
  const refs = schema.refs.flatMap((r) => {
    const out: string[] = [];
    if (r.from.schema === table.schema && r.from.table === table.name && r.from.columns.includes(column.name)) out.push(`${r.op} ${endpoint(r.to)}`);
    if (r.to.schema === table.schema && r.to.table === table.name && r.to.columns.includes(column.name)) out.push(`${r.op === '<' ? '>' : r.op === '>' ? '<' : r.op} ${endpoint(r.from)}`);
    return out;
  });
  const e = schema.enums.find((x) => qualified(x.schema, x.name) === column.type);
  return (
    <>
      <div className="ui-popover__head">
        <span className="puddle-schema-pop__name">{column.name}</span>
        <span className="ui-metric">{column.type}</span>
      </div>
      <dl className="puddle-schema-pop__body">
        {marks && <Detail term="Settings">{marks}</Detail>}
        {column.default && <Detail term="Default">{column.default.value}</Detail>}
        {column.checks.map((c, i) => (
          <Detail key={i} term="Check">{c}</Detail>
        ))}
        {refs.map((r, i) => (
          <Detail key={`r${i}`} term="Ref">{r}</Detail>
        ))}
        {e && <Detail term="Values">{e.values.map((v) => v.name).join(', ')}</Detail>}
        {column.note && <Detail term="Note">{column.note}</Detail>}
        {!marks && !column.default && !column.checks.length && !refs.length && !e && !column.note && <Detail term="Settings">none</Detail>}
      </dl>
    </>
  );
}

function TableDetails({ table }: { table: Table }) {
  return (
    <>
      <div className="ui-popover__head">
        <span className="puddle-schema-pop__name">{qualified(table.schema, table.name)}</span>
        <span className="ui-metric">
          {table.columns.length} {table.columns.length === 1 ? 'column' : 'columns'}
        </span>
      </div>
      <dl className="puddle-schema-pop__body">
        {table.alias && <Detail term="Alias">{table.alias}</Detail>}
        {table.note && <Detail term="Note">{table.note}</Detail>}
        {table.checks.map((c, i) => (
          <Detail key={i} term="Check">{c.name ? `${c.name}: ${c.expression}` : c.expression}</Detail>
        ))}
        {table.indexes.map((ix, i) => (
          <Detail key={`i${i}`} term={ix.pk ? 'Primary key' : ix.unique ? 'Unique index' : 'Index'}>
            {(ix.name ? `${ix.name}: ` : '') + ix.parts.map((p) => p.value).join(', ')}
          </Detail>
        ))}
        {table.columns.filter((c) => c.note).map((c) => (
          <Detail key={`c${c.name}`} term={c.name}>{c.note}</Detail>
        ))}
        {!table.alias && !table.note && !table.checks.length && !table.indexes.length && !table.columns.some((c) => c.note) && <Detail term="Note">none</Detail>}
      </dl>
    </>
  );
}

const Detail = ({ term, children }: { term: string; children: ReactNode }) => (
  <div className="puddle-schema-pop__row">
    <dt>{term}</dt>
    <dd>{children}</dd>
  </div>
);

/**
 * The schema drawn and navigable: tables with their columns and marks, refs with 1 and ∞ ends, enums with dotted
 * links to the columns that use them, group frames and sticky notes. Pans and zooms with the wheel, a trackpad, the
 * toolbar or the keyboard; a search box finds a table and centres it.
 */
export function SchemaDiagram({ schema, positions, detail = 'full', current, onMove, onPick, onEdit, only, initialView, onViewChange, onSelectionChange, onHide, choose, sample, tableActions, locked }: SchemaDiagramProps) {
  const [moving, setMoving] = useState<Record<string, Point>>();
  const shown = useMemo(() => (moving ? { ...positions, ...moving } : positions), [positions, moving]);
  const diagram = useMemo(() => layoutDiagram(schema, shown, { detail, only }), [schema, shown, detail, only]);
  const [view, setView] = useState<View>(initialView ?? START);
  const viewRef = useRef(view);
  useEffect(() => {
    viewRef.current = view;
  }, [view]);
  const frame = useRef<HTMLDivElement>(null);
  const svg = useRef<SVGSVGElement>(null);
  const tools = useRef<HTMLDivElement>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const [found, setFound] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [pop, setPop] = useState<Pop | null>(null);
  const popId = useId();
  const listId = useId();
  // Editing: the open menu, the box being typed in, the ref being drawn and the one being asked about, and the tables
  // selected with Shift+click (a new group takes them all).
  const [menu, setMenu] = useState<{ x: number; y: number; label: string; items: MenuItem[] } | null>(null);
  const [ask, setAsk] = useState<Ask | null>(null);
  const [linking, setLinking] = useState<{ from: Point; to: Point } | null>(null);
  const [refAsk, setRefAsk] = useState<{ from: ColumnRef; to: ColumnRef; at: PaneSpot } | null>(null);
  const [selected, setSelected] = useState<string[]>(() => choose ?? []);
  const heard = useRef({ onSelectionChange, onViewChange });
  useEffect(() => {
    heard.current = { onSelectionChange, onViewChange };
  });
  useEffect(() => heard.current.onSelectionChange?.(selected), [selected]);
  // A new list to choose replaces the selection, set while rendering so no effect runs it a frame late.
  const [chosen, setChosen] = useState(choose);
  if (choose !== chosen) {
    setChosen(choose);
    if (choose) setSelected(choose);
  }
  // The pan and zoom are kept once they settle, not on every frame of a drag or a pinch.
  useEffect(() => {
    if (view === START) return;
    const t = setTimeout(() => heard.current.onViewChange?.(view), 400);
    return () => clearTimeout(t);
  }, [view]);

  const refColumns = useMemo(() => {
    const set = new Set<string>();
    for (const r of schema.refs) for (const e of [r.from, r.to]) for (const c of e.columns) set.add(`${e.schema}.${e.table}.${c}`);
    return set;
  }, [schema]);

  const lit = related(diagram, hovered ?? found ?? current);
  const dim = (id: string) => lit != null && !lit.has(id);

  const pane = () => ({ w: frame.current?.clientWidth ?? 800, h: frame.current?.clientHeight ?? 600 });
  const zoomBy = (f: number) => {
    const { w, h } = pane();
    setView((v) => zoomAt(v, clampZoom(v.k * f), w / 2, h / 2));
  };
  /** The view that fits a drawing in the pane, below the tools floating over its top. */
  const fitted = (b: Rect) => {
    const { w, h } = pane();
    const top = (tools.current?.offsetTop ?? 0) + (tools.current?.offsetHeight ?? 0);
    const v = fitView(b, w, h - top);
    return { ...v, y: v.y + top };
  };
  const fit = () => setView(fitted(diagram.bounds));
  const actual = () => {
    const { w, h } = pane();
    setView((v) => zoomAt(v, 1, w / 2, h / 2));
  };

  // A diagram bigger than the pane opens fitted; one that fits opens at 100%, from the top left under the tools. The pane's size is
  // known once it is laid out, so the first size the observer reports decides.
  const bounds = useRef(diagram.bounds);
  useEffect(() => {
    bounds.current = diagram.bounds;
  }, [diagram]);
  useEffect(() => {
    const el = frame.current;
    if (initialView || !el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => {
      ro.disconnect();
      const b = bounds.current;
      // Below the tools that float over the pane's top, so nothing starts hidden under them.
      const top = (tools.current?.offsetTop ?? 0) + (tools.current?.offsetHeight ?? 0);
      if (b.x + b.w > el.clientWidth || b.y + b.h > el.clientHeight - top) setView(fitted(b));
      else setView({ ...START, y: top });
    });
    ro.observe(el);
    return () => ro.disconnect();
    // Once, when the diagram is first drawn.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The wheel pans, and zooms with Ctrl or a trackpad pinch (which browsers send as a wheel with Ctrl).
  useEffect(() => {
    const el = svg.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const box = el.getBoundingClientRect();
      if (e.ctrlKey || e.metaKey) {
        const v = viewRef.current;
        setView(zoomAt(v, v.k * Math.exp(-e.deltaY * 0.01), e.clientX - box.left, e.clientY - box.top));
      } else setView((v) => ({ ...v, x: v.x - e.deltaX, y: v.y - e.deltaY }));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  const drag = (e: ReactPointerEvent, onDelta: (dx: number, dy: number) => void, onDone: (moved: boolean) => void) => {
    const start = { x: e.clientX, y: e.clientY };
    const pointer = e.pointerId;
    let moved = false;
    const onPointerMove = (ev: PointerEvent) => {
      if (ev.pointerId !== pointer) return;
      const dx = ev.clientX - start.x;
      const dy = ev.clientY - start.y;
      if (!moved && Math.hypot(dx, dy) < 3) return;
      moved = true;
      onDelta(dx, dy);
    };
    const onEnd = (ev: PointerEvent) => {
      if (ev.pointerId !== pointer) return;
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onEnd);
      window.removeEventListener('pointercancel', onEnd);
      onDone(moved && ev.type === 'pointerup');
    };
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onEnd);
    window.addEventListener('pointercancel', onEnd);
  };

  /** Drag elements: their places follow the pointer, scaled by the zoom, and are saved when it lets go. */
  const startMove = (items: (Point & { id: string })[], e: ReactPointerEvent) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    const k = viewRef.current.k;
    let last: Record<string, Point> = {};
    setPop(null);
    drag(
      e,
      (dx, dy) => {
        last = Object.fromEntries(items.map((it) => [it.id, { x: Math.max(0, Math.round(it.x + dx / k)), y: Math.max(0, Math.round(it.y + dy / k)) }]));
        setMoving(last);
      },
      (done) => {
        setMoving(undefined);
        if (done) onMove(last);
      },
    );
  };

  const startPan = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (e.button !== 0 || e.target !== e.currentTarget) return;
    const from = viewRef.current;
    e.currentTarget.classList.add('is-panning');
    const el = e.currentTarget;
    drag(
      e,
      (dx, dy) => setView({ ...from, x: from.x + dx, y: from.y + dy }),
      () => el.classList.remove('is-panning'),
    );
  };

  const paneKeys = (e: ReactKeyboardEvent<SVGSVGElement>) => {
    if (e.target !== e.currentTarget || e.altKey || e.ctrlKey || e.metaKey) return;
    const step = e.shiftKey ? PAN_FAR : PAN;
    const by = { ArrowLeft: [step, 0], ArrowRight: [-step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] }[e.key];
    if (by) {
      e.preventDefault();
      setView((v) => ({ ...v, x: v.x + by[0]!, y: v.y + by[1]! }));
    } else if (e.key === '+' || e.key === '=') {
      e.preventDefault();
      zoomBy(ZOOM_STEP);
    } else if (e.key === '-' || e.key === '_') {
      e.preventDefault();
      zoomBy(1 / ZOOM_STEP);
    } else if (e.key === '0' || e.key === ')') {
      e.preventDefault();
      actual();
    } else if (e.key === '!' || (e.shiftKey && e.code === 'Digit1')) {
      e.preventDefault();
      fit();
    }
  };

  const elementKeys = (box: Rect & { id: string }, pick?: () => void) => (e: ReactKeyboardEvent<SVGGElement>) => {
    if (e.target !== e.currentTarget) return;
    if (e.key === 'Enter' && pick) {
      e.preventDefault();
      pick();
      return;
    }
    if (e.key === 'Escape') {
      setPop(null);
      return;
    }
    const step = e.shiftKey ? NUDGE_FAR : NUDGE;
    const by = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
    if (!by || e.altKey || e.ctrlKey || e.metaKey) return;
    e.preventDefault();
    e.stopPropagation();
    onMove({ [box.id]: { x: Math.max(0, box.x + by[0]!), y: Math.max(0, box.y + by[1]!) } });
  };

  /** The popover beside an element, in pane coordinates. */
  const showPop = (el: Element, table: string, column?: string) => {
    const f = frame.current?.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    if (!f) return;
    // Beside the element, on whichever side has room, and kept inside the pane.
    const room = f.right - r.right;
    const width = sample && !column ? POP_WIDE : POP_WIDTH;
    const left = room >= width + POP_GAP ? r.right - f.left + POP_GAP : Math.max(POP_GAP, r.left - f.left - width - POP_GAP);
    const top = Math.max(POP_GAP, Math.min(r.top - f.top, f.height - POP_HEIGHT - POP_GAP));
    setPop({ table, column, at: { left, top } });
  };

  const search = (text: string, exactOnly: boolean) => {
    const q = text.trim().toLowerCase();
    if (!q) {
      setFound(null);
      return;
    }
    const exact = diagram.tables.find((t) => t.label.toLowerCase() === q || t.table.name.toLowerCase() === q);
    const match = exact ?? (exactOnly ? undefined : (diagram.tables.find((t) => t.label.toLowerCase().startsWith(q)) ?? diagram.tables.find((t) => t.label.toLowerCase().includes(q))));
    if (!match) {
      if (!exactOnly) setFound(null);
      return;
    }
    setFound(match.id);
    const { w, h } = pane();
    setView((v) => centreOn(v, match, w, h));
  };

  /** Where an element is in the pane, for a box or popover beside it. */
  const spotOf = (el: Element, below = false): PaneSpot => {
    const f = frame.current!.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    return { left: Math.max(POP_GAP, Math.min(r.left - f.left, f.width - POP_WIDTH - POP_GAP)), top: Math.max(POP_GAP, below ? r.bottom - f.top + 4 : r.top - f.top), width: r.width };
  };
  const boxOf = (id: string) => diagram.tables.find((t) => t.id === id);
  const selection = (): TableRef[] => selected.flatMap((id) => {
    const b = locked?.has(id) ? undefined : boxOf(id);
    return b ? [tableRef(b.table)] : [];
  });
  const askAt = (el: Element, table: TableRef) => (kind: Ask['kind'], value: string, extra: Partial<Ask> = {}) => {
    setPop(null);
    setAsk({ kind, table, value, at: spotOf(el), ...extra });
  };
  const openMenu = (x: number, y: number, el: Element, box: TableBox, column?: string) => {
    const t = box.table;
    if (locked?.has(box.id)) {
      const items = column ? [] : (tableActions?.(t) ?? []);
      if (!items.length) return;
      setPop(null);
      setMenu({ x, y, label: `Actions for ${box.label}`, items });
      return;
    }
    if (!onEdit) return;
    setPop(null);
    const items = column ? columnMenu(t, column, onEdit, askAt(el, tableRef(t))) : withActions(tableMenu(schema, t, onEdit, askAt(el, tableRef(t)), selection(), onHide && (() => onHide([...new Set([box.id, ...selected])]))), tableActions?.(t) ?? []);
    setMenu({ x, y, label: column ? `Actions for ${box.label}.${column}` : `Actions for ${box.label}`, items });
  };
  /** The menu key, or Shift+F10, opens an element's menu where it is. */
  const menuKey = (e: ReactKeyboardEvent) => e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10');

  /** Drag from a column to another table's column to add a ref between them. */
  const startLink = (box: TableBox, column: string, e: ReactPointerEvent) => {
    if (!onEdit || locked?.has(box.id) || e.button !== 0) return;
    e.stopPropagation();
    const f = frame.current!.getBoundingClientRect();
    const row = box.rows.find((r) => r.column === column)!;
    const from = { x: box.x + box.w, y: row.y + ROW / 2 };
    setPop(null);
    drag(
      e,
      (dx, dy) => {
        const at = toDiagram(viewRef.current, e.clientX + dx - f.left, e.clientY + dy - f.top);
        setLinking({ from, to: at });
      },
      (done) => {
        setLinking(null);
        if (!done) return;
        const pointer = lastPointer.current;
        const target = document.elementFromPoint(pointer.x, pointer.y)?.closest<SVGGElement>('[data-column]');
        const toBox = target ? boxOf(target.dataset.table ?? '') : undefined;
        const toColumn = target?.dataset.column;
        if (!toBox || !toColumn || locked?.has(toBox.id) || (toBox.id === box.id && toColumn === column)) return;
        setRefAsk({ from: { ...tableRef(box.table), column }, to: { ...tableRef(toBox.table), column: toColumn }, at: spotOf(target!) });
      },
    );
  };
  const lastPointer = useRef({ x: 0, y: 0 });
  useEffect(() => {
    const track = (e: PointerEvent) => (lastPointer.current = { x: e.clientX, y: e.clientY });
    window.addEventListener('pointermove', track, true);
    return () => window.removeEventListener('pointermove', track, true);
  }, []);

  const commitAsk = (value: string | null) => {
    const a = ask;
    setAsk(null);
    if (!a || value == null || !onEdit) return;
    const made = answer(a, value);
    if (made) onEdit(made.change, { renamed: made.renamed });
  };

  /** A new table or note, placed in view near the top left, and named so it doesn't clash. */
  const addElement = (kind: 'table' | 'note') => {
    if (!onEdit) return;
    const v = viewRef.current;
    const at = toDiagram(v, 48, (tools.current?.offsetTop ?? 0) + (tools.current?.offsetHeight ?? 0) + 24);
    const place = { x: Math.max(0, Math.round(at.x)), y: Math.max(0, Math.round(at.y)) };
    if (kind === 'table') {
      const name = freeName('new_table', schema.tables.filter((t) => t.schema === 'public').map((t) => t.name));
      onEdit((d) => addTable(d, { schema: 'public', table: name }), { places: { [`table:public.${name}`]: place } });
    } else {
      const name = freeName('note', schema.notes.map((n) => n.name));
      onEdit((d) => addStickyNote(d, name, 'Write the note here, in the DBML.'), { places: { [`note:${name}`]: place } });
    }
  };

  const mark = (c: 'one' | 'many') => (c === 'one' ? '1' : '∞');
  const popTable = pop && diagram.tables.find((t) => t.id === pop.table);
  const popColumn = popTable && pop.column ? popTable.table.columns.find((c) => c.name === pop.column) : undefined;

  const drawTable = (box: TableBox) => {
    const t = box.table;
    const label = box.label;
    // A table drawn from the canvas has no DBML to edit; its menu still opens, with its actions.
    const fixed = !!locked?.has(box.id);
    const edit = fixed ? undefined : onEdit;
    const menus = !!edit || fixed;
    return (
      <g
        key={box.id}
        className={cx('puddle-schema-table', fixed && 'is-derived', box.tone && `tone-${box.tone}`, box.id === current && 'is-current', box.id === found && 'is-found', selected.includes(box.id) && 'is-selected', moving?.[box.id] && 'is-moving', dim(box.id) && 'is-dim')}
        transform={`translate(${box.x},${box.y})`}
        tabIndex={0}
        role="group"
        aria-label={`Table ${label}, ${t.columns.length} columns${selected.includes(box.id) ? ', selected' : ''}. Arrow keys move it, ${fixed ? 'From the canvas: write it in the DBML to edit it.' : 'Enter shows it in the DBML.'}${edit ? ' F2 renames it; the menu key opens its actions.' : fixed ? ' The menu key opens its actions.' : ''}`}
        aria-describedby={pop?.table === box.id ? popId : undefined}
        data-testid={`schema-table-${label}`}
        onPointerDown={(e) => startMove([{ id: box.id, x: box.x, y: box.y }], e)}
        onPointerEnter={() => setHovered(box.id)}
        onPointerLeave={() => {
          setHovered(null);
          setPop(null);
        }}
        onFocus={(e) => e.target === e.currentTarget && showPop(e.currentTarget, box.id)}
        onBlur={() => setPop(null)}
        onKeyDown={(e) => {
          if (edit && e.target === e.currentTarget && e.key === 'F2') {
            e.preventDefault();
            askAt(e.currentTarget, tableRef(t))('rename-table', t.name);
            return;
          }
          if (menus && e.target === e.currentTarget && menuKey(e)) {
            e.preventDefault();
            const r = e.currentTarget.getBoundingClientRect();
            openMenu(r.left + 16, r.top + ROW, e.currentTarget, box);
            return;
          }
          elementKeys(box, () => onPick?.(box.id))(e);
        }}
        onContextMenu={(e) => {
          if (!menus || (e.target as Element).closest('[data-column]')) return;
          e.preventDefault();
          openMenu(e.clientX, e.clientY, e.currentTarget, box);
        }}
        onClick={(e) => {
          if (e.detail > 0 && (e.target as Element).closest('[data-column]')) return;
          // Shift+click adds the table to the selection, or takes it out.
          if (onEdit && e.shiftKey) {
            setSelected((s) => (s.includes(box.id) ? s.filter((x) => x !== box.id) : [...s, box.id]));
            return;
          }
          setSelected([]);
          onPick?.(box.id);
        }}
        onDoubleClick={(e) => {
          if (!edit || (e.target as Element).closest('[data-column]')) return;
          askAt(e.currentTarget, tableRef(t))('rename-table', t.name);
        }}
      >
        <rect className="puddle-schema-table__box" width={box.w} height={box.h} rx={8} />
        <path className="puddle-schema-table__head" d={`M0,8 a8,8 0 0 1 8,-8 h${box.w - 16} a8,8 0 0 1 8,8 v${ROW - 8} h${-box.w} z`} onPointerEnter={(e) => showPop(e.currentTarget, box.id)} />
        {box.tone && <path className="puddle-schema-table__stripe" d={`M0,8 a8,8 0 0 1 8,-8 h${box.w - 16} a8,8 0 0 1 8,8 v-4 h${-box.w} z`} />}
        <text className="puddle-schema-table__name" x={PAD} y={ROW / 2} dominantBaseline="central" pointerEvents="none">
          {label}
        </text>
        {t.note && <StickyNote x={box.w - PAD - 12} y={ROW / 2 - 6} width={12} height={12} strokeWidth={1.8} className="puddle-schema-table__note" aria-hidden pointerEvents="none" />}
        {box.rows.map((row, i) => {
          const c = t.columns.find((x) => x.name === row.column)!;
          const y = row.y - box.y;
          const isRef = refColumns.has(`${t.schema}.${t.name}.${c.name}`);
          const glyph = { x: PAD - 2, y: y + ROW / 2 - 6, width: 12, height: 12, strokeWidth: 1.8, 'aria-hidden': true } as const;
          return (
            <g
              key={c.name}
              data-column={c.name}
              data-table={box.id}
              className={cx('puddle-schema-col', c.pk && 'is-pk', edit && 'is-linkable')}
              data-testid={`schema-col-${label}-${c.name}`}
              onPointerEnter={(e) => !linking && showPop(e.currentTarget, box.id, c.name)}
              onPointerLeave={() => setPop(null)}
              onPointerDown={(e) => startLink(box, c.name, e)}
              onClick={(e) => {
                e.stopPropagation();
                onPick?.(box.id, c.name);
              }}
              onDoubleClick={(e) => {
                if (!edit) return;
                e.stopPropagation();
                askAt(e.currentTarget, tableRef(t))('rename-column', c.name, { column: c.name });
              }}
              onContextMenu={(e) => {
                if (!edit) return;
                e.preventDefault();
                e.stopPropagation();
                openMenu(e.clientX, e.clientY, e.currentTarget, box, c.name);
              }}
            >
              {i > 0 && <line x1={0} x2={box.w} y1={y} y2={y} className="puddle-schema-col__rule" />}
              <rect x={0} y={y} width={box.w} height={ROW} className="puddle-schema-col__hit" />
              {c.pk ? <KeyRound {...glyph} className="puddle-schema-col__glyph is-key" /> : isRef ? <Link2 {...glyph} className="puddle-schema-col__glyph" /> : c.unique ? <Fingerprint {...glyph} className="puddle-schema-col__glyph" /> : null}
              <text x={PAD + GLYPH} y={y + ROW / 2} dominantBaseline="central" className={cx('puddle-schema-col__name', c.notNull && 'is-required')}>
                {columnLabel(c)}
              </text>
              <text x={box.w - PAD} y={y + ROW / 2} dominantBaseline="central" textAnchor="end" className="puddle-schema-col__type" textLength={c.type.length * CHAR > box.w / 2 ? box.w / 2 : undefined}>
                {c.type}
              </text>
            </g>
          );
        })}
      </g>
    );
  };

  return (
    <div ref={frame} className="puddle-schema-canvas">
      <svg
        ref={svg}
        className="puddle-schema-svg"
        data-testid="schema-diagram"
        role="group"
        aria-label="Schema diagram. Arrow keys pan, plus and minus zoom, 0 shows it at 100%, Shift+1 fits it."
        tabIndex={0}
        onPointerDown={startPan}
        onKeyDown={paneKeys}
        data-zoom={Math.round(view.k * 100)}
      >
        <g transform={`translate(${view.x},${view.y}) scale(${view.k})`}>
          {diagram.groups.map((g) => (
            <g key={g.id} className={cx('puddle-schema-group', g.tone && `tone-${g.tone}`)} data-testid={`schema-group-${g.group.name}`}>
              <rect className="puddle-schema-group__frame" x={g.x} y={g.y} width={g.w} height={g.h} rx={12} />
              <g
                className="puddle-schema-group__head"
                tabIndex={0}
                role="group"
                aria-label={`Group ${g.group.name}, ${g.tables.length} ${g.tables.length === 1 ? 'table' : 'tables'}. Drag it, or use the arrow keys, to move them together.`}
                onPointerDown={(e) =>
                  startMove(
                    g.tables.map((id) => {
                      const t = diagram.tables.find((x) => x.id === id)!;
                      return { id, x: t.x, y: t.y };
                    }),
                    e,
                  )
                }
                onKeyDown={(e) => {
                  if (e.target !== e.currentTarget || e.altKey || e.ctrlKey || e.metaKey) return;
                  const step = e.shiftKey ? NUDGE_FAR : NUDGE;
                  const by = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
                  if (!by) return;
                  e.preventDefault();
                  e.stopPropagation();
                  const moves: Record<string, Point> = {};
                  for (const id of g.tables) {
                    const t = diagram.tables.find((x) => x.id === id)!;
                    moves[id] = { x: Math.max(0, t.x + by[0]!), y: Math.max(0, t.y + by[1]!) };
                  }
                  onMove(moves);
                }}
              >
                <rect x={g.x} y={g.y} width={g.w} height={ROW} className="puddle-schema-group__hit" />
                <text x={g.x + PAD} y={g.y + ROW / 2} dominantBaseline="central" className="puddle-schema-group__name">
                  {g.group.name}
                </text>
              </g>
            </g>
          ))}
          {diagram.notes.map((n) => (
            <g
              key={n.id}
              className={cx('puddle-schema-note', n.tone && `tone-${n.tone}`, n.plain && 'is-plain', moving?.[n.id] && 'is-moving')}
              transform={`translate(${n.x},${n.y})`}
              tabIndex={0}
              role="note"
              aria-label={`Note ${n.note.name}: ${n.note.text}`}
              data-testid={`schema-note-${n.note.name}`}
              onPointerDown={(e) => startMove([{ id: n.id, x: n.x, y: n.y }], e)}
              onKeyDown={elementKeys(n)}
            >
              <rect className="puddle-schema-note__box" width={n.w} height={n.h} rx={6} />
              <text className="puddle-schema-note__name" x={PAD} y={ROW / 2 + 2} dominantBaseline="central">
                {n.note.name}
              </text>
              {n.lines.map((line, i) => (
                <text key={i} className="puddle-schema-note__text" x={PAD} y={ROW + LINE * i + LINE / 2} dominantBaseline="central">
                  {line}
                </text>
              ))}
            </g>
          ))}
          <g className="puddle-schema-links">
            {diagram.enumLinks.map((l) => {
              const id = `link:${l.enumBox.id}:${l.table.id}.${l.column}`;
              return <path key={id} d={l.d} className={cx('puddle-schema-link', dim(id) && 'is-dim')} data-testid={`schema-link-${l.enumBox.label}-${l.table.label}.${l.column}`} />;
            })}
          </g>
          <g className="puddle-schema-refs">
            {diagram.refs.map((r) => {
              const isLit = lit?.has(`ref:${r.index}`) ?? false;
              const name = `${endpoint(r.ref.from)} ${r.ref.op} ${endpoint(r.ref.to)}`;
              return (
                <g
                  key={r.index}
                  className={cx('puddle-schema-ref', r.tone && `tone-${r.tone}`, r.ref.inactive && 'is-inactive', isLit && lit && 'is-current', dim(`ref:${r.index}`) && 'is-dim')}
                  data-testid={`schema-ref-${r.from.label}-${r.to.label}`}
                  data-pairs={r.pairs.map((p) => p.join('=')).join(',')}
                >
                  <title>{r.pairs.length > 1 ? `${name}: ${r.pairs.map(([a, b]) => `${a} to ${b}`).join(', ')}` : name}</title>
                  <path d={r.d} className="puddle-schema-ref__hit" />
                  <path d={r.d} className="puddle-schema-ref__line" />
                  {[
                    { at: r.start, end: r.fromEnd, optional: r.ref.fromOptional },
                    { at: r.end, end: r.toEnd, optional: r.ref.toOptional },
                  ].map(({ at, end, optional }, i) => (
                    <g key={i}>
                      <circle cx={at.x + at.side * 3} cy={at.y} r={3} className={cx('puddle-schema-ref__dot', optional && 'is-optional')} data-optional={optional || undefined} />
                      <text x={at.x + at.side * 9} y={at.y - 5} textAnchor={at.side === 1 ? 'start' : 'end'} className="puddle-schema-ref__end">
                        {mark(end)}
                        {r.pairs.length > 1 && i === 0 ? ` (${r.pairs.length})` : ''}
                      </text>
                    </g>
                  ))}
                </g>
              );
            })}
          </g>
          {diagram.enums.map((e) => (
            <g
              key={e.id}
              className={cx('puddle-schema-enum', moving?.[e.id] && 'is-moving', dim(e.id) && 'is-dim')}
              transform={`translate(${e.x},${e.y})`}
              tabIndex={0}
              role="group"
              aria-label={`Enum ${e.label}: ${e.dbmlEnum.values.map((v) => v.name).join(', ')}`}
              data-testid={`schema-enum-${e.label}`}
              onPointerDown={(ev) => startMove([{ id: e.id, x: e.x, y: e.y }], ev)}
              onKeyDown={elementKeys(e)}
            >
              <rect className="puddle-schema-table__box" width={e.w} height={e.h} rx={8} />
              <path className="puddle-schema-enum__head" d={`M0,8 a8,8 0 0 1 8,-8 h${e.w - 16} a8,8 0 0 1 8,8 v${ROW - 8} h${-e.w} z`} />
              <text className="puddle-schema-table__name" x={PAD} y={ROW / 2} dominantBaseline="central">
                {e.label}
              </text>
              <text className="puddle-schema-enum__tag" x={e.w - PAD} y={ROW / 2} dominantBaseline="central" textAnchor="end">
                {ENUM_TAG}
              </text>
              {e.rows.map((row, i) => {
                const y = row.y - e.y;
                return (
                  <g key={row.value}>
                    {i > 0 && <line x1={0} x2={e.w} y1={y} y2={y} className="puddle-schema-col__rule" />}
                    <text x={PAD} y={y + ROW / 2} dominantBaseline="central" className="puddle-schema-col__name">
                      {row.value}
                    </text>
                  </g>
                );
              })}
            </g>
          ))}
          {diagram.tables.map(drawTable)}
          {linking && <path className="puddle-schema-linking" d={`M${linking.from.x},${linking.from.y} L${linking.to.x},${linking.to.y}`} data-testid="schema-linking" />}
        </g>
      </svg>

      <div ref={tools} className="puddle-schema-tools" role="toolbar" aria-label="Diagram">
        <input
          className="ui-input puddle-schema-tools__search"
          type="search"
          placeholder="Find a table"
          aria-label="Find a table"
          data-testid="schema-search"
          list={listId}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            search(e.target.value, true);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              search(query, false);
            } else if (e.key === 'Escape' && query) {
              e.preventDefault();
              setQuery('');
              setFound(null);
            }
          }}
        />
        <datalist id={listId}>
          {diagram.tables.map((t) => (
            <option key={t.id} value={t.label} />
          ))}
        </datalist>
        <Button size="sm" variant="ghost" icon="zoom-out" iconOnly aria-label="Zoom out" title="Zoom out (-)" onClick={() => zoomBy(1 / ZOOM_STEP)} />
        <Button size="sm" variant="ghost" aria-label={`Zoom ${Math.round(view.k * 100)} percent, show at 100%`} title="Show at 100% (0)" onClick={actual} data-testid="schema-zoom">
          {Math.round(view.k * 100)}%
        </Button>
        <Button size="sm" variant="ghost" icon="zoom-in" iconOnly aria-label="Zoom in" title="Zoom in (+)" onClick={() => zoomBy(ZOOM_STEP)} />
        <Button size="sm" variant="ghost" icon="fit" onClick={fit} title="Fit the diagram (Shift+1)">
          Fit
        </Button>
        {onEdit && (
          <>
            <Button size="sm" variant="ghost" icon="plus" onClick={() => addElement('table')} data-testid="schema-add-table">
              Table
            </Button>
            {!only && (
              <Button size="sm" variant="ghost" icon="notes" onClick={() => addElement('note')} data-testid="schema-add-note">
                Note
              </Button>
            )}
          </>
        )}
        {diagram.tables.length > 0 && (
          <Button
            size="sm"
            variant="ghost"
            icon="layout"
            onClick={() => {
              const places = autoArrange(schema, { detail, only });
              onMove(places);
              setView(fitted(layoutDiagram(schema, { ...positions, ...places }, { detail, only }).bounds));
            }}
          >
            Auto-arrange
          </Button>
        )}
      </div>

      {menu && <ContextMenu x={menu.x} y={menu.y} label={menu.label} items={menu.items} onClose={() => setMenu(null)} />}
      {ask && <AskBox key={`${ask.kind}:${ask.table.schema}.${ask.table.table}.${ask.column ?? ''}`} ask={ask} onDone={commitAsk} />}
      {refAsk && onEdit && (
        <RefAsk
          schema={schema}
          from={refAsk.from}
          to={refAsk.to}
          at={refAsk.at}
          onCancel={() => setRefAsk(null)}
          onAdd={(ref) => {
            setRefAsk(null);
            onEdit((d) => addRef(d, ref));
          }}
        />
      )}
      {popTable && !ask && !refAsk && (
        <div className="ui-popover puddle-schema-pop" id={popId} role="tooltip" data-testid="schema-popover" style={{ left: pop.at.left, top: pop.at.top, width: sample && !popColumn ? POP_WIDE : undefined }}>
          {popColumn ? (
            <ColumnDetails schema={schema} table={popTable.table} column={popColumn} />
          ) : (
            <>
              <TableDetails table={popTable.table} />
              {sample?.(popTable.table)}
            </>
          )}
        </div>
      )}
    </div>
  );
}
