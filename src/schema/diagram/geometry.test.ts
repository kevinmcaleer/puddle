import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseDbml } from '../parse';
import { EXAMPLE_DBML } from '../example';
import { autoArrange } from './arrange';
import { boxHeight, CHAR, layoutDiagram, linkPath, MARGIN, PAD, refParent, ROW, tableId, tableWidth, visibleColumns, wrap, type Diagram } from './geometry';
import { overlaps, placeNew, type Rect } from './place';

const fixture = (name: string) => {
  const { schema, errors } = parseDbml(readFileSync(`tests/fixtures/dbml/${name}.dbml`, 'utf8'));
  expect(errors).toEqual([]);
  return schema;
};

const boxes = (d: Diagram): (Rect & { id: string })[] => [...d.tables, ...d.enums, ...d.notes];

/** Pairs of drawn boxes that overlap, and tables that overlap a group frame they aren't in. */
function collisions(d: Diagram): string[] {
  const out: string[] = [];
  const all = boxes(d);
  for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) if (overlaps(all[i]!, all[j]!)) out.push(`${all[i]!.id} / ${all[j]!.id}`);
  for (const g of d.groups) for (const b of all) if (!g.tables.includes(b.id) && overlaps(g, b)) out.push(`${g.id} / ${b.id}`);
  for (let i = 0; i < d.groups.length; i++) for (let j = i + 1; j < d.groups.length; j++) if (overlaps(d.groups[i]!, d.groups[j]!)) out.push(`${d.groups[i]!.id} / ${d.groups[j]!.id}`);
  return out;
}

