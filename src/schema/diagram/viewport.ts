// The diagram's pan and zoom: a translation and a scale, and the sums that keep a point still while zooming, fit the
// whole drawing in the pane, or centre one table. Pure, so it is tested without a browser.
import type { Rect } from './place';

export interface View {
  /** Where the diagram's origin is drawn, in pane pixels. */
  x: number;
  y: number;
  /** The scale: 1 is 100%. */
  k: number;
}

export const MIN_ZOOM = 0.2;
export const MAX_ZOOM = 2;
export const START: View = { x: 0, y: 0, k: 1 };

export const clampZoom = (k: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, k));

/** Zoom to `k` keeping the diagram point under the pane point (px, py) where it is. */
export function zoomAt(view: View, k: number, px: number, py: number): View {
  const next = clampZoom(k);
  const f = next / view.k;
  return { x: px - (px - view.x) * f, y: py - (py - view.y) * f, k: next };
}

/** The whole of `bounds` in a pane of the given size, centred, at no more than 100%. */
export function fitView(bounds: Rect, width: number, height: number): View {
  if (bounds.w <= 0 || bounds.h <= 0 || width <= 0 || height <= 0) return START;
  const k = clampZoom(Math.min(1, width / bounds.w, height / bounds.h));
  return { x: (width - bounds.w * k) / 2 - bounds.x * k, y: (height - bounds.h * k) / 2 - bounds.y * k, k };
}

/** The same zoom, with `rect` in the middle of the pane. */
export function centreOn(view: View, rect: Rect, width: number, height: number): View {
  return { x: width / 2 - (rect.x + rect.w / 2) * view.k, y: height / 2 - (rect.y + rect.h / 2) * view.k, k: view.k };
}

/** A pane point in diagram coordinates. */
export const toDiagram = (view: View, px: number, py: number) => ({ x: (px - view.x) / view.k, y: (py - view.y) / view.k });
