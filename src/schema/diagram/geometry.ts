// Where everything in a schema diagram is drawn, worked out without the DOM: table boxes, their rows, and each ref's
// line with its ends. Pure, so the same drawing is shown, exported as SVG and tested. Sizes come from the design
// tokens; text widths are estimated from the monospace font's fixed advance.
import tokens from '../../design-system/tokens.json';
import type { DbmlSchema, Ref, Table } from '../model';

const token = (group: 'size' | 'spacing', name: string): number => {
  const t = (tokens[group].tokens as { name: string; value: string }[]).find((x) => x.name === name);
  if (!t) throw new Error(`No ${group} token ${name}`);
  return parseFloat(t.value);
};

/** A row of a table: the header or one column. */
export const ROW = token('size', 'size-row');
export const PAD = token('spacing', 'space-3');
export const GAP = token('spacing', 'space-4');
/** Room for a key or ref glyph before a column name. */
export const GLYPH = token('spacing', 'space-4');
export const MIN_WIDTH = token('size', 'size-node-width') - token('spacing', 'space-8') * 2;
/** Between tables placed in a grid. */
export const GUTTER = token('spacing', 'space-8') * 3;
export const MARGIN = token('spacing', 'space-8');
/** How far a ref line runs straight out of a table before it bends. */
export const STUB = token('spacing', 'space-6');
/** The data font is 12px JetBrains Mono, whose every glyph advances 0.6em. */
export const FONT = 12;
export const CHAR = FONT * 0.6;

export type DetailLevel = 'full' | 'keys' | 'names';

export interface Point {
  x: number;
  y: number;
}

/** The key a diagram element's position is saved under. */
export const tableId = (t: { schema: string; name: string }) => `table:${t.schema}.${t.name}`;

export interface RowBox {
  column: string;
  /** Top of the row, in diagram coordinates. */
  y: number;
}

export interface TableBox {
  id: string;
  table: Table;
  x: number;
  y: number;
  w: number;
  h: number;
  rows: RowBox[];
}

export type Cardinality = 'one' | 'many';

export interface RefLine {
  /** Its index in schema.refs. */
  index: number;
  ref: Ref;
  from: TableBox;
  to: TableBox;
  /** The path drawn. */
  d: string;
  start: Point & { side: 1 | -1 };
  end: Point & { side: 1 | -1 };
  fromEnd: Cardinality;
  toEnd: Cardinality;
}

export interface Diagram {
  tables: TableBox[];
  refs: RefLine[];
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

/** A table's width: its name, or its widest column with type, whichever is wider. */
export function tableWidth(table: Table, columns: Table['columns']): number {
  const head = PAD + GLYPH + textWidth(table.name) + PAD;
  const rows = columns.map((c) => PAD + GLYPH + textWidth(c.name) + GAP + textWidth(c.type) + PAD);
  return snap(Math.max(MIN_WIDTH, head, ...rows));
}

/** Where tables with no saved position go: a grid, in the order they are written, after any that are placed. */
export function gridPlaces(sizes: { id: string; w: number; h: number }[], placed: Record<string, Point>): Record<string, Point> {
  const free = sizes.filter((s) => !placed[s.id]);
  if (!free.length) return {};
  const bottom = Math.max(0, ...sizes.filter((s) => placed[s.id]).map((s) => placed[s.id]!.y + s.h + GUTTER));
  const perRow = Math.max(1, Math.ceil(Math.sqrt(free.length)));
  const colWidth = Math.max(...free.map((s) => s.w)) + GUTTER;
  const out: Record<string, Point> = {};
  let y = Math.max(MARGIN, bottom);
  for (let i = 0; i < free.length; i += perRow) {
    const row = free.slice(i, i + perRow);
    row.forEach((s, k) => (out[s.id] = { x: MARGIN + k * colWidth, y }));
    y += Math.max(...row.map((s) => s.h)) + GUTTER;
  }
  return out;
}

/** The middle of a column's row, or of the header when the column isn't shown. */
function rowY(box: TableBox, column: string): number {
  const row = box.rows.find((r) => r.column === column);
  return (row ? row.y : box.y) + ROW / 2;
}

/**
 * A ref's line: out of the side of each table that faces the other, straight for a stub, then a curve between.
 * Tables that overlap sideways are joined on their right sides, and a table's ref to itself loops on its right.
 */
export function refPath(from: TableBox, fromColumn: string, to: TableBox, toColumn: string): { d: string; start: Point & { side: 1 | -1 }; end: Point & { side: 1 | -1 } } {
  const y1 = rowY(from, fromColumn);
  const y2 = rowY(to, toColumn);
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

export interface DiagramOptions {
  detail?: DetailLevel;
  /** Only these tables, by id; all when absent. */
  only?: Set<string>;
}

/** The whole diagram: every table where it was put (or in a grid), with its rows, and every ref between shown tables. */
export function layoutDiagram(schema: DbmlSchema, positions: Record<string, Point>, options: DiagramOptions = {}): Diagram {
  const detail = options.detail ?? 'full';
  const shown = schema.tables.filter((t) => !options.only || options.only.has(tableId(t)));
  const sized = shown.map((t) => {
    const columns = visibleColumns(schema, t, detail);
    return { id: tableId(t), table: t, columns, w: tableWidth(t, columns), h: ROW * (1 + columns.length) + (columns.length ? token('spacing', 'space-1') : 0) };
  });
  const places = { ...positions, ...gridPlaces(sized, positions) };
  const boxes: TableBox[] = sized.map((s) => {
    const at = places[s.id]!;
    return { id: s.id, table: s.table, x: at.x, y: at.y, w: s.w, h: s.h, rows: s.columns.map((c, i) => ({ column: c.name, y: at.y + ROW * (i + 1) })) };
  });
  const byId = new Map(boxes.map((b) => [b.id, b]));
  const refs: RefLine[] = [];
  schema.refs.forEach((ref, index) => {
    const from = byId.get(tableId({ schema: ref.from.schema, name: ref.from.table }));
    const to = byId.get(tableId({ schema: ref.to.schema, name: ref.to.table }));
    if (!from || !to) return;
    const path = refPath(from, ref.from.columns[0]!, to, ref.to.columns[0]!);
    const ends = cardinality(ref);
    refs.push({ index, ref, from, to, ...path, fromEnd: ends.from, toEnd: ends.to });
  });
  const width = Math.max(0, ...boxes.map((b) => b.x + b.w)) + MARGIN + STUB * 2;
  const height = Math.max(0, ...boxes.map((b) => b.y + b.h)) + MARGIN;
  return { tables: boxes, refs, width, height };
}