describe('the model drawn', () => {
  const schema = fixture('diagram');
  const d = layoutDiagram(schema, {});

  it('draws every table, the enum, the group and the sticky note', () => {
    expect(d.tables.map((t) => t.label)).toEqual(['merchants', 'merchant_periods', 'jobs', 'users']);
    expect(d.enums.map((e) => [e.label, e.rows.map((r) => r.value)])).toEqual([['job_status', ['created', 'running', 'done']]]);
    expect(d.groups.map((g) => [g.group.name, g.tables, g.tone])).toEqual([['billing', ['table:public.merchants', 'table:public.merchant_periods'], 'blue']]);
    expect(d.notes.map((n) => [n.note.name, n.tone, n.plain])).toEqual([['planning', 'amber', false]]);
  });

  it('maps colours to the palette: header, group and ref', () => {
    expect(d.tables.find((t) => t.label === 'merchants')!.tone).toBe('red');
    expect(d.tables.find((t) => t.label === 'jobs')!.tone).toBeUndefined();
    expect(d.refs.find((r) => r.ref.name === 'audit')).toMatchObject({ tone: 'purple', ref: { inactive: true } });
  });

  it('draws a composite ref once, with its column pairs', () => {
    const composite = d.refs.filter((r) => r.from.label === 'merchant_periods');
    expect(composite).toHaveLength(1);
    expect(composite[0]!.pairs).toEqual([
      ['merchant_id', 'id'],
      ['country_code', 'country_code'],
    ]);
    expect([composite[0]!.fromEnd, composite[0]!.toEnd]).toEqual(['many', 'one']);
  });

  it('keeps which side of a ref is optional', () => {
    const r = d.refs.find((x) => x.from.label === 'jobs' && x.to.label === 'merchants')!;
    expect([r.ref.fromOptional, r.ref.toOptional]).toEqual([false, true]);
  });

  it('links the enum to the column that uses it, from that column’s row', () => {
    expect(d.enumLinks.map((l) => `${l.table.label}.${l.column}`)).toEqual(['jobs.status']);
    const jobs = d.tables.find((t) => t.label === 'jobs')!;
    const row = jobs.rows.find((r) => r.column === 'status')!;
    expect(d.enumLinks[0]!.d).toContain(`,${row.y + ROW / 2} `);
  });

  it('frames a group around its tables with room for its name', () => {
    const g = d.groups[0]!;
    for (const id of g.tables) {
      const t = d.tables.find((x) => x.id === id)!;
      expect(t.x).toBeGreaterThanOrEqual(g.x + PAD);
      expect(t.y).toBeGreaterThanOrEqual(g.y + PAD + ROW);
      expect(t.x + t.w).toBeLessThanOrEqual(g.x + g.w - PAD);
    }
  });

  it('wraps a sticky note’s text to its width', () => {
    const n = d.notes[0]!;
    expect(n.lines.length).toBeGreaterThan(1);
    for (const line of n.lines) expect(line.length * CHAR).toBeLessThanOrEqual(n.w - PAD * 2);
  });

  it('bounds everything drawn, frames and notes included', () => {
    for (const b of [...boxes(d), ...d.groups]) {
      expect(b.x).toBeGreaterThanOrEqual(d.bounds.x);
      expect(b.y).toBeGreaterThanOrEqual(d.bounds.y);
      expect(b.x + b.w).toBeLessThanOrEqual(d.bounds.x + d.bounds.w);
      expect(b.y + b.h).toBeLessThanOrEqual(d.bounds.y + d.bounds.h);
    }
  });

  it('places tables with no saved place without overlaps, a child to the right of its parent', () => {
    expect(collisions(d)).toEqual([]);
    const merchants = d.tables.find((t) => t.label === 'merchants')!;
    const periods = d.tables.find((t) => t.label === 'merchant_periods')!;
    expect(periods.x).toBeGreaterThan(merchants.x + merchants.w);
  });

  it('keeps saved places, and only places what is new', () => {
    const saved = { 'table:public.merchants': { x: 500, y: 300 } };
    const moved = layoutDiagram(schema, saved);
    expect(moved.tables.find((t) => t.label === 'merchants')).toMatchObject({ x: 500, y: 300 });
    expect(collisions(moved)).toEqual([]);
  });

  it('shows only key columns, or none, at the lower detail levels', () => {
    const jobs = schema.tables.find((t) => t.name === 'jobs')!;
    expect(visibleColumns(schema, jobs, 'keys').map((c) => c.name)).toEqual(['id', 'merchant_id']);
    expect(layoutDiagram(schema, {}, { detail: 'names' }).tables.every((t) => t.h === boxHeight(0))).toBe(true);
  });

  it('draws only the tables asked for, and the enums they use', () => {
    const only = layoutDiagram(schema, {}, { only: new Set([tableId({ schema: 'public', name: 'merchants' })]) });
    expect(only.tables.map((t) => t.label)).toEqual(['merchants']);
    expect(only.enums).toEqual([]);
    expect(only.notes).toEqual([]);
    expect(only.refs).toEqual([]);
  });

  it('keeps groups apart when their new tables come interleaved, as the canvas lists sources and views', () => {
    // Regression: each table went onto the shelf on its own, so the two frames were drawn over each other.
    const { schema: mixed, errors } = parseDbml(
      [
        ...[1, 2, 3].flatMap((i) => [`Table source${i} {\n  id int\n}`, `Table view${i} {\n  id int [ref: > source${i}.id]\n}`]),
        'TableGroup sources {\n  source1\n  source2\n  source3\n}',
        'TableGroup views {\n  view1\n  view2\n  view3\n}',
      ].join('\n'),
    );
    expect(errors).toEqual([]);
    const drawn = layoutDiagram(mixed, {});
    expect(drawn.groups.map((g) => g.group.name)).toEqual(['sources', 'views']);
    expect(collisions(drawn)).toEqual([]);
    const [sources, views] = drawn.groups;
    expect([sources!.x, sources!.y]).not.toEqual([views!.x, views!.y]);
  });

  it('places a new group clear of a group that already has its places', () => {
    const { schema: two, errors } = parseDbml('Table a {\n  id int\n}\nTable b {\n  id int\n}\nTable c {\n  id int [ref: > a.id]\n}\nTableGroup first {\n  a\n  b\n}\nTableGroup second {\n  c\n}');
    expect(errors).toEqual([]);
    // a and b sit far apart, leaving room inside their frame, right beside a, that c would take on its own.
    const drawn = layoutDiagram(two, { 'table:public.a': { x: 40, y: 40 }, 'table:public.b': { x: 1200, y: 40 } });
    expect(collisions(drawn)).toEqual([]);
  });

  it('marks not null columns, and widens tables to fit them', () => {
    const merchants = schema.tables.find((t) => t.name === 'merchants')!;
    expect(tableWidth(merchants, merchants.columns)).toBeGreaterThanOrEqual(PAD * 2 + ('name *'.length + 'varchar'.length) * CHAR);
  });
});

describe('ref parents', () => {
  const schema = fixture('diagram');
  it('puts the side with one row first', () => {
    expect(refParent(schema.refs[0]!)).toEqual({ parent: 'table:public.merchants', child: 'table:public.jobs' });
    expect(refParent(schema.refs[1]!)).toEqual({ parent: 'table:public.merchants', child: 'table:public.merchant_periods' });
  });
});

