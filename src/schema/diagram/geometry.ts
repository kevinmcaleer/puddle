// Where everything in a schema diagram is drawn, worked out without the DOM: table, enum and sticky note boxes, group
// frames, each ref's line with its ends, and the dotted links from enums to the columns that use them. Pure, so the
// same drawing is shown, exported as SVG and tested. Sizes come from the design tokens; text widths are estimated from
// the monospace font's fixed advance.
import { enumOf, qualified, type DbmlEnum, type DbmlSchema, type Ref, type StickyNote, type Table, type TableGroup } from '../model';
import { toneOf, type Tone } from './palette';
import { CHAR, FOOT, GAP, GLYPH, LINE, MARGIN, MIN_WIDTH, NOTE_WIDTH, PAD, ROW, STUB } from './metrics';
import { frameOf, placeGrouped, type Sized } from './place';

export * from './metrics';

export type DetailLevel = 'full' | 'keys' | 'names';

import type { Point, Rect } from './place';

export type { Point, Rect } from './place';

/** The keys diagram elements' positions are saved under. */
export const tableId = (t: { schema: string; name: string }) => `table:${t.schema}.${t.name}`;
export const enumId = (e: { schema: string; name: string }) => `enum:${e.schema}.${e.name}`;
export const noteId = (n: { name: string }) => `note:${n.name}`;
export const groupId = (g: { name: string }) => `group:${g.name}`;

export interface RowBox {
  column: string;
  /** Top of the row, in diagram coordinates. */
  y: number;
}

export interface TableBox extends Rect {
  id: string;
  table: Table;
  /** `schema.name`, or the name alone in the public schema. */
  label: string;
  rows: RowBox[];
  tone?: Tone;
}

export interface EnumBox extends Rect {
  id: string;
  dbmlEnum: DbmlEnum;
  label: string;
  rows: { value: string; y: number }[];
}

export interface NoteBox extends Rect {
  id: string;
  note: StickyNote;
  lines: string[];
  tone?: Tone;
  /** `color: none`: text on the canvas, no card. */
  plain: boolean;
}

export interface GroupFrame extends Rect {
  id: string;
  group: TableGroup;
  /** The ids of the tables drawn inside it. */
  tables: string[];
  tone?: Tone;
}

export type Cardinality = 'one' | 'many';

export interface End extends Point {
  side: 1 | -1;
}

export interface RefLine {
  /** Its index in schema.refs. */
  index: number;
  ref: Ref;
  from: TableBox;
  to: TableBox;
  /** The path drawn. */
  d: string;
  start: End;
  end: End;
  fromEnd: Cardinality;
  toEnd: Cardinality;
  tone?: Tone;
  /** A composite ref's column pairs, in order; one pair for a plain ref. */
  pairs: [string, string][];
}

/** The dotted line from an enum to a column of its type. */
export interface EnumLink {
  enumBox: EnumBox;
  table: TableBox;
  column: string;
  d: string;
}

export interface Diagram {
  tables: TableBox[];
  enums: EnumBox[];
  notes: NoteBox[];
  groups: GroupFrame[];
  refs: RefLine[];
  enumLinks: EnumLink[];
  /** Everything drawn, frames and notes included, with a margin around it. */
  bounds: Rect;
  /** The far right and bottom edges, with a margin: the size an SVG drawn from the origin needs. */
  width: number;
  height: number;
}

/** Each end of a ref: `<` is one-to-many from `from` to `to`, `>` many-to-one, `-` one-to-one, `<>` many-to-many. */
export function cardinality(ref: Pick<Ref, 'op'>): { from: Cardinality; to: Cardinality } {
  switch (ref.op) {
    case '<':
      return { from: 'one', to: 'many' };
    case '>':
      return { from: 'many', to: 'one' };
    case '-':
      return { from: 'one', to: 'one' };
    case '<>':
      return { from: 'many', to: 'many' };
  }
}

/** The ids of the two tables a ref joins, the side with one row (the parent) first; null when it is many-to-many. */
export function refParent(ref: Ref): { parent: string; child: string } | null {
  const from = tableId({ schema: ref.from.schema, name: ref.from.table });
  const to = tableId({ schema: ref.to.schema, name: ref.to.table });
  const ends = cardinality(ref);
  if (ends.from === 'one' && ends.to === 'many') return { parent: from, child: to };
  if (ends.to === 'one') return { parent: to, child: from };
  return null;
}

