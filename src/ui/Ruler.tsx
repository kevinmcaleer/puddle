import { useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { cx } from './cx';

/**
 * The first lines of a fixed-width file in the mono font with a boundary marker where each column starts, as
 * Excel's import wizard and Power Query show them. Click between two characters to add a boundary, drag a marker
 * to move it, click a marker (or press Delete on it) to remove it; the arrow keys move a focused marker by one.
 * Offsets are character positions from the start of the line.
 */
export function Ruler({
  lines,
  boundaries,
  onAdd,
  onMove,
  onRemove,
  label = 'Column boundaries',
}: {
  lines: string[];
  boundaries: number[];
  onAdd: (at: number) => void;
  onMove: (from: number, to: number) => void;
  onRemove: (at: number) => void;
  label?: string;
}) {
  const linesEl = useRef<HTMLDivElement>(null);
  const probe = useRef<HTMLSpanElement>(null);
  const [ch, setCh] = useState(7.2);
  const [drag, setDrag] = useState<{ from: number; to: number; moved: boolean } | null>(null);
  useLayoutEffect(() => {
    const width = probe.current?.getBoundingClientRect().width ?? 0;
    if (width > 0) setCh(width / 10);
  }, [lines]);
  const width = Math.max(1, ...lines.map((l) => l.length));
  const scale = Array.from({ length: Math.ceil(width / 10) + 1 }, (_, i) => i * 10);

  /** The character offset under a pointer, clamped to the lines' width. The lines move with the body's scrolling. */
  const offsetAt = (e: PointerEvent | MouseEvent) => {
    const el = linesEl.current;
    if (!el) return 0;
    return Math.min(width, Math.max(1, Math.round((e.clientX - el.getBoundingClientRect().left) / ch)));
  };

  const startDrag = (e: PointerEvent<HTMLButtonElement>, from: number) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    setDrag({ from, to: from, moved: false });
  };
  const moveDrag = (e: PointerEvent<HTMLButtonElement>) => {
    if (!drag) return;
    const to = offsetAt(e);
    if (to !== drag.to || !drag.moved) setDrag({ ...drag, to, moved: drag.moved || to !== drag.from });
  };
  const endDrag = (e: PointerEvent<HTMLButtonElement>) => {
    if (!drag) return;
    e.currentTarget.releasePointerCapture(e.pointerId);
    const { from, to, moved } = drag;
    setDrag(null);
    if (!moved) onRemove(from);
    else if (to !== from && !boundaries.includes(to)) onMove(from, to);
  };
  const keyed = (e: KeyboardEvent<HTMLButtonElement>, at: number) => {
    if (e.key === 'ArrowLeft' && at > 1) onMove(at, at - 1);
    else if (e.key === 'ArrowRight' && at < width) onMove(at, at + 1);
    else if (e.key === 'Delete' || e.key === 'Backspace') onRemove(at);
    else return;
    // Keep the canvas from also deleting the selected node on Delete.
    e.preventDefault();
    e.stopPropagation();
  };

  const shown = drag ? boundaries.map((b) => (b === drag.from ? drag.to : b)) : boundaries;
  return (
    <div className="ui-ruler" role="group" aria-label={label} data-testid="ruler" data-boundaries={boundaries.join(',')}>
      <div className="ui-ruler__body">
        <span className="ui-ruler__probe" ref={probe} aria-hidden="true">
          0000000000
        </span>
        <div className="ui-ruler__scale" aria-hidden="true" style={{ width: `${width}ch` }}>
          {scale.map((n) => (
            <span key={n} className="ui-ruler__tick" style={{ left: `${n}ch` }}>
              {n}
            </span>
          ))}
        </div>
        <div
          className="ui-ruler__lines"
          data-testid="ruler-lines"
          ref={linesEl}
          style={{ width: `${width}ch` }}
          onClick={(e) => {
            if (drag) return;
            const at = offsetAt(e as unknown as MouseEvent);
            if (at > 0 && at < width && !boundaries.includes(at)) onAdd(at);
          }}
        >
          {lines.map((l, i) => (
            <div key={i} className="ui-ruler__line">
              {l || ' '}
            </div>
          ))}
          {boundaries.map((b, i) => (
            <button
              key={b}
              type="button"
              className={cx('ui-ruler__mark', drag?.from === b && 'is-dragging')}
              style={{ left: `${shown[i]}ch` }}
              aria-label={`Boundary at ${b}`}
              data-testid={`boundary-${b}`}
              onPointerDown={(e) => startDrag(e, b)}
              onPointerMove={moveDrag}
              onPointerUp={endDrag}
              onPointerCancel={() => setDrag(null)}
              onClick={(e) => e.stopPropagation()}
              onKeyDown={(e) => keyed(e, b)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
