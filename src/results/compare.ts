// Comparing two results side by side: which columns only one side has, and scrolling the two grids together.

export type Pane = 'main' | 'compare';

/**
 * The engine cancels a queued read when a newer one with the same key arrives. Each pane has its own keys, so the
 * two grids reading at once don't cancel each other; a pane's newer read still cancels its own older one.
 */
export const supersedeKey = (pane: Pane, kind: 'preview' | 'profile') => (pane === 'main' ? kind : `${kind}:${pane}`);

/** The columns of `mine` that `theirs` doesn't have; none until the other side's columns are known. */
export function onlyHere(mine: string[], theirs: string[] | undefined): Set<string> {
  if (!theirs) return new Set();
  const other = new Set(theirs);
  return new Set(mine.filter((c) => !other.has(c)));
}

/** Where a grid is scrolled to: its first visible row, and the column at its left edge. */
export interface ScrollSpot {
  row: number;
  column?: string;
}

/** Tells each grid where the other one was scrolled. */
export class ScrollSync {
  private readonly subs = new Map<Pane, (spot: ScrollSpot) => void>();

  on(pane: Pane, fn: (spot: ScrollSpot) => void) {
    this.subs.set(pane, fn);
    return () => {
      if (this.subs.get(pane) === fn) this.subs.delete(pane);
    };
  }

  publish(from: Pane, spot: ScrollSpot) {
    for (const [pane, fn] of this.subs) if (pane !== from) fn(spot);
  }
}

/** Where to scroll a grid to follow the other: the same row, and the same column when this side has it. */
export function follow(spot: ScrollSpot, columns: string[], currentColumn: number): { col: number; row: number; horizontal: boolean } {
  const col = spot.column == null ? -1 : columns.indexOf(spot.column);
  return col >= 0 ? { col, row: spot.row, horizontal: true } : { col: currentColumn, row: spot.row, horizontal: false };
}