/** The columns a table shows at a detail level: all, only keys (primary, unique or in a ref), or none. */
export function visibleColumns(schema: DbmlSchema, table: Table, detail: DetailLevel): Table['columns'] {
  if (detail === 'full') return table.columns;
  if (detail === 'names') return [];
  const inRef = new Set<string>();
  for (const r of schema.refs)
    for (const e of [r.from, r.to]) if (e.schema === table.schema && e.table === table.name) for (const c of e.columns) inRef.add(c);
  const inKey = new Set(table.indexes.filter((ix) => ix.pk || ix.unique).flatMap((ix) => ix.parts.filter((p) => p.kind === 'column').map((p) => p.value)));
  return table.columns.filter((c) => c.pk || c.unique || inRef.has(c.name) || inKey.has(c.name));
}

const snap = (n: number) => Math.ceil(n / 8) * 8;
export const textWidth = (text: string) => [...text].length * CHAR;

/** The word in an enum's header, after its name. */
export const ENUM_TAG = 'enum';

/** How a column's name is shown: with `*` when it can't be null. */
export const columnLabel = (c: Table['columns'][number]) => (c.notNull ? `${c.name} *` : c.name);

/** A table's width: its name, or its widest column with type, whichever is wider. */
export function tableWidth(table: Table, columns: Table['columns'], label = table.name): number {
  const head = PAD + textWidth(label) + (table.note ? GAP + GLYPH : 0) + PAD;
  const rows = columns.map((c) => PAD + GLYPH + textWidth(columnLabel(c)) + GAP + textWidth(c.type) + PAD);
  return snap(Math.max(MIN_WIDTH, head, ...rows));
}

/** A box's height: a header and its rows, with a little room under the last. */
export const boxHeight = (rows: number) => ROW * (1 + rows) + (rows ? FOOT : 0);

/** Text broken into lines of at most `width` characters, at spaces where it can be, keeping the author's line breaks. */
export function wrap(text: string, width: number): string[] {
  const out: string[] = [];
  for (const para of text.split('\n')) {
    let line = '';
    for (const word of para.split(/ +/)) {
      let w = word;
      while ([...w].length > width) {
        if (line) {
          out.push(line);
          line = '';
        }
        out.push([...w].slice(0, width).join(''));
        w = [...w].slice(width).join('');
      }
      if (!line) line = w;
      else if ([...line].length + 1 + [...w].length <= width) line += ` ${w}`;
      else {
        out.push(line);
        line = w;
      }
    }
    out.push(line);
  }
  while (out.length > 1 && out[out.length - 1] === '') out.pop();
  return out;
}

/** The middle of a column's row, or of the header when the column isn't shown. */
export function rowY(box: { y: number; rows: RowBox[] }, column: string): number {
  const row = box.rows.find((r) => r.column === column);
  return (row ? row.y : box.y) + ROW / 2;
}

/**
 * A line between two boxes at given heights: out of the side of each that faces the other, straight for a stub, then a
 * curve between. Boxes that overlap sideways are joined on their right sides, and a box's line to itself loops on its
 * right.
 */
export function linkPath(from: Rect, y1: number, to: Rect, y2: number): { d: string; start: End; end: End } {
  const overlap = from === to || (to.x < from.x + from.w && to.x + to.w > from.x);
  let s1: 1 | -1;
  let s2: 1 | -1;
  if (overlap) [s1, s2] = [1, 1];
  else if (from.x + from.w / 2 <= to.x + to.w / 2) [s1, s2] = [1, -1];
  else [s1, s2] = [-1, 1];
  const x1 = s1 === 1 ? from.x + from.w : from.x;
  const x2 = s2 === 1 ? to.x + to.w : to.x;
  const a = { x: x1 + s1 * STUB, y: y1 };
  const b = { x: x2 + s2 * STUB, y: y2 };
  let d: string;
  if (overlap) {
    const out = Math.max(a.x, b.x) + STUB;
    d = `M${x1},${y1} H${out} V${y2} H${x2}`;
  } else {
    const bend = Math.max(STUB, Math.abs(b.x - a.x) / 2);
    d = `M${x1},${y1} H${a.x} C${a.x + s1 * bend},${y1} ${b.x + s2 * bend},${y2} ${b.x},${y2} H${x2}`;
  }
  return { d, start: { x: x1, y: y1, side: s1 }, end: { x: x2, y: y2, side: s2 } };
}

