// Auto-arrange: the whole diagram laid out again, layered left to right along its refs (a parent before its children,
// an enum before the tables that use it), each group's tables kept together, sticky notes on a row underneath.
import dagre from '@dagrejs/dagre';
import type { DbmlSchema } from '../model';
import { frameAround, groupId, sizeElements, tableId, type DiagramOptions } from './geometry';
import { GUTTER, MARGIN, PAD, ROW } from './metrics';
import type { Point } from './place';

export function autoArrange(schema: DbmlSchema, options: DiagramOptions = {}): Record<string, Point> {
  const { tables, enums, notes, sized } = sizeElements(schema, options);
  const g = new dagre.graphlib.Graph({ compound: true, multigraph: false });
  // Room between ranks for the ref lines and their 1 and ∞ ends, and between neighbours for a group's frame.
  g.setGraph({ rankdir: 'LR', nodesep: GUTTER / 2 + ROW, ranksep: GUTTER, marginx: MARGIN + PAD, marginy: MARGIN + PAD + ROW });
  g.setDefaultEdgeLabel(() => ({}));
  const placed = [...tables, ...enums];
  for (const s of placed) g.setNode(s.id, { width: s.w, height: s.h });

  const shown = new Set(tables.map((t) => t.id));
  const grouped = new Set<string>();
  for (const group of schema.groups) {
    const ids = group.tables.map(tableId).filter((id) => shown.has(id) && !grouped.has(id));
    if (!ids.length) continue;
    const gid = groupId(group);
    // Padding inside the cluster, with the frame's header on top.
    g.setNode(gid, { paddingLeft: PAD, paddingRight: PAD, paddingTop: PAD + ROW, paddingBottom: PAD });
    for (const id of ids) {
      grouped.add(id);
      g.setParent(id, gid);
    }
  }

  for (const s of sized)
    s.near.forEach((other, i) => {
      // Each pair once, from the element that comes first (`after` false on the child's side) to the other.
      if (s.after?.[i] === false && g.hasNode(other) && !g.hasEdge(s.id, other) && !g.hasEdge(other, s.id)) g.setEdge(s.id, other);
    });
  dagre.layout(g);

  const out: Record<string, Point> = {};
  for (const s of placed) {
    const n = g.node(s.id);
    out[s.id] = { x: Math.round(n.x - s.w / 2), y: Math.round(n.y - s.h / 2) };
  }
  // Clusters can push a frame's header above the top; shift everything down and right so nothing is cut off.
  const frames = schema.groups.map((group) => frameAround(group.tables.map(tableId).filter((id) => out[id]).map((id) => ({ ...out[id]!, w: sized.find((s) => s.id === id)!.w, h: sized.find((s) => s.id === id)!.h }))));
  const rects = [...placed.map((s) => ({ ...out[s.id]!, w: s.w, h: s.h })), ...frames.filter((f) => f != null)];
  const dx = rects.length ? MARGIN - Math.min(...rects.map((r) => r.x)) : 0;
  const dy = rects.length ? MARGIN - Math.min(...rects.map((r) => r.y)) : 0;
  for (const id of Object.keys(out)) out[id] = { x: out[id]!.x + dx, y: out[id]!.y + dy };

  let x = MARGIN;
  const bottom = rects.length ? Math.max(...rects.map((r) => r.y + r.h)) + dy + GUTTER : MARGIN;
  for (const n of notes) {
    out[n.id] = { x, y: bottom };
    x += n.w + GUTTER / 2;
  }
  return out;
}
