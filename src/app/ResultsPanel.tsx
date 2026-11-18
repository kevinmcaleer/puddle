import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';
import { Button } from '../ui';
import { useSession } from './session';
import { withShortcut } from './shortcuts';
import { clampResults, resultsHeight } from './resultsHeight';

/** The window's height, kept up to date as it is resized. */
function useWindowHeight() {
  const [h, setH] = useState(() => window.innerHeight);
  useEffect(() => {
    const on = () => setH(window.innerHeight);
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);
  return h;
}

/**
 * The results table dock: resizable from its top edge (drag or arrow keys) and collapsible (R). Until the divider is
 * dragged its height follows the flow (see resultsHeight): only its message on an empty project, most of the window
 * while the flow is small, and a fixed share once it has grown.
 */
export function ResultsPanel({ bar, flow, children }: { bar: ReactNode; flow: 'empty' | 'small' | 'grown'; children: ReactNode }) {
  const [dragged, setDragged] = useState<number | null>(null);
  const windowHeight = useWindowHeight();
  const height = resultsHeight({ flow, dragged, windowHeight });
  const short = flow === 'empty' && dragged == null;
  const collapsed = !useSession((s) => s.resultsOpen);
  const setCollapsed = (c: boolean) => useSession.getState().setResultsOpen(!c);
  const drag = useRef<{ y: number; h: number } | null>(null);

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { y: e.clientY, h: height };
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (drag.current) setDragged(clampResults(drag.current.h + drag.current.y - e.clientY, windowHeight));
  };
  const onPointerUp = () => {
    drag.current = null;
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'ArrowUp') setDragged(clampResults(height + 24, windowHeight));
    if (e.key === 'ArrowDown') setDragged(clampResults(height - 24, windowHeight));
  };

  return (
    <section className="flex flex-col border-t border-line bg-surface-panel" aria-label="Results" data-testid="results-panel" data-collapsed={collapsed}>
      {!collapsed && !short && (
        <div
          role="separator"
          aria-orientation="horizontal"
          aria-label="Resize results"
          aria-valuenow={Math.round(height)}
          tabIndex={0}
          className="-mt-1 h-2 cursor-row-resize"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onKeyDown={onKeyDown}
        />
      )}
      <div className="flex items-center border-b border-line has-[.is-pinned]:bg-accent-tint [&_.ui-resultsbar]:border-b-0">
        <div className="min-w-0 flex-1">{bar}</div>
        <Button
          variant="ghost"
          size="sm"
          iconOnly
          icon={collapsed ? 'panel-open' : 'panel-close'}
          aria-label={collapsed ? 'Show results' : 'Hide results'}
          aria-expanded={!collapsed}
          title={withShortcut(collapsed ? 'Show results' : 'Hide results', 'toggle-results')}
          className="mr-3"
          onClick={() => setCollapsed(!collapsed)}
        />
      </div>
      {!collapsed && (
        <div className="min-h-0 overflow-hidden" style={{ height }} data-short={short}>
          {children}
        </div>
      )}
    </section>
  );
}