describe('placing new elements', () => {
  it('puts unrelated elements side by side on a shelf, and starts a new shelf when it is full', () => {
    const items = Array.from({ length: 9 }, (_, i) => ({ id: `t${i}`, w: 200, h: 100, near: [] }));
    const at = placeNew(items, {});
    expect(at.t0).toEqual({ x: MARGIN, y: MARGIN });
    expect(at.t1!.y).toBe(MARGIN);
    expect(new Set(Object.values(at).map((p) => p.y)).size).toBeGreaterThan(1);
    const rects = items.map((s) => ({ ...at[s.id]!, w: s.w, h: s.h }));
    for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) expect(overlaps(rects[i]!, rects[j]!)).toBe(false);
  });

  it('puts a new table beside the one it refers to, stepping down when that spot is taken', () => {
    const items = [
      { id: 'a', w: 200, h: 100, near: [] },
      { id: 'b', w: 200, h: 100, near: ['a'], after: [true] },
      { id: 'c', w: 200, h: 100, near: ['a'], after: [true] },
    ];
    const at = placeNew(items, { a: { x: 400, y: 40 } });
    expect(at.b!.x).toBeGreaterThan(600);
    expect(at.c!.x).toBe(at.b!.x);
    expect(at.c!.y).toBeGreaterThan(at.b!.y + 100);
  });

  it('puts a parent to the left of its child when there is room', () => {
    const at = placeNew(
      [
        { id: 'child', w: 200, h: 100, near: [] },
        { id: 'parent', w: 200, h: 100, near: ['child'], after: [false] },
      ],
      { child: { x: 600, y: 40 } },
    );
    expect(at.parent!.x + 200).toBeLessThan(600);
  });

  it('places nothing that already has a place', () => {
    expect(placeNew([{ id: 'a', w: 10, h: 10, near: [] }], { a: { x: 1, y: 2 } })).toEqual({});
  });
});

describe('auto-arrange', () => {
  it.each([
    ['the example', EXAMPLE_DBML],
    ['the shop fixture', readFileSync('tests/fixtures/dbml/shop.dbml', 'utf8')],
    ['the diagram fixture', readFileSync('tests/fixtures/dbml/diagram.dbml', 'utf8')],
    ['the refs fixture', readFileSync('tests/fixtures/dbml/refs.dbml', 'utf8')],
  ])('leaves nothing overlapping in %s', (_name, text) => {
    const { schema } = parseDbml(text);
    const d = layoutDiagram(schema, autoArrange(schema));
    expect(collisions(d)).toEqual([]);
  });

  it('lays refs out left to right, parent before child, and an enum before its tables', () => {
    const schema = fixture('shop');
    const d = layoutDiagram(schema, autoArrange(schema));
    const x = (label: string) => d.tables.find((t) => t.label === label)!.x;
    expect(x('customers')).toBeLessThan(x('orders'));
    expect(x('orders')).toBeLessThan(x('order_items'));
    expect(d.enums[0]!.x).toBeLessThan(x('orders'));
  });

  it('keeps a group’s tables together, inside the frame', () => {
    const schema = fixture('shop');
    const d = layoutDiagram(schema, autoArrange(schema));
    const sales = d.groups.find((g) => g.group.name === 'sales')!;
    expect(sales.tables).toHaveLength(2);
    expect(collisions(d)).toEqual([]);
  });

  it('starts at the margin, nothing cut off', () => {
    const schema = fixture('diagram');
    const d = layoutDiagram(schema, autoArrange(schema));
    expect(Math.min(...[...boxes(d), ...d.groups].map((b) => b.x))).toBeGreaterThanOrEqual(0);
    expect(Math.min(...[...boxes(d), ...d.groups].map((b) => b.y))).toBeGreaterThanOrEqual(0);
  });

  it('puts sticky notes on a row under the diagram', () => {
    const schema = fixture('diagram');
    const d = layoutDiagram(schema, autoArrange(schema));
    const lowest = Math.max(...d.tables.map((t) => t.y + t.h));
    expect(d.notes[0]!.y).toBeGreaterThan(lowest);
  });
});

describe('lines and text', () => {
  it('joins two side-by-side boxes on their facing sides', () => {
    const a = { x: 0, y: 0, w: 100, h: 50 };
    const b = { x: 300, y: 0, w: 100, h: 50 };
    const p = linkPath(a, 10, b, 20);
    expect(p.start).toEqual({ x: 100, y: 10, side: 1 });
    expect(p.end).toEqual({ x: 300, y: 20, side: -1 });
  });

  it('wraps at spaces, breaks long words and keeps line breaks', () => {
    expect(wrap('one two three', 7)).toEqual(['one two', 'three']);
    expect(wrap('abcdefghij', 4)).toEqual(['abcd', 'efgh', 'ij']);
    expect(wrap('a\nb', 10)).toEqual(['a', 'b']);
  });
});
