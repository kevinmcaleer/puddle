import { isNamespaceDeclaration, localName, readXml, XmlError, XmlReader, textChunks, type XmlInput } from './parse';

/**
 * XML to rows. An XML file holds its records as an element repeated under one parent (<book> in <catalog>, <entry>
 * in an Atom <feed>); scanXml finds those, and xmlToTable reads the chosen one with a row each, flattening its
 * attributes and child elements into columns:
 *
 *   <book id="7"><title>Emma</title><price currency="GBP">8</price><author>A</author><author>B</author></book>
 *   id = 7, title = Emma, price = 8, price.currency = GBP, author = ["A","B"]
 *
 * Elements that repeat inside a record become one column of JSON, or with `expand` a row each. Names are local
 * (prefixes dropped) and paths are written with "/" from the root: "catalog/book". Pure, and streaming: only one
 * record is held as a tree at a time.
 */

/** One element, as a small tree: a record, or a part of one. */
export interface XmlElement {
  /** Local name, prefix dropped. */
  name: string;
  attributes: [string, string][];
  children: XmlElement[];
  /** The element's own text, in pieces joined. */
  text: string;
}

/** An element that repeats under one parent, so could be read as records. */
export interface RecordCandidate {
  /** From the root, local names joined by "/": "catalog/book". */
  path: string;
  /** How many there are in the whole document. */
  count: number;
  /** Distinct attributes and child elements seen on it: 0 for an element holding only text. */
  fields: number;
}

/** What a pass over the document found. */
export interface XmlShape {
  root: string;
  /** Likeliest record first. */
  candidates: RecordCandidate[];
  /** Every path that repeats under one parent somewhere: inside a record, these become JSON or expanded rows. */
  repeats: Set<string>;
}

export interface XmlTable {
  /** The record element read. */
  record: string;
  /** The repeating element given a row each inside every record, if any. */
  expand?: string;
  columns: string[];
  rows: string[][];
}

export interface XmlReadOptions {
  /** The record element's path; the likeliest when not given. */
  record?: string;
  /** A repeating element inside the record, as a path from it ("author", "items/item"), to give a row each. */
  expand?: string;
}

const depthOf = (path: string) => path.split('/').length;

/** Records first: elements with fields before those holding only text, then the shallowest, then the most. */
const byLikeliness = (a: RecordCandidate, b: RecordCandidate) => Number(b.fields > 0) - Number(a.fields > 0) || depthOf(a.path) - depthOf(b.path) || b.count - a.count;

/** One pass over the document: the elements that repeat, and how many of each there are. */
export async function scanXml(input: XmlInput): Promise<XmlShape> {
  const stats = new Map<string, { count: number; fields: Set<string>; repeats: boolean }>();
  const stack: { path: string; children: Map<string, number> }[] = [];
  let root = '';
  await readXml(input, {
    open(name, attributes) {
      const local = localName(name);
      const parent = stack[stack.length - 1];
      const path = parent ? `${parent.path}/${local}` : local;
      if (!parent) root = local;
      let s = stats.get(path);
      if (!s) stats.set(path, (s = { count: 0, fields: new Set(), repeats: false }));
      s.count++;
      for (const [a] of attributes) if (!isNamespaceDeclaration(a)) s.fields.add(`@${localName(a)}`);
      if (parent) {
        parent.children.set(local, (parent.children.get(local) ?? 0) + 1);
        stats.get(parent.path)!.fields.add(local);
      }
      stack.push({ path, children: new Map() });
    },
    text() {},
    close() {
      const frame = stack.pop()!;
      for (const [child, n] of frame.children) if (n > 1) stats.get(`${frame.path}/${child}`)!.repeats = true;
    },
  });
  const repeats = new Set([...stats].filter(([, s]) => s.repeats).map(([p]) => p));
  const candidates = [...repeats].map((path) => ({ path, count: stats.get(path)!.count, fields: stats.get(path)!.fields.size })).sort(byLikeliness);
  // Nothing repeats: the root's children (or the root itself) make a single record.
  if (!candidates.length) {
    const only = [...stats].find(([p, s]) => depthOf(p) === 2 && s.fields.size > 0)?.[0] ?? root;
    candidates.push({ path: only, count: 1, fields: stats.get(only)!.fields.size });
  }
  return { root, candidates, repeats };
}

