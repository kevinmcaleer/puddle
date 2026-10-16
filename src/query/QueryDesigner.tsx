import { useEffect, useLayoutEffect, useRef, useState, type DragEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { useSession } from '../app/session';
import { cardKind } from '../canvas/kind';
import { CRITERIA_OPS, crossJoinedTables } from '../compiler';
import { useFlowStore } from '../flow/status';
import {
  addQueryField,
  addQueryJoin,
  addQueryTable,
  moveQueryField,
  moveQueryTable,
  removeQueryField,
  removeQueryJoin,
  removeQueryTable,
  setQuerySpec,
  updateQueryField,
  useProject,
  useProjectStore,
  type Project,
  type QueryCriteriaOp,
  type QueryField,
  type QueryFieldRef,
  type QueryNode,
} from '../model';
import { CommitInput } from '../steps/CommitInput';
import { Banner, Button, columnKind, cx, Icon, Menu, NODE_KIND, Select, Switch, TypeTag } from '../ui';
import { designerTables, refKey, tableCandidates, useDesigner, type DesignerTable } from './tables';
import './query.css';

const apply = (edit: (p: Project) => Project) => useProjectStore.getState().apply(edit);

/** A field dragged from a table, as text so it survives the browser's drag data. */
const FIELD_MIME = 'application/x-puddle-field';
/** A grid column being moved to another place. */
const GRID_MIME = 'application/x-puddle-grid';

// Drag data can't be read until the drop, so the dragged field is kept here too, for deciding where it may land.
let dragged: QueryFieldRef | null = null;

const SORTS = [
  { value: 'none', label: 'Not sorted' },
  { value: 'asc', label: 'Ascending' },
  { value: 'desc', label: 'Descending' },
];

const OPS = [{ value: '', label: 'No criteria' }, ...Object.entries(CRITERIA_OPS).map(([value, o]) => ({ value, label: o.label }))];

interface Line {
  id: string;
  d: string;
  /** Ends of the line, for the markers that show which end keeps every row. */
  from: { x: number; y: number };
  to: { x: number; y: number };
}

/** The tables, with their fields to drag and the join lines between them. */
function TablePane({ node, tables }: { node: QueryNode; tables: DesignerTable[] }) {
  const pane = useRef<HTMLDivElement>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [tick, setTick] = useState(0);
  const [moving, setMoving] = useState<{ port: number; x: number; y: number } | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const selectedJoin = useDesigner((s) => s.selectedJoinId);
  const selectJoin = useDesigner((s) => s.selectJoin);
  const remeasure = () => setTick((t) => t + 1);

  // Lines follow the rows they join, so they're measured again whenever a table, a list or the pane moves.
  const layout = tables.map((t) => `${t.port}:${t.x},${t.y}:${t.columns?.length ?? -1}`).join('|');
  useLayoutEffect(() => {
    const el = pane.current;
    if (!el) return;
    const find = (attr: string, value: string | number) => el.querySelector<HTMLElement>(`[${attr}="${CSS.escape(String(value))}"]`) ?? undefined;
    const base = el.getBoundingClientRect();
    const at = (x: number, y: number) => ({ x: x - base.left + el.scrollLeft, y: y - base.top + el.scrollTop });
    const next: Line[] = [];
    for (const j of node.querySpec.joins) {
      const [rl, rr] = [find('data-row', refKey(j.left)), find('data-row', refKey(j.right))];
      const [bl, br] = [find('data-box', j.left.port), find('data-box', j.right.port)];
      const [ll, lr] = [find('data-list', j.left.port), find('data-list', j.right.port)];
      if (!rl || !rr || !bl || !br || !ll || !lr) continue;
      // A row scrolled out of its list joins at the list's edge.
      const y = (row: HTMLElement, list: HTMLElement) => {
        const r = row.getBoundingClientRect();
        const l = list.getBoundingClientRect();
        return Math.min(Math.max(r.top + r.height / 2, l.top), l.bottom);
      };
      const [a, b] = [bl.getBoundingClientRect(), br.getBoundingClientRect()];
      const rightward = a.left + a.width / 2 <= b.left + b.width / 2;
      const from = at(rightward ? a.right : a.left, y(rl, ll));
      const to = at(rightward ? b.left : b.right, y(rr, lr));
      const stub = rightward ? 12 : -12;
      next.push({ id: j.id, from, to, d: `M${from.x},${from.y} h${stub} L${to.x - stub},${to.y} h${stub}` });
    }
    const nextSize = { w: el.scrollWidth, h: el.scrollHeight };
    setLines((prev) => (JSON.stringify(prev) === JSON.stringify(next) ? prev : next));
    setSize((prev) => (prev.w === nextSize.w && prev.h === nextSize.h ? prev : nextSize));
  }, [node.querySpec.joins, layout, tick, moving]);

  useEffect(() => {
    const el = pane.current;
    if (!el) return;
    const ro = new ResizeObserver(remeasure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Delete removes the selected join line.
  useEffect(() => {
    if (!selectedJoin) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return;
      if (e.key !== 'Delete' && e.key !== 'Backspace') return;
      e.preventDefault();
      apply((p) => removeQueryJoin(p, node.id, selectedJoin));
      selectJoin(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectedJoin, node.id, selectJoin]);

  const startMove = (t: DesignerTable, e: ReactPointerEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest('button') || e.button !== 0) return;
    const start = { px: e.clientX, py: e.clientY, x: t.x, y: t.y };
    const header = e.currentTarget;
    header.setPointerCapture(e.pointerId);
    let last = { x: t.x, y: t.y };
    const onMove = (ev: PointerEvent) => {
      last = { x: Math.max(0, start.x + ev.clientX - start.px), y: Math.max(0, start.y + ev.clientY - start.py) };
      setMoving({ port: t.port, ...last });
    };
    const onUp = () => {
      header.removeEventListener('pointermove', onMove);
      header.removeEventListener('pointerup', onUp);
      setMoving(null);
      // One undo step per move, when the table is let go.
      if (last.x !== t.x || last.y !== t.y) apply((p) => moveQueryTable(p, node.id, t.port, last));
    };
    header.addEventListener('pointermove', onMove);
    header.addEventListener('pointerup', onUp);
  };

  const dropOnRow = (target: QueryFieldRef) => (e: DragEvent) => {
    e.preventDefault();
    setOver(null);
    const raw = e.dataTransfer.getData(FIELD_MIME);
    const from = raw ? (JSON.parse(raw) as QueryFieldRef) : dragged;
    if (!from || from.port === target.port || from.column === '*') return;
    apply((p) => addQueryJoin(p, node.id, from, target));
  };

  // Lines are measured after rendering, so a line just removed can still be in them for one render.
  const drawn = lines.flatMap((l) => {
    const j = node.querySpec.joins.find((x) => x.id === l.id);
    return j ? [{ ...l, keepsLeft: j.kind === 'left' || j.kind === 'full', keepsRight: j.kind === 'right' || j.kind === 'full' }] : [];
  });

  return (
    <div ref={pane} className="puddle-qd-pane" data-testid="query-tables" onScroll={remeasure} onClick={(e) => e.target === e.currentTarget && selectJoin(null)}>
      {!tables.length && (
        <div className="puddle-qd-empty">
          <p>Add a table with Add table, or wire a node into this query on the canvas.</p>
        </div>
      )}
      {tables.map((t) => {
        const pos = moving?.port === t.port ? moving : t;
        return (
          <div
            key={t.port}
            data-box={t.port}
            className="puddle-qd-table"
            style={{ left: pos.x, top: pos.y }}
            data-testid={`query-table-${t.port + 1}`}
            aria-label={`Table ${t.label}`}
            role="group"
          >
            <div className="puddle-qd-table__head" onPointerDown={(e) => startMove(t, e)} title="Drag to move">
              <span className="ui-metric">{t.port + 1}</span>
              <span className="puddle-qd-table__name">{t.label}</span>
              <Button variant="ghost" size="sm" icon="cross" iconOnly aria-label={`Remove ${t.label} from the query`} onClick={() => apply((p) => removeQueryTable(p, node.id, t.port))} />
            </div>
            <ul data-list={t.port} className="puddle-qd-table__fields" onScroll={remeasure}>
              {t.columns ? (
                [{ name: '*', type: '' }, ...t.columns].map((c) => {
                  const ref = { port: t.port, column: c.name };
                  const key = refKey(ref);
                  return (
                    <li
                      key={key}
                      data-row={key}
                      className={cx('puddle-qd-field', over === key && 'is-over')}
                      draggable
                      data-testid={`query-field-${t.port + 1}-${c.name}`}
                      title={c.name === '*' ? 'Every column. Drag into the grid, or double-click.' : 'Drag into the grid (or double-click), or onto a field of another table to join on it.'}
                      onDoubleClick={() => apply((p) => addQueryField(p, node.id, ref))}
                      onDragStart={(e) => {
                        dragged = ref;
                        e.dataTransfer.setData(FIELD_MIME, JSON.stringify(ref));
                        e.dataTransfer.effectAllowed = 'copyLink';
                      }}
                      onDragEnd={() => {
                        dragged = null;
                        setOver(null);
                      }}
                      onDragOver={(e) => {
                        if (c.name === '*' || !e.dataTransfer.types.includes(FIELD_MIME) || !dragged || dragged.port === t.port || dragged.column === '*') return;
                        e.preventDefault();
                        e.dataTransfer.dropEffect = 'link';
                        setOver(key);
                      }}
                      onDragLeave={() => setOver((o) => (o === key ? null : o))}
                      onDrop={c.name === '*' ? undefined : dropOnRow(ref)}
                    >
                      {c.name === '*' ? <span className="puddle-qd-field__all">*</span> : <TypeTag type={columnKind(c.type)} />}
                      <span className="ui-col">{c.name === '*' ? 'All columns' : c.name}</span>
                    </li>
                  );
                })
              ) : (
                <li className="puddle-qd-field is-muted">{t.problem ?? 'Reading columns…'}</li>
              )}
            </ul>
          </div>
        );
      })}
      <svg className="puddle-qd-lines" width={size.w} height={size.h} aria-hidden="true">
        {drawn.map((l) => (
          <g key={l.id} data-testid="query-join-line" data-join={l.id} className={cx(selectedJoin === l.id && 'is-selected')}>
            <path d={l.d} className={selectedJoin === l.id ? 'ui-wire ui-wire--active' : 'ui-wire'} />
            <path
              d={l.d}
              className="puddle-qd-hit"
              onClick={(ev) => {
                ev.stopPropagation();
                selectJoin(l.id);
                useSession.getState().select(node.id);
              }}
            />
            {/* A filled end keeps every row of its table. */}
            <circle cx={l.from.x} cy={l.from.y} r={3} className={l.keepsLeft ? 'puddle-qd-end is-all' : 'puddle-qd-end'} />
            <circle cx={l.to.x} cy={l.to.y} r={3} className={l.keepsRight ? 'puddle-qd-end is-all' : 'puddle-qd-end'} />
          </g>
        ))}
      </svg>
    </div>
  );
}

/** Where a drop lands in the grid: before field `index` (the end when it equals the field count). */
function useGridDrop(node: QueryNode) {
  const [over, setOver] = useState<number | null>(null);
  const props = (index: number) => ({
    onDragOver: (e: DragEvent) => {
      if (!e.dataTransfer.types.includes(FIELD_MIME) && !e.dataTransfer.types.includes(GRID_MIME)) return;
      e.preventDefault();
      setOver(index);
    },
    onDragLeave: () => setOver((o) => (o === index ? null : o)),
    onDrop: (e: DragEvent) => {
      e.preventDefault();
      setOver(null);
      const moved = e.dataTransfer.getData(GRID_MIME);
      if (moved) {
        const from = node.querySpec.fields.findIndex((f) => f.id === moved);
        if (from >= 0) apply((p) => moveQueryField(p, node.id, moved, from < index ? index - 1 : index));
        return;
      }
      const raw = e.dataTransfer.getData(FIELD_MIME);
      const ref = raw ? (JSON.parse(raw) as QueryFieldRef) : dragged;
      if (ref) apply((p) => addQueryField(p, node.id, ref, index));
    },
  });
  return { over, props };
}

/** The query grid, as in Access: a column per field, with its table, name, sort, whether it shows, and criteria. */
function QueryGrid({ node, tables }: { node: QueryNode; tables: DesignerTable[] }) {
  const { fields } = node.querySpec;
  const { over, props } = useGridDrop(node);
  const label = (f: QueryField) => (f.column === '*' ? `${tables.find((t) => t.port === f.port)?.label ?? `input ${f.port + 1}`}.*` : f.column);
  const update = (f: QueryField, patch: Partial<QueryField>) => apply((p) => updateQueryField(p, node.id, f.id, patch));
  const cell = (i: number, extra?: string) => ({ className: cx('puddle-qd-cell', over === i && 'is-over', extra), ...props(i) });
  const ROWS = ['Field', 'Table', 'Name', 'Sort', 'Show', 'Criteria'] as const;

  const content = (row: (typeof ROWS)[number], f: QueryField) => {
    const all = f.column === '*';
    const name = label(f);
    switch (row) {
      case 'Field':
        return (
          <div
            className="puddle-qd-colhead"
            draggable
            onDragStart={(e) => {
              e.dataTransfer.setData(GRID_MIME, f.id);
              e.dataTransfer.effectAllowed = 'move';
            }}
          >
            <Icon name="grip" size={14} className="puddle-qd-grip" />
            <span className="ui-col">{all ? '*' : f.column}</span>
            <Button variant="ghost" size="sm" icon="cross" iconOnly aria-label={`Remove ${name} from the grid`} onClick={() => apply((p) => removeQueryField(p, node.id, f.id))} />
          </div>
        );
      case 'Table':
        return <span className="puddle-qd-tablename">{tables.find((t) => t.port === f.port)?.label ?? `Input ${f.port + 1} (no table)`}</span>;
      case 'Name':
        return all ? <span className="text-ink-subtle">Their own names</span> : <CommitInput key={f.alias ?? ''} mono value={f.alias ?? ''} placeholder={f.column} aria-label={`Name for ${name}`} onCommit={(v) => update(f, { alias: v.trim() || undefined })} />;
      case 'Sort':
        return all ? null : <Select aria-label={`Sort ${name}`} options={SORTS} value={f.sort} onChange={(e) => update(f, { sort: e.target.value as QueryField['sort'] })} />;
      case 'Show':
        return <Switch aria-label={`Show ${name}`} checked={f.show} onChange={(show) => update(f, { show })} />;
      case 'Criteria':
        if (all) return null;
        return (
          <div className="flex flex-col gap-1">
            <Select
              aria-label={`Criteria for ${name}`}
              options={OPS}
              value={f.criteria?.op ?? ''}
              onChange={(e) => update(f, { criteria: e.target.value ? { op: e.target.value as QueryCriteriaOp, value: f.criteria?.value ?? '' } : undefined })}
            />
            {f.criteria && CRITERIA_OPS[f.criteria.op].needsValue && (
              <CommitInput key={f.criteria.value} mono value={f.criteria.value} aria-label={`Criteria value for ${name}`} onCommit={(value) => update(f, { criteria: { op: f.criteria!.op, value } })} />
            )}
          </div>
        );
    }
  };

  return (
    <div className="puddle-qd-grid" data-testid="query-grid">
      <table>
        <tbody>
          {ROWS.map((row) => (
            <tr key={row}>
              <th scope="row" className="ui-eyebrow">{row}</th>
              {fields.map((f, i) => (
                <td key={f.id} {...cell(i)} data-testid={row === 'Field' ? `grid-field-${i + 1}` : undefined}>
                  {content(row, f)}
                </td>
              ))}
              <td {...cell(fields.length, 'is-spare')} data-testid={row === 'Field' ? 'grid-drop' : undefined}>
                {row === 'Field' && <span className="text-ink-subtle">{fields.length ? 'Drag another field here' : 'Drag fields here'}</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * The query designer, in place of the canvas while it's open: the Query's tables up top, joined by lines drawn from
 * one table's field to another's, and the grid of fields below. The results table shows the query's rows as it's built.
 */
export function QueryDesigner({ node }: { node: QueryNode }) {
  const project = useProject();
  const statuses = useFlowStore((s) => s.nodes);
  const tables = designerTables(project, node, statuses);
  const [error, setError] = useState<string | null>(null);
  const cross = crossJoinedTables(node.querySpec, tables.map((t) => t.port));
  const candidates = tableCandidates(project, node.id);
  const selectJoin = useDesigner((s) => s.selectJoin);

  // The node's rows show below while it's being designed.
  useEffect(() => {
    useProjectStore.getState().setView({ viewedNodeId: node.id, viewedStepIndex: undefined });
    return () => selectJoin(null);
  }, [node.id, selectJoin]);

  return (
    <div className="puddle-qd" data-testid="query-designer" aria-label={`Query designer for ${node.name}`}>
      <div className="puddle-qd-bar">
        <Button variant="ghost" size="sm" icon="arrow-left" onClick={() => useSession.getState().openDesigner(null)}>
          Back to canvas
        </Button>
        <Icon name="query" />
        <span className="text-body-strong text-ink" data-testid="query-designer-title">{node.name}</span>
        <span className="flex-1" />
        <Switch id="query-distinct" label="Unique values" checked={node.querySpec.distinct} onChange={(distinct) => apply((p) => setQuerySpec(p, node.id, { distinct }))} />
        <Menu
          label="Add table"
          button={{ size: 'sm', icon: 'plus', variant: 'primary', disabled: !candidates.length }}
          items={candidates.map((n) => ({
            label: n.name,
            icon: NODE_KIND[cardKind(n.type)].icon,
            hint: tables.some((t) => t.fromId === n.id) ? 'Again' : undefined,
            onSelect: () => {
              try {
                apply((p) => addQueryTable(p, node.id, n.id));
                setError(null);
              } catch (e) {
                setError(e instanceof Error ? e.message : String(e));
              }
            },
          }))}
        />
      </div>
      {(error || cross.length > 0) && (
        <div className="puddle-qd-notes">
          {error && (
            <Banner tone="warn" action={<Button variant="ghost" size="sm" onClick={() => setError(null)}>Dismiss</Button>}>
              {error}
            </Banner>
          )}
          {cross.length > 0 && (
            <div data-testid="query-cross-join">
              <Banner tone="info">
                {cross.map((p) => tables.find((t) => t.port === p)!.label).join(', ')} {cross.length === 1 ? 'has' : 'have'} no join line, so every row pairs with every row. Drag a field onto the matching field of another table to join them.
              </Banner>
            </div>
          )}
        </div>
      )}
      <TablePane node={node} tables={tables} />
      <QueryGrid node={node} tables={tables} />
    </div>
  );
}