/** A ref's line, from one column's row to the other's. */
export function refPath(from: TableBox, fromColumn: string, to: TableBox, toColumn: string): { d: string; start: End; end: End } {
  return linkPath(from, rowY(from, fromColumn), to, rowY(to, toColumn));
}

export interface DiagramOptions {
  detail?: DetailLevel;
  /** Only these tables, by id; all when absent. */
  only?: Set<string>;
}

/** Every element's size and what it is joined to: what placing and auto-arranging work from. */
export function sizeElements(schema: DbmlSchema, options: DiagramOptions = {}) {
  const detail = options.detail ?? 'full';
  const shown = schema.tables.filter((t) => !options.only || options.only.has(tableId(t)));
  const shownIds = new Set(shown.map(tableId));
  const tables = shown.map((t) => {
    const columns = visibleColumns(schema, t, detail);
    const label = qualified(t.schema, t.name);
    return { id: tableId(t), table: t, label, columns, w: tableWidth(t, columns, label), h: boxHeight(columns.length) };
  });
  // Enums are drawn when a shown table uses one, or when every table is shown.
  const users = new Map<string, { table: string; column: string }[]>();
  for (const t of tables)
    for (const c of t.columns) {
      const e = enumOf(schema, c);
      if (!e) continue;
      const id = enumId(e);
      users.set(id, [...(users.get(id) ?? []), { table: t.id, column: c.name }]);
    }
  const enums = schema.enums
    .filter((e) => !options.only || users.has(enumId(e)))
    .map((e) => {
      const label = qualified(e.schema, e.name);
      const values = detail === 'names' ? [] : e.values;
      const w = snap(Math.max(MIN_WIDTH * 0.75, PAD + textWidth(label) + GAP + textWidth(ENUM_TAG) + PAD, ...values.map((v) => PAD + textWidth(v.name) + PAD)));
      return { id: enumId(e), dbmlEnum: e, label, values, w, h: boxHeight(values.length), users: users.get(enumId(e)) ?? [] };
    });
  const notes = options.only
    ? []
    : schema.notes.map((n) => {
        const lines = wrap(n.text, Math.floor((NOTE_WIDTH - PAD * 2) / CHAR));
        return { id: noteId(n), note: n, lines, w: NOTE_WIDTH, h: ROW + lines.length * LINE + PAD };
      });

  const near = new Map<string, { id: string; after: boolean }[]>();
  const join = (a: string, b: string, after: boolean) => near.set(a, [...(near.get(a) ?? []), { id: b, after }]);
  for (const r of schema.refs) {
    const from = tableId({ schema: r.from.schema, name: r.from.table });
    const to = tableId({ schema: r.to.schema, name: r.to.table });
    if (from === to || !shownIds.has(from) || !shownIds.has(to)) continue;
    const p = refParent(r);
    join(from, to, p ? p.child === from : true);
    join(to, from, p ? p.child === to : false);
  }
  for (const e of enums)
    for (const u of e.users) {
      join(e.id, u.table, false);
      join(u.table, e.id, true);
    }
  const sized: Sized[] = [...tables, ...enums, ...notes].map((x) => {
    const n = near.get(x.id) ?? [];
    return { id: x.id, w: x.w, h: x.h, near: n.map((k) => k.id), after: n.map((k) => k.after) };
  });
  return { tables, enums, notes, sized };
}

const union = (rects: Rect[]): Rect | undefined => {
  if (!rects.length) return undefined;
  const x = Math.min(...rects.map((r) => r.x));
  const y = Math.min(...rects.map((r) => r.y));
  return { x, y, w: Math.max(...rects.map((r) => r.x + r.w)) - x, h: Math.max(...rects.map((r) => r.y + r.h)) - y };
};

