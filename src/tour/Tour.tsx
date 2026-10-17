import { useEffect, useId, useRef, useState, type RefObject } from 'react';
import { useSession } from '../app/session';
import { useProject, useProjectStore, type Project } from '../model';
import { Button } from '../ui';
import { findAnchor, placePopover, TOUR_STOPS, type Rect, type Side, type TourContext, type TourStop } from './stops';
import { endTour, goToStop, useTour } from './tour';

/** The gap between the popover and what it points at, from the spacing tokens. */
function gap() {
  const v = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--space-2'));
  return Number.isFinite(v) ? v : 8;
}

/** The project and selection as they are now, read outside render (the layout loop, a stop beginning). */
const current = (): TourContext => ({ project: useProjectStore.getState().history.present, selectedColumns: useSession.getState().selectedColumns });

interface Layout {
  target: Rect | null;
  top: number;
  left: number;
  side: Side;
}

const sameLayout = (a: Layout | null, b: Layout) =>
  !!a && a.top === b.top && a.left === b.left && a.side === b.side && (a.target === b.target || (!!a.target && !!b.target && a.target.top === b.target.top && a.target.left === b.target.left && a.target.width === b.target.width && a.target.height === b.target.height));

/** Get the screen ready for a stop: the results showing, or the inspector showing a node with steps. */
function prepare(stop: TourStop, project: Project) {
  const session = useSession.getState();
  if (stop.prepare === 'results') session.setResultsOpen(true);
  if (stop.prepare === 'inspector') {
    session.setInspectorOpen(true);
    const selected = project.nodes.find((n) => n.id === session.selectedNodeId);
    const viewed = project.nodes.find((n) => n.id === project.view.viewedNodeId);
    const transform = project.nodes.find((n) => n.type === 'transform' && n.steps.length > 0);
    const pick = stop.id === 'steps' ? (selected?.type === 'transform' ? selected : (transform ?? viewed)) : (selected ?? viewed);
    if (pick && pick.id !== session.selectedNodeId) session.select(pick.id);
    else session.setNotesOpen(false);
  }
}

/** Follows the target as the layout changes: panels opening, the canvas panning, the window resizing. */
function useLayout(stop: TourStop | undefined, pop: RefObject<HTMLElement | null>) {
  const [layout, setLayout] = useState<Layout | null>(null);
  useEffect(() => {
    if (!stop) return;
    const g = gap();
    let frame = 0;
    let shown: Element | null = null;
    const tick = () => {
      const el = findAnchor(stop.anchors(current()));
      // A section further down the inspector is scrolled into view once, when it appears.
      if (el && el !== shown && stop.prepare === 'inspector') el.scrollIntoView({ block: 'nearest' });
      shown = el ?? shown;
      const r = el?.getBoundingClientRect();
      const target = r && r.width > 0 && r.height > 0 ? { top: r.top, left: r.left, width: r.width, height: r.height } : null;
      const size = { width: pop.current?.offsetWidth ?? 0, height: pop.current?.offsetHeight ?? 0 };
      const next = { target, ...placePopover(target, size, { width: window.innerWidth, height: window.innerHeight }, g) };
      setLayout((prev) => (sameLayout(prev, next) ? prev : next));
      frame = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(frame);
  }, [stop, pop]);
  return layout;
}

/**
 * The guided tour: one popover at a time, in the style of the schema popover, pointing at a part of the screen with
 * Next, Back and Skip. It's not modal, so the user can do what a stop suggests; stops with an action move on by
 * themselves once it's done. Escape ends it.
 */
export function Tour() {
  const project = useProject();
  const projectId = useTour((s) => s.projectId);
  const index = useTour((s) => s.stop);
  const selectedColumns = useSession((s) => s.selectedColumns);
  const running = projectId != null && projectId === project.id;
  const stop = running ? TOUR_STOPS[index] : undefined;
  const last = index === TOUR_STOPS.length - 1;
  const pop = useRef<HTMLDivElement>(null);
  const id = useId();

  const layout = useLayout(stop, pop);

  // Another project opened: the tour was about the one it started on.
  useEffect(() => {
    if (projectId != null && projectId !== project.id) endTour();
  }, [projectId, project.id]);

  // Each stop: ready the screen, note how things were, and move focus to the popover so it's read out.
  const start = useRef<{ stop: TourStop; ctx: TourContext } | null>(null);
  useEffect(() => {
    if (!stop) {
      start.current = null;
      return;
    }
    const ctx = current();
    prepare(stop, ctx.project);
    start.current = { stop, ctx };
    pop.current?.focus({ preventScroll: true });
  }, [stop]);

  // An action done moves the tour on.
  useEffect(() => {
    const s = start.current;
    if (!stop?.done || !s || s.stop !== stop || last) return;
    if (stop.done({ project, selectedColumns }, s.ctx)) goToStop(index + 1);
  }, [stop, project, selectedColumns, index, last]);

  useEffect(() => {
    if (!running) return;
    const onKey = (e: KeyboardEvent) => {
      // Escape closes an open menu or dialog first; only with none open does it end the tour.
      if (e.key !== 'Escape' || e.defaultPrevented || document.querySelector('dialog[open], [role="menu"]')) return;
      endTour();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [running]);

  return (
    <>
      <div className="sr-only" aria-live="polite" data-testid="tour-announcer">
        {stop ? `Tour, stop ${index + 1} of ${TOUR_STOPS.length}: ${stop.title}` : ''}
      </div>
      {stop && (
        <>
          {layout?.target && (
            <div
              aria-hidden="true"
              className="pointer-events-none fixed z-popover rounded-md ring-2 ring-accent-ring"
              data-testid="tour-highlight"
              style={{ top: layout.target.top, left: layout.target.left, width: layout.target.width, height: layout.target.height }}
            />
          )}
          <div
            ref={pop}
            role="dialog"
            aria-modal="false"
            aria-labelledby={`${id}-title`}
            aria-describedby={`${id}-body`}
            tabIndex={-1}
            className="ui-popover fixed z-popover w-[var(--size-inspector)] focus-visible:outline-none"
            data-testid="tour"
            data-stop={stop.id}
            data-side={layout?.side}
            style={{ top: layout?.top ?? 0, left: layout?.left ?? 0, opacity: layout ? undefined : 0 }}
          >
            <div className="ui-popover__head">
              <span className="ui-eyebrow">Tour</span>
              <span className="ui-metric">{index + 1} of {TOUR_STOPS.length}</span>
            </div>
            <div className="flex flex-col gap-2 px-3 py-2">
              <h2 id={`${id}-title`} className="text-body-strong text-ink">{stop.title}</h2>
              <p id={`${id}-body`} className="text-body text-ink-muted">{stop.body}</p>
              {stop.action && <p className="text-label text-accent-ink" data-testid="tour-action">{stop.action}</p>}
            </div>
            <div className="ui-popover__foot flex items-center gap-2">
              {!last && <Button variant="ghost" size="sm" onClick={endTour}>Skip</Button>}
              <span className="flex-1" />
              <Button variant="secondary" size="sm" disabled={index === 0} onClick={() => goToStop(index - 1)}>Back</Button>
              <Button variant="primary" size="sm" onClick={() => (last ? endTour() : goToStop(index + 1))}>{last ? 'Finish' : 'Next'}</Button>
            </div>
          </div>
        </>
      )}
    </>
  );
}
