import { useEffect, useLayoutEffect, useRef, useState, type DragEvent, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { create } from 'zustand';
import { useSession } from '../app/session';
import { copyText, saveBlob } from '../export/deliver';
import { nodeById, setSchemaDbml, useProject, useProjectStore, type Project } from '../model';
import { Banner, Button, columnKind, cx, Dialog, Field, Icon, NODE_KIND, Select, TypeTag } from '../ui';
import { intoSchema, toDbml } from './dbml';
import { useRelationships } from './useRelationships';
import { relate } from './relate';
import { cardinality, describeCardinality, keyEnds, type End, type Relationship, type RelTable, type Uniqueness } from './model';
import '../query/query.css';
import './relationships.css';

const apply = (edit: (p: Project) => Project) => useProjectStore.getState().apply(edit);

/** A column dragged from a table, as text so it survives the browser's drag data. */
const COLUMN_MIME = 'application/x-puddle-column';
let dragged: End | null = null;

/** Where tables go before they're moved: a grid, related tables next to each other. */
const SPACING_X = 312;
const SPACING_Y = 320;
const MARGIN = 24;
const NUDGE = 16;
const NUDGE_FAR = 64;

/** Where tables were moved to in this tab, by node; the view lays out the rest itself. */
const useLayout = create<{ at: Record<string, { x: number; y: number }>; move: (nodeId: string, at: { x: number; y: number }) => void }>((set) => ({
  at: {},
  move: (nodeId, at) => set((s) => ({ at: { ...s.at, [nodeId]: at } })),
}));

const endKey = (e: End) => `${e.nodeId}:${e.column}`;

/** What Enter on a column does, from the keyboard: relate it to a column of another table, the same names first. */
function RelateDialog({ tables, from, onClose }: { tables: RelTable[]; from: End; onClose: () => void }) {
  const table = tables.find((t) => t.nodeId === from.nodeId);
  const targets = tables
    .filter((t) => t.nodeId !== from.nodeId)
    .flatMap((t) => (t.columns ?? []).map((c) => ({ value: endKey({ nodeId: t.nodeId, column: c.name }), label: `${t.name}.${c.name}`, same: c.name === from.column, end: { nodeId: t.nodeId, column: c.name } })))
    .sort((a, b) => Number(b.same) - Number(a.same));
  const [target, setTarget] = useState(targets[0]?.value ?? '');
  return (
    <Dialog
      title={`${table?.name}.${from.column}`}
      confirm="Add relationship"
      confirmDisabled={!targets.length}
      onClose={onClose}
      onConfirm={() => {
        const to = targets.find((t) => t.value === target);
        if (to) apply((p) => relate(p, from, to.end));
        onClose();
      }}
    >
      {targets.length ? (
        <Field label="Every value exists in" htmlFor="rel-to" hint="Adds a rule to this table that checks it.">
          <Select id="rel-to" data-autofocus options={targets} value={target} onChange={(e) => setTarget(e.target.value)} />
        </Field>
      ) : (
        <p className="text-ink-muted">There’s no other table with known columns to relate it to.</p>
      )}
    </Dialog>
  );
}

interface Line {
  key: string;
  d: string;
  from: { x: number; y: number; dx: number };
  to: { x: number; y: number; dx: number };
}

/** Each relationship's line, with "1" or "∞" at an end once the keys are checked, and dashed when only a rule states it. */
function RelationshipPane({ tables, relationships, unique, selected, onSelect }: { tables: RelTable[]; relationships: Relationship[]; unique: Uniqueness; selected: string | null; onSelect: (key: string | null) => void }) {
  const pane = useRef<HTMLDivElement>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [tick, setTick] = useState(0);
  const [moving, setMoving] = useState<{ nodeId: string; x: number; y: number } | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [relating, setRelating] = useState<End | null>(null);
  const moved = useLayout((s) => s.at);
  const move = useLayout((s) => s.move);
  const remeasure = () => setTick((t) => t + 1);
  const keys = keyEnds(relationships, unique);

  const perRow = Math.min(4, Math.max(1, Math.ceil(Math.sqrt(tables.length))));
  const placed = tables.map((t, i) => ({ ...t, ...(moved[t.nodeId] ?? { x: MARGIN + (i % perRow) * SPACING_X, y: MARGIN + Math.floor(i / perRow) * SPACING_Y }) }));

  const layout = placed.map((t) => `${t.nodeId}:${t.x},${t.y}:${t.columns?.length ?? -1}`).join('|');
  const ends = relationships.map((r) => r.key).join('|');
  useLayoutEffect(() => {
    const el = pane.current;
    if (!el) return;
    const find = (attr: string, value: string) => el.querySelector<HTMLElement>(`[${attr}="${CSS.escape(value)}"]`) ?? undefined;
    const base = el.getBoundingClientRect();
    const at = (x: number, y: number) => ({ x: x - base.left + el.scrollLeft, y: y - base.top + el.scrollTop });
    const next: Line[] = [];
    for (const r of relationships) {
      const [rf, rt] = [find('data-rel-row', endKey(r.from)), find('data-rel-row', endKey(r.to))];
      const [bf, bt] = [find('data-rel-box', r.from.nodeId), find('data-rel-box', r.to.nodeId)];
      const [lf, lt] = [find('data-rel-list', r.from.nodeId), find('data-rel-list', r.to.nodeId)];
      if (!rf || !rt || !bf || !bt || !lf || !lt) continue;
      // A row scrolled out of its list joins at the list's edge.
      const y = (row: HTMLElement, list: HTMLElement) => {
        const a = row.getBoundingClientRect();
        const l = list.getBoundingClientRect();
        return Math.min(Math.max(a.top + a.height / 2, l.top), l.bottom);
      };
      const [a, b] = [bf.getBoundingClientRect(), bt.getBoundingClientRect()];
      const rightward = a.left + a.width / 2 <= b.left + b.width / 2;
      const stub = rightward ? 16 : -16;
      const from = { ...at(rightward ? a.right : a.left, y(rf, lf)), dx: stub };
      const to = { ...at(rightward ? b.left : b.right, y(rt, lt)), dx: -stub };
      next.push({ key: r.key, from, to, d: `M${from.x},${from.y} h${stub} L${to.x - stub},${to.y} h${stub}` });
    }
    const nextSize = { w: el.scrollWidth, h: el.scrollHeight };
    setLines((prev) => (JSON.stringify(prev) === JSON.stringify(next) ? prev : next));
    setSize((prev) => (prev.w === nextSize.w && prev.h === nextSize.h ? prev : nextSize));
  }, [ends, layout, tick, moving, relationships]);

  useEffect(() => {
    const el = pane.current;
    if (!el) return;
    const ro = new ResizeObserver(remeasure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const startMove = (t: { nodeId: string; x: number; y: number }, e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const start = { px: e.clientX, py: e.clientY, x: t.x, y: t.y };
    const pointer = e.pointerId;
    try {
      e.currentTarget.setPointerCapture(pointer);
    } catch {
      // The window still hears the moves.
    }
    let last = { x: t.x, y: t.y };
    const onMove = (ev: PointerEvent) => {
      if (ev.pointerId !== pointer) return;
      last = { x: Math.max(0, start.x + ev.clientX - start.px), y: Math.max(0, start.y + ev.clientY - start.py) };
      setMoving({ nodeId: t.nodeId, ...last });
    };
    const onEnd = (ev: PointerEvent) => {
      if (ev.pointerId !== pointer) return;
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onEnd);
      window.removeEventListener('pointercancel', onEnd);
      setMoving(null);
      if (ev.type === 'pointerup') move(t.nodeId, last);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onEnd);
    window.addEventListener('pointercancel', onEnd);
  };

  const moveKeys = (t: { nodeId: string; x: number; y: number }) => (e: ReactKeyboardEvent) => {
    const step = e.shiftKey ? NUDGE_FAR : NUDGE;
    const by = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
    if (!by || e.target !== e.currentTarget || e.altKey || e.ctrlKey || e.metaKey) return;
    e.preventDefault();
    move(t.nodeId, { x: Math.max(0, t.x + by[0]!), y: Math.max(0, t.y + by[1]!) });
  };

  const dropOn = (target: End) => (e: DragEvent) => {
    e.preventDefault();
    setOver(null);
    const raw = e.dataTransfer.getData(COLUMN_MIME);
    const from = raw ? (JSON.parse(raw) as End) : dragged;
    if (!from || from.nodeId === target.nodeId) return;
    apply((p) => relate(p, from, target));
  };

  const drawn = lines.flatMap((l) => {
    const r = relationships.find((x) => x.key === l.key);
    return r ? [{ ...l, r, check: r.via.every((v) => v.kind === 'rule' || v.kind === 'schema') }] : [];
  });
  const mark = (c: 'one' | 'many' | undefined) => (c === 'one' ? '1' : c === 'many' ? '∞' : '');

  return (
    <div ref={pane} className="puddle-qd-pane" data-testid="relationship-tables" onScroll={remeasure} onClick={(e) => e.target === e.currentTarget && onSelect(null)}>
      {!tables.length && (
        <div className="puddle-qd-empty">
          <p>Add a source to see its table here.</p>
        </div>
      )}
      {placed.map((t) => {
        const pos = moving?.nodeId === t.nodeId ? moving : t;
        return (
          <div key={t.nodeId} data-rel-box={t.nodeId} className={cx('puddle-qd-table', `puddle-rel-table--${t.kind}`)} style={{ left: pos.x, top: pos.y }} data-testid={`rel-table-${t.name}`} aria-label={`Table ${t.name}`} role="group">
            <div className="puddle-qd-table__head" onPointerDown={(e) => startMove(pos, e)} title="Drag to move, or focus and use the arrow keys" tabIndex={0} role="group" aria-label={`Move ${t.name} with the arrow keys`} onKeyDown={moveKeys(pos)}>
              <Icon name={NODE_KIND[t.kind].icon} />
              <span className="puddle-qd-table__name">{t.name}</span>
              {t.checkedAgainst && (
                <span className="puddle-rel-table__checked" title={`Checked against ${t.checkedAgainst} in the schema`} aria-label={`Checked against ${t.checkedAgainst} in the schema`} role="img" data-testid={`rel-checked-${t.name}`}>
                  <Icon name="tick" size={12} />
                </span>
              )}
            </div>
            <ul data-rel-list={t.nodeId} className="puddle-qd-table__fields" onScroll={remeasure}>
              {t.columns ? (
                t.columns.map((c) => {
                  const end = { nodeId: t.nodeId, column: c.name };
                  const key = endKey(end);
                  const isKey = keys.has(key);
                  return (
                    <li
                      key={key}
                      data-rel-row={key}
                      className={cx('puddle-qd-field', over === key && 'is-over')}
                      draggable
                      data-testid={`rel-field-${t.name}-${c.name}`}
                      title="Drag onto a column of another table to relate them"
                      onDragStart={(e) => {
                        dragged = end;
                        e.dataTransfer.setData(COLUMN_MIME, JSON.stringify(end));
                        e.dataTransfer.effectAllowed = 'link';
                      }}
                      onDragEnd={() => {
                        dragged = null;
                        setOver(null);
                      }}
                      onDragOver={(e) => {
                        if (!e.dataTransfer.types.includes(COLUMN_MIME) || !dragged || dragged.nodeId === t.nodeId) return;
                        e.preventDefault();
                        e.dataTransfer.dropEffect = 'link';
                        setOver(key);
                      }}
                      onDragLeave={() => setOver((o) => (o === key ? null : o))}
                      onDrop={dropOn(end)}
                    >
                      <span
                        role="button"
                        tabIndex={0}
                        aria-haspopup="dialog"
                        className="puddle-qd-field__name"
                        onKeyDown={(e) => {
                          if (e.key !== 'Enter' && e.key !== ' ') return;
                          e.preventDefault();
                          setRelating(end);
                        }}
                        onClick={(e: ReactMouseEvent) => e.detail === 0 && setRelating(end)}
                      >
                        <TypeTag type={columnKind(c.type)} decorative />
                        <span className="ui-col">{c.name}</span>
                        <span className="puddle-rel-type type-metric">{c.type}</span>
                        {isKey && <span className="puddle-rel-key type-metric" title="No value repeats">key</span>}
                      </span>
                    </li>
                  );
                })
              ) : (
                <li className="puddle-qd-field is-muted">Reading columns…</li>
              )}
            </ul>
          </div>
        );
      })}
      {relating && <RelateDialog tables={tables} from={relating} onClose={() => setRelating(null)} />}
      <svg className="puddle-qd-lines" width={size.w} height={size.h} aria-hidden="true">
        {drawn.map((l) => (
          <g key={l.key} data-testid="relationship-line" data-check={l.check || undefined} className={cx(selected === l.key && 'is-selected')}>
            <path d={l.d} className={cx('ui-wire', l.check && 'ui-wire--ref', selected === l.key && 'ui-wire--active')} />
            <path
              d={l.d}
              className="puddle-qd-hit"
              onClick={(ev) => {
                ev.stopPropagation();
                onSelect(l.key);
              }}
            >
              <title>{`${l.r.from.column} = ${l.r.to.column} (${l.r.via.map((v) => v.label).join(', ')})`}</title>
            </path>
            <text x={l.from.x + l.from.dx / 2} y={l.from.y - 4} className="puddle-rel-mark type-metric" textAnchor="middle">
              {mark(cardinality(unique, l.r, 'from'))}
            </text>
            <text x={l.to.x + l.to.dx / 2} y={l.to.y - 4} className="puddle-rel-mark type-metric" textAnchor="middle">
              {mark(cardinality(unique, l.r, 'to'))}
            </text>
          </g>
        ))}
      </svg>
    </div>
  );
}

const VIA_ICON = { join: 'join', lookup: 'join', query: 'query', rule: 'check', schema: 'schema' } as const;

/** Open the node that states a relationship: a Query in its designer, anything else selected in the inspector. */
function openVia(project: Project, nodeId: string) {
  const node = nodeById(project, nodeId);
  if (!node) return;
  if (node.type === 'query') return useSession.getState().openDesigner(nodeId);
  useSession.getState().select(nodeId);
}

/** The relationships as a list: which columns, one or many on each side, and where each is stated. */
function RelationshipList({ project, tables, relationships, unique, selected, onSelect }: { project: Project; tables: RelTable[]; relationships: Relationship[]; unique: Uniqueness; selected: string | null; onSelect: (key: string | null) => void }) {
  const name = (id: string) => tables.find((t) => t.nodeId === id)?.name ?? id;
  if (!relationships.length)
    return (
      <div className="puddle-rel-list" data-testid="relationship-list">
        <p className="px-3 py-2 text-ink-muted">No relationships yet. Join tables with a Join or Lookup node or a Query’s join lines, or drag a column here onto the matching column of another table.</p>
      </div>
    );
  return (
    <div className="puddle-rel-list" data-testid="relationship-list">
      <table>
        <thead>
          <tr>
            <th scope="col">Column</th>
            <th scope="col">Related to</th>
            <th scope="col">Rows</th>
            <th scope="col">Stated by</th>
          </tr>
        </thead>
        <tbody>
          {relationships.map((r) => (
            <tr key={r.key} data-testid="relationship" className={cx(selected === r.key && 'is-selected')} onClick={() => onSelect(r.key)}>
              <td className="ui-col">{`${name(r.from.nodeId)}.${r.from.column}`}</td>
              <td className="ui-col">{`${name(r.to.nodeId)}.${r.to.column}`}</td>
              <td data-testid="relationship-cardinality">{describeCardinality(unique, r) ?? 'Checking…'}</td>
              <td>
                <span className="flex flex-wrap gap-1">
                  {r.via.map((v) => (
                    <Button key={`${v.nodeId}:${v.ruleId ?? ''}`} size="sm" variant="ghost" icon={VIA_ICON[v.kind]} onClick={() => openVia(project, v.nodeId)}>
                      {v.kind === 'rule' ? `${nodeById(project, v.nodeId)?.name}: ${v.label}` : v.label}
                    </Button>
                  ))}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * The relationships view, in place of the canvas while it's open, as in Access's Relationships window: every table
 * of the project with its columns, and lines between the columns that the project matches, with "1" or "∞" at each
 * end once Puddle has checked whether the column repeats. It can be written out as DBML.
 */
export function Relationships() {
  const project = useProject();
  const { tables, relationships, unique } = useRelationships(project);
  const [selected, setSelected] = useState<string | null>(null);
  const [message, setMessage] = useState<{ tone: 'info' | 'fail'; text: string } | null>(null);
  const dbml = () => toDbml(project, tables, relationships, unique);
  const [asking, setAsking] = useState(false);
  /** The tables written into the project's schema, one undo step, and the Schema view opened on them. */
  const openInSchema = (mode: 'append' | 'replace') => {
    const text = dbml();
    setAsking(false);
    useProjectStore.getState().apply((p) => setSchemaDbml(p, intoSchema(p.schema.dbml, text, mode)));
    useSession.getState().setSchemaOpen(true);
  };
  const view = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (document.activeElement === document.body) view.current?.focus();
  }, []);

  return (
    <div ref={view} tabIndex={-1} role="region" className="puddle-qd puddle-rel" data-testid="relationships" aria-label="Relationships">
      <div className="puddle-qd-bar">
        <Button variant="ghost" size="sm" icon="arrow-left" onClick={() => useSession.getState().setRelationshipsOpen(false)}>
          Back to canvas
        </Button>
        <Icon name="relationships" />
        <span className="text-body-strong text-ink">Relationships</span>
        <span className="flex-1" />
        <Button
          variant="ghost"
          size="sm"
          icon="paste"
          onClick={() =>
            void copyText(dbml()).then(
              () => setMessage({ tone: 'info', text: 'Copied the tables and relationships as DBML.' }),
              (e: Error) => setMessage({ tone: 'fail', text: e.message }),
            )
          }
        >
          Copy DBML
        </Button>
        <Button variant="ghost" size="sm" icon="schema" onClick={() => (project.schema.dbml.trim() ? setAsking(true) : openInSchema('replace'))} data-testid="open-in-schema">
          Open in Schema
        </Button>
        <Button variant="secondary" size="sm" icon="export" onClick={() => saveBlob(new Blob([dbml()], { type: 'text/plain' }), `${project.name || 'project'}.dbml`)}>
          Download DBML
        </Button>
      </div>
      {asking && (
        <div className="puddle-qd-notes" data-testid="open-in-schema-ask">
          <Banner
            tone="info"
            title="The schema already has DBML"
            action={
              <>
                <Button variant="secondary" size="sm" onClick={() => openInSchema('append')}>
                  Add to it
                </Button>
                <Button variant="ghost" size="sm" onClick={() => openInSchema('replace')}>
                  Replace it
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setAsking(false)}>
                  Cancel
                </Button>
              </>
            }
          >
            Add these tables and relationships after what is written there, or replace it with them.
          </Banner>
        </div>
      )}
      {message && (
        <div className="puddle-qd-notes" data-testid="relationships-message">
          <Banner tone={message.tone} action={<Button variant="ghost" size="sm" onClick={() => setMessage(null)}>Dismiss</Button>}>
            {message.text}
          </Banner>
        </div>
      )}
      <RelationshipPane tables={tables} relationships={relationships} unique={unique} selected={selected} onSelect={setSelected} />
      <RelationshipList project={project} tables={tables} relationships={relationships} unique={unique} selected={selected} onSelect={setSelected} />
    </div>
  );
}
