/** The least the results table is given, and its height once the flow has grown. */
export const RESULTS_MIN = 120;
export const RESULTS_DEFAULT = 280;
/** A flow of this many nodes or fewer is small: the data matters more than the drawing of it. */
export const SMALL_FLOW = 3;
/** What the toolbar, the view tabs, the results' own title bar and the status strip take of the window's height. */
const CHROME = 150;
/** The least a small flow's canvas is left: room for a row of nodes and the canvas controls. */
const CANVAS_MIN = 220;
/** The most the results may take, dragged or not, so the canvas never disappears. */
const MAX_SHARE = 0.75;

export const clampResults = (height: number, windowHeight: number) => Math.max(RESULTS_MIN, Math.min(height, windowHeight * MAX_SHARE));

/**
 * How tall the results table is. A divider the user has dragged is kept. Otherwise an empty project shows only its
 * message, a small flow gives the data most of the window (one node on the canvas needs little room, and the table is
 * what is being read), and a grown flow shares the window as before.
 */
export function resultsHeight({ nodes, dragged, windowHeight }: { nodes: number; dragged: number | null; windowHeight: number }): number {
  if (dragged != null) return clampResults(dragged, windowHeight);
  if (nodes === 0) return RESULTS_MIN;
  if (nodes <= SMALL_FLOW) {
    // The canvas keeps a third of what the chrome leaves, and the table takes the rest.
    const canvas = Math.max(CANVAS_MIN, Math.round((windowHeight - CHROME) / 3));
    return clampResults(windowHeight - CHROME - canvas, windowHeight);
  }
  return clampResults(RESULTS_DEFAULT, windowHeight);
}
