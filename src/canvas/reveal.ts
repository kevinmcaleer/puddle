/** Keeping the selected node on screen: a node added below the others, or reached with an arrow key, scrolls into view. */

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}
export interface Viewport {
  x: number;
  y: number;
  zoom: number;
}

/**
 * The viewport that shows `node` (in flow coordinates) whole, with `margin` screen pixels round it, moving as little as
 * possible and keeping the zoom; null when it is already in view. A node bigger than the canvas lines up its top left.
 */
export function panToShow(node: Box, viewport: Viewport, size: { width: number; height: number }, margin = 24): Viewport | null {
  const axis = (start: number, length: number, offset: number, room: number) => {
    const left = start * viewport.zoom + offset;
    const right = left + length * viewport.zoom;
    if (left >= margin && right <= room - margin) return offset;
    if (right - left > room - 2 * margin || left < margin) return offset + margin - left;
    return offset - (right - (room - margin));
  };
  const x = axis(node.x, node.width, viewport.x, size.width);
  const y = axis(node.y, node.height, viewport.y, size.height);
  return x === viewport.x && y === viewport.y ? null : { x, y, zoom: viewport.zoom };
}

interface Flow {
  getInternalNode(id: string): { internals: { positionAbsolute: { x: number; y: number } }; measured: { width?: number; height?: number } } | undefined;
  getViewport(): Viewport;
  setViewport(viewport: Viewport): unknown;
}

/** Once the node is drawn and measured, pan the canvas so it's in view. Returns a cancel for the effect. */
export function revealNodeWhenDrawn(
  id: string,
  flow: Flow,
  container: () => HTMLElement | null,
  frames: { request: (fn: () => void) => number; cancel: (handle: number) => void } = { request: (fn) => requestAnimationFrame(fn), cancel: (h) => cancelAnimationFrame(h) },
): () => void {
  let frame = 0;
  let tries = 0;
  const reveal = () => {
    const node = flow.getInternalNode(id);
    const el = container();
    const { width, height } = node?.measured ?? {};
    if (!node || !el || !width || !height || !el.clientWidth || !el.clientHeight) {
      if (tries++ < 60) frame = frames.request(reveal);
      return;
    }
    const next = panToShow({ ...node.internals.positionAbsolute, width, height }, flow.getViewport(), { width: el.clientWidth, height: el.clientHeight });
    if (next) flow.setViewport(next);
  };
  reveal();
  return () => frames.cancel(frame);
}

/** Whether every node is whole on screen at this viewport. */
export const allInView = (nodes: Box[], viewport: Viewport, size: { width: number; height: number }, margin = 24) =>
  nodes.every((n) => panToShow(n, viewport, size, margin) === null);

const same = (a: Viewport, b: Viewport) => a.x === b.x && a.y === b.y && a.zoom === b.zoom;

/**
 * Whether to fit a project's nodes to the canvas: only while its viewport is untouched (the default a sample or a
 * new project opens at, or the fit this made, as the nodes finish drawing and grow) and something is off screen. A
 * viewport the person set is theirs and stays.
 */
export function shouldFit(viewport: Viewport, lastFit: Viewport | null, nodes: Box[], size: { width: number; height: number }): boolean {
  const untouched = same(viewport, { x: 0, y: 0, zoom: 1 }) || (lastFit !== null && same(viewport, lastFit));
  return untouched && nodes.length > 0 && size.width > 0 && size.height > 0 && !allInView(nodes, viewport, size);
}
