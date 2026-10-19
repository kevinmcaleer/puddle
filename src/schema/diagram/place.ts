// Where a diagram element with no saved place goes: beside something it is joined to, in the first spot that is free,
// or else on a shelf under everything already drawn. Deterministic, so a table keeps its place from one keystroke to the
// next without anything being saved.
import { GAP, GUTTER, MARGIN, ROW } from './metrics';

export interface Point {
  x: number;
  y: number;
}

export interface Rect extends Point {
  w: number;
  h: number;
}

/** A sized element, before it has a place. */
export interface Sized {
  id: string;
  w: number;
  h: number;
  /** Elements it is joined to, the ones it should sit near. */
  near: string[];
  /** For each of `near`, whether this element goes after it (to its right): a child after its parent. */
  after?: boolean[];
}

/** Whether two boxes come closer than `gap` to each other. */
export const overlaps = (a: Rect, b: Rect, gap = 0) => a.x < b.x + b.w + gap && b.x < a.x + a.w + gap && a.y < b.y + b.h + gap && b.y < a.y + a.h + gap;

/** The shelf's width: wide enough for the widest element, roughly square for the rest. */
const shelfWidth = (items: Sized[], placed: Rect[]) => {
  const area = items.reduce((n, s) => n + (s.w + GUTTER) * (s.h + GUTTER), 0);
  const drawn = placed.length ? Math.max(...placed.map((r) => r.x + r.w)) : 0;
  return Math.max(drawn, Math.sqrt(area) * 1.6, ...items.map((s) => s.w + MARGIN));
};

/** Places for the elements `placed` doesn't have, joined ones next to each other. */
export function placeNew(items: Sized[], placed: Record<string, Point>): Record<string, Point> {
  const size = new Map(items.map((s) => [s.id, s]));
  const boxes = new Map<string, Rect>();
  for (const s of items) if (placed[s.id]) boxes.set(s.id, { ...placed[s.id]!, w: s.w, h: s.h });
  const todo = items.filter((s) => !placed[s.id]);
  if (!todo.length) return {};
  const out: Record<string, Point> = {};
  const free = (r: Rect) => r.x >= 0 && r.y >= 0 && ![...boxes.values()].some((b) => overlaps(r, b, GAP));
  const put = (s: Sized, at: Point) => {
    out[s.id] = at;
    boxes.set(s.id, { ...at, w: s.w, h: s.h });
  };

  const width = shelfWidth(todo, [...boxes.values()]);
  let shelf: Point | undefined;
  const newShelf = () => {
    const bottom = boxes.size ? Math.max(...[...boxes.values()].map((b) => b.y + b.h)) + GUTTER : MARGIN;
    return { x: MARGIN, y: Math.max(MARGIN, bottom) };
  };
  const onShelf = (s: Sized) => {
    shelf ??= newShelf();
    for (;;) {
      if (shelf.x > MARGIN && shelf.x + s.w > MARGIN + width) shelf = newShelf();
      const at = { x: shelf.x, y: shelf.y };
      const hit = [...boxes.values()].find((b) => overlaps({ ...at, w: s.w, h: s.h }, b, GAP));
      if (!hit) {
        put(s, at);
        shelf.x += s.w + GUTTER;
        return;
      }
      // Past whatever is in the way, or onto a new shelf when the row is full.
      shelf.x = Math.max(shelf.x + GAP, hit.x + hit.w + GUTTER);
    }
  };

  /** Beside one of its neighbours, on the side its relation points to first, stepping down until a spot is free. */
  const beside = (s: Sized): boolean => {
    for (let i = 0; i < s.near.length; i++) {
      const n = boxes.get(s.near[i]!);
      if (!n) continue;
      const right = { x: n.x + n.w + GUTTER, y: n.y };
      const left = { x: n.x - GUTTER - s.w, y: n.y };
      const sides = s.after?.[i] === false ? [left, right] : [right, left];
      for (const side of sides)
        for (let k = 0; k < 12; k++) {
          const at = { x: side.x, y: side.y + k * ROW * 2 };
          if (free({ ...at, w: s.w, h: s.h })) {
            put(s, at);
            return true;
          }
        }
      const below = { x: n.x, y: n.y + n.h + GUTTER };
      if (free({ ...below, w: s.w, h: s.h })) {
        put(s, below);
        return true;
      }
    }
    return false;
  };

  const left = new Set(todo.map((s) => s.id));
  while (left.size) {
    // Something joined to what is already drawn goes beside it; failing that, the next in order starts a new spot.
    const next = todo.find((s) => left.has(s.id) && s.near.some((n) => boxes.has(n)));
    if (next && beside(next)) {
      left.delete(next.id);
      continue;
    }
    const first = next ?? todo.find((s) => left.has(s.id))!;
    onShelf(size.get(first.id)!);
    left.delete(first.id);
  }
  return out;
}
