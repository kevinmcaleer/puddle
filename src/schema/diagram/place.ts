// Where a diagram element with no saved place goes: beside something it is joined to, in the first spot that is free,
// or else on a shelf under everything already drawn. Deterministic, so a table keeps its place from one keystroke to the
// next without anything being saved.
import { GAP, GUTTER, MARGIN, PAD, ROW } from './metrics';

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

/** The frame drawn around boxes: padded, with a header row on top for the group's name. */
export function frameOf(boxes: Rect[]): Rect | undefined {
  if (!boxes.length) return undefined;
  const x = Math.min(...boxes.map((r) => r.x));
  const y = Math.min(...boxes.map((r) => r.y));
  const w = Math.max(...boxes.map((r) => r.x + r.w)) - x;
  const h = Math.max(...boxes.map((r) => r.y + r.h)) - y;
  return { x: x - PAD, y: y - PAD - ROW, w: w + PAD * 2, h: h + PAD * 2 + ROW };
}

/**
 * Places for the elements `placed` doesn't have, as `placeNew`, with each group's frame kept clear of the others. A
 * group none of whose members has a place yet is laid out on its own and then placed as one block, frame and all, so
 * its members don't mix with another group's; a group whose members all have places keeps anything new out of its
 * frame. `groups` lists each group's members, each element in one group at most.
 */
export function placeGrouped(items: Sized[], placed: Record<string, Point>, groups: string[][]): Record<string, Point> {
  const size = new Map(items.map((s) => [s.id, s]));
  const blockOf = new Map<string, string>();
  const blocks: { id: string; members: Sized[]; local: Record<string, Point>; frame: Rect }[] = [];
  const obstacles: Sized[] = [];
  const fixed: Record<string, Point> = { ...placed };
  groups.forEach((ids, i) => {
    const members = ids.map((id) => size.get(id)).filter((s) => s != null);
    if (!members.length) return;
    if (members.every((m) => placed[m.id])) {
      const frame = frameOf(members.map((m) => ({ ...placed[m.id]!, w: m.w, h: m.h })))!;
      const id = `frame:${i}`;
      obstacles.push({ id, w: frame.w, h: frame.h, near: [] });
      fixed[id] = { x: frame.x, y: frame.y };
      return;
    }
    if (members.some((m) => placed[m.id])) return;
    const inside = new Set(ids);
    const local = placeNew(
      members.map((m) => {
        const keep = m.near.map((_, k) => k).filter((k) => inside.has(m.near[k]!));
        return { ...m, near: keep.map((k) => m.near[k]!), after: m.after && keep.map((k) => m.after![k]!) };
      }),
      {},
    );
    const id = `block:${i}`;
    blocks.push({ id, members, local, frame: frameOf(members.map((m) => ({ ...local[m.id]!, w: m.w, h: m.h })))! });
    for (const m of members) blockOf.set(m.id, id);
  });
  if (!blocks.length && !obstacles.length) return placeNew(items, placed);

  // Everything outside a block, then each block as one element joined to what its members are joined to.
  const outerNear = (s: Sized, self?: string) => {
    const near: string[] = [];
    const after: boolean[] = [];
    s.near.forEach((n, k) => {
      const to = blockOf.get(n) ?? n;
      if (to === self || near.includes(to)) return;
      near.push(to);
      after.push(s.after?.[k] ?? true);
    });
    return { near, after };
  };
  const outer: Sized[] = [
    ...obstacles,
    ...items.filter((s) => !blockOf.has(s.id)).map((s) => ({ ...s, ...outerNear(s) })),
    ...blocks.map((b) => {
      const joined = b.members.map((m) => outerNear(m, b.id));
      return { id: b.id, w: b.frame.w, h: b.frame.h, near: joined.flatMap((j) => j.near), after: joined.flatMap((j) => j.after) };
    }),
  ];
  const at = placeNew(outer, fixed);
  const out: Record<string, Point> = {};
  for (const s of items) if (!blockOf.has(s.id) && at[s.id]) out[s.id] = at[s.id]!;
  for (const b of blocks) {
    const to = at[b.id]!;
    for (const m of b.members) out[m.id] = { x: to.x + b.local[m.id]!.x - b.frame.x, y: to.y + b.local[m.id]!.y - b.frame.y };
  }
  return out;
}