/** The repeating elements inside a record that can be given a row each: not inside another repeat within it. */
export function expandCandidates(shape: XmlShape, record: string): RecordCandidate[] {
  const prefix = `${record}/`;
  const inside = [...shape.repeats].filter((p) => p.startsWith(prefix));
  const nested = (p: string) => inside.some((q) => q !== p && p.startsWith(`${q}/`));
  return inside
    .filter((p) => !nested(p))
    .map((p) => ({ path: p.slice(prefix.length), count: 0, fields: 0 }))
    .sort((a, b) => depthOf(a.path) - depthOf(b.path));
}

/** "catalog/book" to "catalog › book", for menus. */
export const pathLabel = (path: string) => path.split('/').join(' › ');

/**
 * Stream the elements at a path as trees, one at a time: the building block for reading records your own way
 * (an OData feed's <entry> elements, say). Elements of the same name nested inside a match are part of it.
 */
export async function* xmlElements(input: XmlInput, path: string): AsyncIterable<XmlElement> {
  const ready: XmlElement[] = [];
  const names: string[] = [];
  const building: XmlElement[] = [];
  let found = false;
  const reader = new XmlReader({
    open(name, attributes) {
      const local = localName(name);
      names.push(local);
      if (building.length || names.join('/') === path) {
        const el: XmlElement = { name: local, attributes: attributes.map(([a, v]) => [a, v]), children: [], text: '' };
        building[building.length - 1]?.children.push(el);
        building.push(el);
      }
    },
    text(text) {
      const top = building[building.length - 1];
      if (top) top.text += text;
    },
    close() {
      names.pop();
      const el = building.pop();
      if (el && !building.length) {
        found = true;
        ready.push(el);
      }
    },
  });
  for await (const chunk of textChunks(input)) {
    reader.push(chunk);
    yield* ready.splice(0);
  }
  reader.end();
  yield* ready.splice(0);
  if (!found) throw new XmlError(`There are no ${pathLabel(path)} elements in this XML. Choose another record element.`);
}

/** Columns in the order first seen, each under a unique name. */
class Columns {
  readonly names: string[] = [];
  private byKey = new Map<string, number>();
  private used = new Set<string>();

  index(key: string, display: string): number {
    let i = this.byKey.get(key);
    if (i !== undefined) return i;
    let name = display;
    for (let n = 2; this.used.has(name); n++) name = `${display} ${n}`;
    this.used.add(name);
    this.byKey.set(key, (i = this.names.length));
    this.names.push(name);
    return i;
  }
}

/** Values keyed by where they come from: an element's path within the record ("price"), or its attribute ("price@currency"). */
type Flat = Map<string, string>;

const dotted = (rel: string) => rel.split('/').join('.');
const attributeKey = (rel: string, name: string) => `${rel}@${name}`;
/** A column's name from its key: "price@currency" to "price.currency"; the record's own text and attributes by their names. */
const displayName = (key: string, self: string) => {
  const at = key.indexOf('@');
  if (at === -1) return key ? dotted(key) : self;
  const rel = key.slice(0, at);
  return rel ? `${dotted(rel)}.${key.slice(at + 1)}` : key.slice(at + 1);
};

const isLeaf = (el: XmlElement) => !el.children.length;

/** A value that only reserves a column's position; left out of the row. */
const PLACE = '\u0000';

interface Flattener {
  /** True when the element at this path within the record repeats somewhere in the document. */
  repeats(rel: string): boolean;
  /** The path to give a row each, if any. */
  expand?: string;
  /** Collects the elements to expand, when met. */
  expanded?: XmlElement[];
}