/** A group's frame around its tables: padded, with its name in a header above them. */
export const frameAround = frameOf;

/**
 * The whole diagram: every element where it was put, or in a free spot near what it is joined to (else on a new
 * shelf), group frames around their tables, every ref between shown tables and every enum link.
 */
export function layoutDiagram(schema: DbmlSchema, positions: Record<string, Point>, options: DiagramOptions = {}): Diagram {
  const { tables, enums, notes, sized } = sizeElements(schema, options);
  // A table is drawn inside the first group that lists it.
  const shown = new Set(tables.map((t) => t.id));
  const grouped = new Set<string>();
  const members = schema.groups.map((g) => {
    const ids = g.tables.map(tableId).filter((id) => shown.has(id) && !grouped.has(id));
    ids.forEach((id) => grouped.add(id));
    return ids;
  });
  const places = { ...positions, ...placeGrouped(sized, positions, members) };

  const tableBoxes: TableBox[] = tables.map((s) => {
    const at = places[s.id]!;
    return { id: s.id, table: s.table, label: s.label, x: at.x, y: at.y, w: s.w, h: s.h, rows: s.columns.map((c, i) => ({ column: c.name, y: at.y + ROW * (i + 1) })), tone: toneOf(s.table.headerColor) };
  });
  const enumBoxes: EnumBox[] = enums.map((s) => {
    const at = places[s.id]!;
    return { id: s.id, dbmlEnum: s.dbmlEnum, label: s.label, x: at.x, y: at.y, w: s.w, h: s.h, rows: s.values.map((v, i) => ({ value: v.name, y: at.y + ROW * (i + 1) })) };
  });
  const noteBoxes: NoteBox[] = notes.map((s) => {
    const at = places[s.id]!;
    const plain = s.note.color === 'none';
    return { id: s.id, note: s.note, lines: s.lines, x: at.x, y: at.y, w: s.w, h: s.h, plain, tone: plain ? undefined : (toneOf(s.note.color ?? s.note.properties.headercolor) ?? 'amber') };
  });

  const byId = new Map(tableBoxes.map((b) => [b.id, b]));
  const groups: GroupFrame[] = [];
  for (const [i, g] of schema.groups.entries()) {
    const ids = members[i]!;
    const frame = frameAround(ids.map((id) => byId.get(id)!));
    if (frame) groups.push({ id: groupId(g), group: g, tables: ids, ...frame, tone: toneOf(g.color) });
  }

  const refs: RefLine[] = [];
  schema.refs.forEach((ref, index) => {
    const from = byId.get(tableId({ schema: ref.from.schema, name: ref.from.table }));
    const to = byId.get(tableId({ schema: ref.to.schema, name: ref.to.table }));
    if (!from || !to) return;
    const path = refPath(from, ref.from.columns[0]!, to, ref.to.columns[0]!);
    const ends = cardinality(ref);
    const pairs = ref.from.columns.map((c, i): [string, string] => [c, ref.to.columns[i] ?? '']);
    refs.push({ index, ref, from, to, ...path, fromEnd: ends.from, toEnd: ends.to, tone: toneOf(ref.color), pairs });
  });

  const enumLinks: EnumLink[] = [];
  for (const e of enumBoxes)
    for (const u of enums.find((s) => s.id === e.id)!.users) {
      const table = byId.get(u.table)!;
      if (!table.rows.some((r) => r.column === u.column)) continue;
      enumLinks.push({ enumBox: e, table, column: u.column, d: linkPath(table, rowY(table, u.column), e, e.y + ROW / 2).d });
    }

  const all = union([...tableBoxes, ...enumBoxes, ...noteBoxes, ...groups]) ?? { x: 0, y: 0, w: 0, h: 0 };
  const bounds = { x: all.x - MARGIN, y: all.y - MARGIN, w: all.w + MARGIN * 2 + STUB * 2, h: all.h + MARGIN * 2 };
  return {
    tables: tableBoxes,
    enums: enumBoxes,
    notes: noteBoxes,
    groups,
    refs,
    enumLinks,
    bounds,
    width: Math.max(0, bounds.x + bounds.w),
    height: Math.max(0, bounds.y + bounds.h),
  };
}
