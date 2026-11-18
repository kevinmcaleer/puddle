/** The least the results table is given, and its height once the flow has grown. */
export const RESULTS_MIN = 120;
export const RESULTS_DEFAULT = 280;
/** A flow of this many nodes or fewer, all in one row, is small: the data matters more than the drawing of it. */
export const SMALL_FLOW = 3;
/** Nodes this close in height are in one row (a node added after another lands beside it; a second source lands below). */
const ONE_ROW = 40;

/**
 * Whether the flow is small enough to be drawn in a third of the window: a few nodes in a single row, as a source
 * and the steps after it are. Sources stacked one under another, or anything bigger, need the canvas's usual room.
 */
export function isSmallFlow(nodes: { position: { y: number } }[]): boolean {
  if (!nodes.length || nodes.length > SMALL_FLOW) return false;
  const ys = nodes.map((n) => n.position.y);
  return Math.max(...ys) - Math.min(...ys) <= ONE_ROW;
}
/** What the toolbar, the view tabs, the results' own title bar and the status strip take of the window's height. */
const CHROME = 150;
/**
 * The least a small flow's canvas is left: room for a row of nodes and the canvas controls, and for the inspector
 * beside it to show its tabs, the node's name and the first issue without scrolling.
 */
const CANVAS_MIN = 280;
/** The most the results may take, dragged or not, so the canvas never disappears. */
const MAX_SHARE = 0.75;

export const clampResults = (height: number, windowHeight: number) => Math.max(RESULTS_MIN, Math.min(height, windowHeight * MAX_SHARE));

/**
 * How tall the results table is. A divider the user has dragged is kept. Otherwise an empty project (`flow: 'empty'`)
 * shows only its message, a small flow gives the data most of the window (a row of nodes needs little room, and the
 * table is what is being read), and a grown flow shares the window as before.
 */
export function resultsHeight({ flow, dragged, windowHeight }: { flow: 'empty' | 'small' | 'grown'; dragged: number | null; windowHeight: number }): number {
  if (dragged != null) return clampResults(dragged, windowHeight);
  if (flow === 'empty') return RESULTS_MIN;
  if (flow === 'small') {
    // The canvas keeps a third of what the chrome leaves, and the table takes the rest.
    const canvas = Math.max(CANVAS_MIN, Math.round((windowHeight - CHROME) / 3));
    return clampResults(windowHeight - CHROME - canvas, windowHeight);
  }
  return clampResults(RESULTS_DEFAULT, windowHeight);
}