/** An element in a JSON array: its text when it has nothing else, else an object of its fields. */
function itemValue(el: XmlElement, f: Flattener): unknown {
  if (isLeaf(el) && !el.attributes.some(([a]) => !isNamespaceDeclaration(a))) return el.text;
  const flat: Flat = new Map();
  flatten(el, '', flat, { repeats: (rel) => f.repeats(rel) });
  return Object.fromEntries([...flat].map(([k, v]) => [displayName(k, '#text'), v]));
}

function flatten(el: XmlElement, rel: string, out: Flat, f: Flattener) {
  const attributes = el.attributes.filter(([a]) => !isNamespaceDeclaration(a));
  const setAttributes = () => {
    for (const [a, v] of attributes) out.set(attributeKey(rel, localName(a)), v);
  };
  if (isLeaf(el)) {
    // An empty element with attributes is described by them; one with none still has its (empty) column.
    if (el.text || !attributes.length) out.set(rel, el.text);
    setAttributes();
    return;
  }
  setAttributes();
  // Text between child elements, apart from indentation.
  const own = el.text.trim();
  if (own) out.set(rel, own);
  const groups = new Map<string, XmlElement[]>();
  for (const child of el.children) {
    const g = groups.get(child.name);
    if (g) g.push(child);
    else groups.set(child.name, [child]);
  }
  for (const [name, group] of groups) {
    const childRel = rel ? `${rel}/${name}` : name;
    if (childRel === f.expand) {
      f.expanded?.push(...group);
      // Holds the expanded values' place among the columns.
      out.set(childRel, PLACE);
    }
    else if (group.length > 1 || f.repeats(childRel)) out.set(childRel, JSON.stringify(group.map((g) => itemValue(g, { repeats: (r) => f.repeats(`${childRel}/${r}`) }))));
    else flatten(group[0]!, childRel, out, f);
  }
}

/**
 * Read the XML as a table: one row per record element (or per expanded element in each), every value as text for
 * DuckDB to type. Scans the document first unless its shape is given.
 */
export async function xmlToTable(input: XmlInput, options: XmlReadOptions = {}, shape?: XmlShape): Promise<XmlTable & { shape: XmlShape }> {
  shape ??= await scanXml(input);
  const record = options.record ?? shape.candidates[0]!.path;
  const self = record.slice(record.lastIndexOf('/') + 1);
  const expand = options.expand || undefined;
  const columns = new Columns();
  const rows: string[][] = [];
  const row = (flat: Flat) => {
    const r: string[] = [];
    for (const [key, value] of flat) if (value !== PLACE) r[columns.index(key, displayName(key, self))] = value;
    rows.push(r);
  };
  const repeats = (rel: string) => shape.repeats.has(`${record}/${rel}`);
  for await (const el of xmlElements(input, record)) {
    const base: Flat = new Map();
    const expanded: XmlElement[] = [];
    flatten(el, '', base, { repeats, expand, expanded });
    if (!expanded.length) {
      row(base);
      continue;
    }
    for (const item of expanded) {
      const flat = new Map(base);
      flatten(item, expand!, flat, { repeats });
      row(flat);
    }
  }
  const width = columns.names.length;
  return { record, ...(expand ? { expand } : {}), columns: columns.names, rows: rows.map((r) => Array.from({ length: width }, (_, i) => r[i] ?? '')), shape };
}

const csvField = (v: string) => (/[",\r\n]/.test(v) || v !== v.trim() ? `"${v.replace(/"/g, '""')}"` : v);

/** The table as CSV with a header row, for DuckDB to read and type. */
export function tableToCsv(table: Pick<XmlTable, 'columns' | 'rows'>): string {
  return [table.columns, ...table.rows].map((r) => r.map(csvField).join(',')).join('\n') + '\n';
}
