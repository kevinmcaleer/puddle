import { KeyRound, Link2 } from 'lucide-react';
import { useMemo, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { cx } from '../../ui';
import type { DbmlSchema } from '../model';
import { CHAR, GLYPH, layoutDiagram, PAD, ROW, type DetailLevel, type Point, type TableBox } from './geometry';

const NUDGE = 16;
const NUDGE_FAR = 64;

export interface SchemaDiagramProps {
  schema: DbmlSchema;
  positions: Record<string, Point>;
  detail?: DetailLevel;
  /** The table the editor's caret is in, by diagram id. */
  current?: string | null;
  /** A table was moved (dragged, or nudged with the arrow keys). */
  onMove: (moves: Record<string, Point>) => void;
  /** A table, or one of its columns, was clicked or chosen with Enter. */
  onPick?: (tableId: string, column?: string) => void;
}

/** A column's marks: a key for a primary key, a link for a column a ref starts or ends at. */
function useRefColumns(schema: DbmlSchema) {
  return useMemo(() => {
    const set = new Set<string>();
    for (const r of schema.refs) for (const e of [r.from, r.to]) for (const c of e.columns) set.add(`${e.schema}.${e.table}.${c}`);
    return set;
  }, [schema]);
}

/** The schema drawn: each table with its columns, and a line for each ref with 1 or ∞ at each end. */
export function SchemaDiagram({ schema, positions, detail = 'full', current, onMove, onPick }: SchemaDiagramProps) {
  const [moving, setMoving] = useState<{ id: string } & Point>();
  const shown = useMemo(() => (moving ? { ...positions, [moving.id]: { x: moving.x, y: moving.y } } : positions), [positions, moving]);
  const diagram = useMemo(() => layoutDiagram(schema, shown, { detail }), [schema, shown, detail]);
  const refColumns = useRefColumns(schema);

  const startMove = (box: TableBox, e: ReactPointerEvent<SVGGElement>) => {
    if (e.button !== 0) return;
    const start = { px: e.clientX, py: e.clientY, x: box.x, y: box.y };
    const pointer = e.pointerId;
    let last: Point = { x: box.x, y: box.y };
    let moved = false;
    const onPointerMove = (ev: PointerEvent) => {
      if (ev.pointerId !== pointer) return;
      const dx = ev.clientX - start.px;
      const dy = ev.clientY - start.py;
      if (!moved && Math.hypot(dx, dy) < 3) return;
      moved = true;
      last = { x: Math.max(0, Math.round(start.x + dx)), y: Math.max(0, Math.round(start.y + dy)) };
      setMoving({ id: box.id, ...last });
    };
    const onEnd = (ev: PointerEvent) => {
      if (ev.pointerId !== pointer) return;
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onEnd);
      window.removeEventListener('pointercancel', onEnd);
      setMoving(undefined);
      if (moved && ev.type === 'pointerup') onMove({ [box.id]: last });
    };
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onEnd);
    window.addEventListener('pointercancel', onEnd);
  };

  const keys = (box: TableBox) => (e: ReactKeyboardEvent<SVGGElement>) => {
    if (e.target !== e.currentTarget) return;
    if (e.key === 'Enter') {
      e.preventDefault();
      onPick?.(box.id);
      return;
    }
    const step = e.shiftKey ? NUDGE_FAR : NUDGE;
    const by = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
    if (!by || e.altKey || e.ctrlKey || e.metaKey) return;
    e.preventDefault();
    onMove({ [box.id]: { x: Math.max(0, box.x + by[0]!), y: Math.max(0, box.y + by[1]!) } });
  };

  const mark = (c: 'one' | 'many') => (c === 'one' ? '1' : '∞');

  return (
    <svg className="puddle-schema-svg" width={diagram.width} height={diagram.height} data-testid="schema-diagram" role="group" aria-label="Schema diagram">
      <g className="puddle-schema-refs">
        {diagram.refs.map((r) => (
          <g key={r.index} className={cx('puddle-schema-ref', (r.from.id === current || r.to.id === current) && 'is-current')} data-testid={`schema-ref-${r.from.table.name}-${r.to.table.name}`}>
            <path d={r.d} className="puddle-schema-ref__line" />
            <text x={r.start.x + r.start.side * 6} y={r.start.y - 5} textAnchor={r.start.side === 1 ? 'start' : 'end'} className="puddle-schema-ref__end">
              {mark(r.fromEnd)}
            </text>
            <text x={r.end.x + r.end.side * 6} y={r.end.y - 5} textAnchor={r.end.side === 1 ? 'start' : 'end'} className="puddle-schema-ref__end">
              {mark(r.toEnd)}
            </text>
          </g>
        ))}
      </g>
      {diagram.tables.map((box) => {
        const t = box.table;
        const label = t.schema === 'public' ? t.name : `${t.schema}.${t.name}`;
        return (
          <g
            key={box.id}
            className={cx('puddle-schema-table', box.id === current && 'is-current', moving?.id === box.id && 'is-moving')}
            transform={`translate(${box.x},${box.y})`}
            tabIndex={0}
            role="group"
            aria-label={`Table ${label}, ${t.columns.length} columns. Arrow keys move it, Enter shows it in the DBML.`}
            data-testid={`schema-table-${label}`}
            onPointerDown={(e) => startMove(box, e)}
            onKeyDown={keys(box)}
            onClick={(e) => {
              if (e.detail > 0 && (e.target as Element).closest('[data-column]')) return;
              onPick?.(box.id);
            }}
          >
            <rect className="puddle-schema-table__box" width={box.w} height={box.h} rx={8} />
            <path className="puddle-schema-table__head" d={`M0,8 a8,8 0 0 1 8,-8 h${box.w - 16} a8,8 0 0 1 8,8 v${ROW - 8} h${-box.w} z`} />
            <text className="puddle-schema-table__name" x={PAD} y={ROW / 2} dominantBaseline="central">
              {label}
            </text>
            {box.rows.map((row, i) => {
              const c = t.columns.find((x) => x.name === row.column)!;
              const y = row.y - box.y;
              const isRef = refColumns.has(`${t.schema}.${t.name}.${c.name}`);
              const tag = [c.pk && 'primary key', c.unique && 'unique', c.notNull && 'not null', isRef && 'in a ref'].filter(Boolean).join(', ');
              return (
                <g
                  key={c.name}
                  data-column={c.name}
                  className={cx('puddle-schema-col', c.pk && 'is-pk')}
                  data-testid={`schema-col-${label}-${c.name}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    onPick?.(box.id, c.name);
                  }}
                >
                  {i > 0 && <line x1={0} x2={box.w} y1={y} y2={y} className="puddle-schema-col__rule" />}
                  <rect x={0} y={y} width={box.w} height={ROW} className="puddle-schema-col__hit" />
                  {c.pk ? <KeyRound x={PAD - 2} y={y + ROW / 2 - 6} width={12} height={12} strokeWidth={1.8} className="puddle-schema-col__glyph is-key" aria-hidden /> : isRef ? <Link2 x={PAD - 2} y={y + ROW / 2 - 6} width={12} height={12} strokeWidth={1.8} className="puddle-schema-col__glyph" aria-hidden /> : null}
                  <text x={PAD + GLYPH} y={y + ROW / 2} dominantBaseline="central" className={cx('puddle-schema-col__name', c.notNull && 'is-required')}>
                    {c.name}
                    {tag && <title>{`${c.name} ${c.type}: ${tag}`}</title>}
                  </text>
                  <text x={box.w - PAD} y={y + ROW / 2} dominantBaseline="central" textAnchor="end" className="puddle-schema-col__type" textLength={c.type.length * CHAR > box.w / 2 ? box.w / 2 : undefined}>
                    {c.type}
                  </text>
                </g>
              );
            })}
          </g>
        );
      })}
    </svg>
  );
}
