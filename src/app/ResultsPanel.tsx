import { useCallback, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';
import { Button } from '../ui';
import { useSession } from './session';
import { withShortcut } from './shortcuts';

const MIN = 120;
const DEFAULT = 280;

/** The results table dock: resizable from its top edge (drag or arrow keys) and collapsible (R). */
export function ResultsPanel({ bar, children }: { bar: ReactNode; children: ReactNode }) {
  const [height, setHeight] = useState(DEFAULT);
  const collapsed = !useSession((s) => s.resultsOpen);
  const setCollapsed = (c: boolean) => useSession.getState().setResultsOpen(!c);
  const drag = useRef<{ y: number; h: number } | null>(null);

  const clamp = useCallback((h: number) => Math.max(MIN, Math.min(h, window.innerHeight * 0.75)), []);

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { y: e.clientY, h: height };
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (drag.current) setHeight(clamp(drag.current.h + drag.current.y - e.clientY));
  };
  const onPointerUp = () => {
    drag.current = null;
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'ArrowUp') setHeight((h) => clamp(h + 24));
    if (e.key === 'ArrowDown') setHeight((h) => clamp(h - 24));
  };

  return (
    <section className="flex flex-col border-t border-line bg-surface-panel" aria-label="Results" data-testid="results-panel" data-collapsed={collapsed}>
      {!collapsed && (
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
      <div className="flex items-center border-b border-line [&_.ui-resultsbar]:border-b-0">
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
        <div className="min-h-0 overflow-hidden" style={{ height }}>
          {children}
        </div>
      )}
    </section>
  );
}
