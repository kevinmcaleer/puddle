import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { DockedContext } from '../steps/dockContext';
import { useSqlDock, useSqlDocked } from './sqlDockState';

/**
 * The SQL dock: a pane beside the rows, at the bottom of the screen, holding the SQL of the node whose rows are
 * shown, so a query and its answer are read together. The editor still belongs to whoever draws it (a SQL node's
 * inspector, a Query's SQL view): `DockedSql` moves it here while its node is the one viewed and the results are open.
 */

const MIN = 240;
const DEFAULT = 440;

/** The dock's pane, drawn in the results beside the rows: empty, and so hidden, until an editor moves in. */
export function SqlDockPane() {
  const used = useSqlDock((s) => s.owners > 0);
  const [width, setWidth] = useState(DEFAULT);
  const drag = useRef<{ x: number; w: number } | null>(null);
  const clamp = (w: number) => Math.max(MIN, Math.min(w, window.innerWidth * 0.7));
  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, w: width };
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (drag.current) setWidth(clamp(drag.current.w + e.clientX - drag.current.x));
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'ArrowRight') setWidth((w) => clamp(w + 24));
    if (e.key === 'ArrowLeft') setWidth((w) => clamp(w - 24));
  };
  return (
    <>
      <section
        ref={(el) => {
          if (useSqlDock.getState().slot !== el) useSqlDock.setState({ slot: el });
        }}
        aria-label="SQL beside the rows"
        data-testid="sql-dock"
        hidden={!used}
        className={used ? 'flex min-h-0 shrink-0 flex-col gap-1 p-2' : undefined}
        style={{ width }}
      />
      {used && (
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize the SQL editor"
          aria-valuenow={Math.round(width)}
          tabIndex={0}
          className="-mx-1 w-2 shrink-0 cursor-col-resize border-l border-line"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={() => (drag.current = null)}
          onKeyDown={onKeyDown}
        />
      )}
    </>
  );
}

/**
 * A node's SQL editor: beside the rows while that node's rows are the ones shown, where it is drawn otherwise (the
 * results hidden, or pinned to another node). `note` is left in its place while it is in the dock.
 */
export function DockedSql({ nodeId, note, children }: { nodeId: string; note?: ReactNode; children: ReactNode }) {
  const slot = useSqlDock((s) => s.slot);
  const docked = useSqlDocked(nodeId);
  useEffect(() => {
    if (!docked) return;
    useSqlDock.setState((s) => ({ owners: s.owners + 1 }));
    return () => useSqlDock.setState((s) => ({ owners: s.owners - 1 }));
  }, [docked]);
  if (!docked || !slot) return <>{children}</>;
  return (
    <>
      {createPortal(<DockedContext.Provider value={true}>{children}</DockedContext.Provider>, slot)}
      {note}
    </>
  );
}
