// Diagram edits made on the DBML text in place. Each takes the text and returns it changed only where the edit
// reaches, using the offsets the parser keeps, so comments and formatting elsewhere stay exactly as written.
import { lex, type Token } from './lexer';
import { DEFAULT_SCHEMA, type Column, type DbmlSchema, type RefOp, type Table } from './model';
import { parseDbml } from './parse';
import { dbmlName, dbmlString, writeColumn, writeEndpoint, writeRefOp } from './write';

/** A table by schema and name. */
export interface TableRef {
  schema: string;
  table: string;
}

/** A column of a table. */
export interface ColumnRef extends TableRef {
  column: string;
}

interface Splice {
  start: number;
  end: number;
  text: string;
}

/** Apply splices that don't overlap, from the last to the first so the earlier offsets stay right. */
function splice(text: string, splices: Splice[]): string {
  let out = text;
  for (const s of [...splices].sort((a, b) => b.start - a.start)) out = out.slice(0, s.start) + s.text + out.slice(s.end);
  return out;
}

const parse = (text: string) => parseDbml(text).schema;

const sameTable = (t: { schema: string; name?: string; table?: string }, ref: TableRef) => t.schema === ref.schema && (t.name ?? t.table) === ref.table;

function tableOf(schema: DbmlSchema, ref: TableRef): Table {
  const t = schema.tables.find((x) => sameTable(x, ref));
  if (!t?.range) throw new Error(`The schema has no table ${ref.table}.`);
  return t;
}

function columnOf(schema: DbmlSchema, ref: ColumnRef): { table: Table; column: Column } {
  const table = tableOf(schema, ref);
  const column = table.columns.find((c) => c.name === ref.column && !c.partial);
  if (!column?.range) throw new Error(`${ref.table} has no column ${ref.column} of its own.`);
  return { table, column };
}

/** `schema.table`, leaving out the public schema, as DBML writes it. */
const tableText = (ref: TableRef) => (ref.schema === DEFAULT_SCHEMA ? dbmlName(ref.table) : `${dbmlName(ref.schema)}.${dbmlName(ref.table)}`);

/** The whole lines a range sits on, newline included, when nothing else shares them; else just the range. */
function wholeLines(text: string, start: number, end: number): { start: number; end: number } {
  const lineStart = text.lastIndexOf('\n', start - 1) + 1;
  const nl = text.indexOf('\n', end);
  const lineEnd = nl < 0 ? text.length : nl + 1;
  const before = text.slice(lineStart, start);
  const after = text.slice(end, nl < 0 ? text.length : nl);
  if (before.trim() === '' && (after.trim() === '' || after.trim().startsWith('//'))) return { start: lineStart, end: lineEnd };
  return { start, end };
}

/** Remove a block and one blank line after it, so deleting an element doesn't leave a gap. */
function blockLines(text: string, start: number, end: number): { start: number; end: number } {
  const lines = wholeLines(text, start, end);
  const next = text.indexOf('\n', lines.end);
  if (next >= 0 && text.slice(lines.end, next).trim() === '') return { start: lines.start, end: next + 1 };
  if (next < 0 && text.slice(lines.end).trim() === '') return { start: lines.start, end: text.length };
  return lines;
}

/** The indent of the line an offset is on. */
const indentAt = (text: string, offset: number) => /^[ \t]*/.exec(text.slice(text.lastIndexOf('\n', offset - 1) + 1))![0];

/** Text appended at the end, after a blank line. */
function append(text: string, block: string): string {
  const body = text.replace(/\s+$/, '');
  return body ? `${body}\n\n${block}\n` : `${block}\n`;
}

const names = (text: string): Token[] => lex(text).tokens.filter((t) => t.kind !== 'newline' && t.kind !== 'eof');
const isName = (t: Token | undefined) => !!t && (t.kind === 'ident' || t.kind === 'quoted');
const isPunct = (t: Token | undefined, p: string) => !!t && t.kind === 'punct' && t.value === p;

// ---- refs ----

export interface NewRef {
  from: ColumnRef;
  to: ColumnRef;
  op: RefOp;
  fromOptional?: boolean;
  toOptional?: boolean;
}

/** One `Ref:` line, added at the end; nothing else in the text changes. */
export function addRef(text: string, ref: NewRef): string {
  const end = (c: ColumnRef) => ({ schema: c.schema, table: c.table, columns: [c.column] });
  const line = `Ref: ${writeEndpoint(end(ref.from))} ${writeRefOp({ op: ref.op, fromOptional: !!ref.fromOptional, toOptional: !!ref.toOptional })} ${writeEndpoint(end(ref.to))}`;
  const body = text.replace(/\s+$/, '');
  if (!body) return `${line}\n`;
  // Straight after a ref already at the end, as one more line of the refs; otherwise after a blank line.
  const last = parse(text).refs.filter((r) => !r.inline && r.range).at(-1);
  return last?.range && text.slice(last.range.end).trim() === '' ? `${body}\n${line}\n` : `${body}\n\n${line}\n`;
}

/** Remove the refs between two tables' columns that `match` picks: top-level lines go, inline settings are cut out. */
function removeRefs(text: string, schema: DbmlSchema, match: (r: DbmlSchema['refs'][number]) => boolean): Splice[] {
  const out: Splice[] = [];
  for (const r of schema.refs) {
    if (!r.range || !match(r)) continue;
    if (!r.inline) {
      out.push({ ...wholeLines(text, r.range.start, r.range.end), text: '' });
      continue;
    }
    // `[pk, ref: > users.id]`: drop the setting and the comma before or after it, or the brackets when it is alone.
    const open = text.lastIndexOf('[', r.range.start);
    const close = text.indexOf(']', r.range.end);
    const inside = text.slice(open + 1, close);
    if (inside.trim() === text.slice(r.range.start, r.range.end).trim()) {
      const start = /\s*$/.exec(text.slice(0, open))!.index;
      out.push({ start, end: close + 1, text: '' });
    } else {
      const after = /^\s*,\s*/.exec(text.slice(r.range.end, close));
      if (after) out.push({ start: r.range.start, end: r.range.end + after[0].length, text: '' });
      else {
        const before = /,\s*$/.exec(text.slice(open + 1, r.range.start))!;
        out.push({ start: open + 1 + before.index, end: r.range.end, text: '' });
      }
    }
  }
  return out;
}

const touches = (e: { schema: string; table: string; columns: string[] }, ref: TableRef, column?: string) => sameTable(e, ref) && (column == null || e.columns.includes(column));

// ---- renames ----

/** Rename a table, and every ref, group, records block and view that names it. */
export function renameTable(text: string, ref: TableRef, name: string): string {
  const schema = parse(text);
  const table = tableOf(schema, ref);
  if (name === ref.table) return text;
  if (schema.tables.some((t) => t.schema === ref.schema && t.name === name)) throw new Error(`There is already a table called ${name}.`);
  const tokens = names(text);
  const replace = dbmlName(name);
  const out: Splice[] = [];
  const inGroupOrView = (at: number) => [...schema.groups, ...schema.views].some((g) => g.range && g.range.start < at && at < g.range.end);
  tokens.forEach((t, i) => {
    if (!isName(t) || t.value !== ref.table) return;
    const prev = tokens[i - 1];
    const qualifiedOk = isPunct(prev, '.') ? tokens[i - 2]?.value === ref.schema && isName(tokens[i - 3]) === false : ref.schema === DEFAULT_SCHEMA;
    // The table's own name.
    if (table.nameRange && t.end === table.nameRange.end) return out.push({ start: t.start, end: t.end, text: replace });
    if (!qualifiedOk) return;
    // `users.id` in a ref, inline or not.
    if (isPunct(tokens[i + 1], '.') && (isName(tokens[i + 2]) || isPunct(tokens[i + 2], '('))) return out.push({ start: t.start, end: t.end, text: replace });
    // `records users(...)`.
    if (prev?.kind === 'ident' && prev.value.toLowerCase() === 'records') return out.push({ start: t.start, end: t.end, text: replace });
    // A member of a group, or a table listed in a view.
    if (inGroupOrView(t.start) && !isPunct(tokens[i + 1], ':')) out.push({ start: t.start, end: t.end, text: replace });
  });
  return splice(text, out);
}

/** Rename a column, and the refs, indexes and records that name it. */
export function renameColumn(text: string, ref: ColumnRef, name: string): string {
  const schema = parse(text);
  const { table, column } = columnOf(schema, ref);
  if (name === ref.column) return text;
  if (table.columns.some((c) => c.name === name)) throw new Error(`${ref.table} already has a column called ${name}.`);
  const tokens = names(text);
  const replace = dbmlName(name);
  const out: Splice[] = [{ start: column.nameRange!.start, end: column.nameRange!.end, text: replace }];
  const inside = (r: { start: number; end: number } | undefined, at: number) => !!r && r.start <= at && at < r.end;
  tokens.forEach((t, i) => {
    if (!isName(t) || t.value !== ref.column || t.start === column.nameRange!.start) return;
    // `users.id` or `users.(id, region)`, with the table named as the ref names it.
    let j = i - 1;
    if (isPunct(tokens[j], ',') || isPunct(tokens[j], '(')) {
      while (j > 0 && !isPunct(tokens[j], '(')) j--;
      if (!isPunct(tokens[j], '(')) return;
      j--;
    }
    if (isPunct(tokens[j], '.') && tokens[j - 1]?.value === ref.table) {
      const qualifier = isPunct(tokens[j - 2], '.') ? tokens[j - 3]?.value : DEFAULT_SCHEMA;
      if (qualifier === ref.schema) return out.push({ start: t.start, end: t.end, text: replace });
    }
    // An index of the table, or a records block's column list for it.
    if (table.indexes.some((ix) => !ix.partial && inside(ix.range, t.start))) return out.push({ start: t.start, end: t.end, text: replace });
    const recs = schema.records.find((r) => sameTable(r, ref) && !r.implicit && inside(r.range, t.start));
    if (recs) {
      // Only in the header, before the rows' block opens.
      const open = text.indexOf('{', recs.range!.start);
      if (t.start < open) out.push({ start: t.start, end: t.end, text: replace });
    }
  });
  return splice(text, out);
}

// ---- columns ----

/** A column's settings changed (keys, not null, increment, type, default, note): its line rewritten, refs kept. */
export type ColumnPatch = Partial<Omit<Column, 'name' | 'range' | 'nameRange' | 'partial'>>;

export function updateColumn(text: string, ref: ColumnRef, patch: ColumnPatch): string {
  const schema = parse(text);
  const { column } = columnOf(schema, ref);
  const inline = schema.refs.filter((r) => r.inline && sameTable(r.from, ref) && r.from.columns[0] === ref.column);
  const next: Column = { ...column, ...patch };
  for (const k of Object.keys(patch) as (keyof ColumnPatch)[]) if (patch[k] === undefined) delete next[k];
  // The line's own indent stays; it is passed so a multi-line note lines up under the column.
  const indent = indentAt(text, column.range!.start);
  return splice(text, [{ start: column.range!.start, end: column.range!.end, text: writeColumn(next, inline, indent).slice(indent.length) }]);
}

/** A new column after `after` (or at the end of the table's columns), on a line of its own. */
export function addColumn(text: string, ref: TableRef, column: Pick<Column, 'name' | 'type'> & Partial<Column>, after?: string): string {
  const schema = parse(text);
  const table = tableOf(schema, ref);
  if (table.columns.some((c) => c.name === column.name)) throw new Error(`${ref.table} already has a column called ${column.name}.`);
  const own = table.columns.filter((c) => !c.partial && c.range);
  const anchor = after ? own.find((c) => c.name === after) : own.at(-1);
  const full: Column = { pk: false, unique: false, increment: false, checks: [], properties: {}, ...column };
  if (anchor) {
    const indent = indentAt(text, anchor.range!.start);
    const nl = text.indexOf('\n', anchor.range!.end);
    const at = nl < 0 ? text.length : nl;
    return splice(text, [{ start: at, end: at, text: `\n${writeColumn(full, [], indent)}` }]);
  }
  // An empty table: just inside its brace.
  const open = text.indexOf('{', table.nameRange!.end);
  return splice(text, [{ start: open + 1, end: open + 1, text: `\n${writeColumn(full, [], '  ')}` }]);
}

/** A column deleted, with the refs that use it and its indexes. */
export function deleteColumn(text: string, ref: ColumnRef): string {
  const schema = parse(text);
  const { table, column } = columnOf(schema, ref);
  const out: Splice[] = [{ ...wholeLines(text, column.range!.start, column.range!.end), text: '' }];
  out.push(...removeRefs(text, schema, (r) => !(r.inline && sameTable(r.from, ref) && r.from.columns[0] === ref.column) && (touches(r.from, ref, ref.column) || touches(r.to, ref, ref.column))));
  for (const ix of table.indexes) if (ix.range && !ix.partial && ix.parts.some((p) => p.kind === 'column' && p.value === ref.column)) out.push({ ...wholeLines(text, ix.range.start, ix.range.end), text: '' });
  return splice(text, out);
}

// ---- tables ----

/** A new, empty table, at the end, with an id column to start from. */
export function addTable(text: string, ref: TableRef): string {
  if (parse(text).tables.some((t) => sameTable(t, ref))) throw new Error(`There is already a table called ${ref.table}.`);
  return append(text, `Table ${tableText(ref)} {\n  id integer [pk]\n}`);
}

/** A table deleted, with its refs, its records and its places in groups. */
export function deleteTable(text: string, ref: TableRef): string {
  const schema = parse(text);
  const table = tableOf(schema, ref);
  const out: Splice[] = [{ ...blockLines(text, table.range!.start, table.range!.end), text: '' }];
  // Inline refs written in the table go with it; every other ref to or from it is removed.
  out.push(...removeRefs(text, schema, (r) => !(r.inline && sameTable(r.from, ref)) && (touches(r.from, ref) || touches(r.to, ref))));
  for (const r of schema.records) if (!r.inline && r.range && sameTable(r, ref)) out.push({ ...blockLines(text, r.range.start, r.range.end), text: '' });
  out.push(...groupMembership(text, schema, ref));
  return splice(text, out);
}

/** The lines naming a table in groups, as removals. */
function groupMembership(text: string, schema: DbmlSchema, ref: TableRef): Splice[] {
  const tokens = lex(text).tokens;
  const out: Splice[] = [];
  for (const g of schema.groups) {
    if (!g.range || !g.tables.some((t) => sameTable(t, ref))) continue;
    for (let i = 0; i < tokens.length; i++) {
      const t = tokens[i]!;
      if (t.start <= g.range.start || t.end > g.range.end || !isName(t)) continue;
      const qualified = isPunct(tokens[i + 1], '.') && isName(tokens[i + 2]);
      const [s, n] = qualified ? [t.value, tokens[i + 2]!.value] : [DEFAULT_SCHEMA, t.value];
      const lineStart = i === 0 || tokens[i - 1]!.kind === 'newline' || isPunct(tokens[i - 1], '{');
      if (lineStart && s === ref.schema && n === ref.table) out.push({ ...wholeLines(text, t.start, qualified ? tokens[i + 2]!.end : t.end), text: '' });
    }
  }
  return out;
}

/** The table's header settings (`[headercolor: #...]`) rewritten, its name and alias untouched. */
export function setTableColor(text: string, ref: TableRef, color: string | undefined): string {
  const schema = parse(text);
  const table = tableOf(schema, ref);
  const tokens = names(text);
  const after = tokens.findIndex((t) => t.start >= table.nameRange!.end);
  const open = tokens.findIndex((t, i) => i >= after && isPunct(t, '{'));
  const bracket = tokens.findIndex((t, i) => i >= after && i < open && isPunct(t, '['));
  if (bracket < 0) return color ? splice(text, [{ start: tokens[open]!.start, end: tokens[open]!.start, text: `[headercolor: ${color}] ` }]) : text;
  const close = tokens.findIndex((t, i) => i > bracket && isPunct(t, ']'));
  // Keep every other setting as written; replace or drop the colour.
  const settings: string[] = [];
  let part = '';
  let start = tokens[bracket]!.end;
  for (let i = bracket + 1; i <= close; i++) {
    const t = tokens[i]!;
    if (isPunct(t, ',') || i === close) {
      part = text.slice(start, t.start).trim();
      if (part && !/^headercolor\s*:/i.test(part)) settings.push(part);
      start = t.end;
    }
  }
  if (color) settings.unshift(`headercolor: ${color}`);
  const from = /\s*$/.exec(text.slice(0, tokens[bracket]!.start))!.index;
  return splice(text, [{ start: from, end: tokens[close]!.end, text: settings.length ? ` [${settings.join(', ')}]` : '' }]);
}

/** The table's `Note:` set, replaced or removed, inside its body. */
export function setTableNote(text: string, ref: TableRef, note: string | undefined): string {
  const schema = parse(text);
  const table = tableOf(schema, ref);
  const tokens = lex(text).tokens;
  // A `Note:` (or `note:`) at the top level of the table's body.
  let depth = 0;
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]!;
    if (t.start < table.range!.start || t.end > table.range!.end) continue;
    if (isPunct(t, '{')) depth++;
    else if (isPunct(t, '}')) depth--;
    else if (depth === 1 && t.kind === 'ident' && t.value.toLowerCase() === 'note' && (tokens[i - 1]?.kind === 'newline' || isPunct(tokens[i - 1], '{'))) {
      const value = tokens[i + 1] && isPunct(tokens[i + 1], ':') ? tokens[i + 2]! : undefined;
      if (!value) continue;
      if (note == null) return splice(text, [{ ...wholeLines(text, t.start, value.end), text: '' }]);
      return splice(text, [{ start: value.start, end: value.end, text: dbmlString(note, indentAt(text, t.start)) }]);
    }
  }
  if (note == null) return text;
  const close = text.lastIndexOf('}', table.range!.end);
  const before = text.slice(0, close).replace(/[ \t]*$/, '');
  return `${before}${before.endsWith('\n') ? '' : '\n'}\n  Note: ${dbmlString(note, '  ')}\n${text.slice(close)}`;
}

// ---- groups and notes ----

/** Move a table into a group (out of any other), or out of every group with `group` undefined. */
export function moveToGroup(text: string, ref: TableRef, group: string | undefined): string {
  const schema = parse(text);
  tableOf(schema, ref);
  let next = splice(text, groupMembership(text, schema, ref));
  if (group == null) return next;
  const g = parse(next).groups.find((x) => x.name === group);
  if (!g?.range) return append(next, `TableGroup ${dbmlName(group)} {\n  ${tableText(ref)}\n}`);
  const close = next.lastIndexOf('}', g.range.end);
  const before = next.slice(0, close).replace(/[ \t]*$/, '');
  next = `${before}${before.endsWith('\n') ? '' : '\n'}  ${tableText(ref)}\n${next.slice(close)}`;
  return next;
}

/** A new group of tables, each taken out of the group it was in. */
export function createGroup(text: string, name: string, tables: TableRef[]): string {
  if (parse(text).groups.some((g) => g.name === name)) throw new Error(`There is already a group called ${name}.`);
  let next = text;
  for (const t of tables) next = splice(next, groupMembership(next, parse(next), t));
  return append(next, `TableGroup ${dbmlName(name)} {\n${tables.map((t) => `  ${tableText(t)}`).join('\n')}\n}`);
}

/** A sticky note at the end. */
export function addStickyNote(text: string, name: string, body: string): string {
  if (parse(text).notes.some((n) => n.name === name)) throw new Error(`There is already a note called ${name}.`);
  return append(text, `Note ${dbmlName(name)} {\n  ${dbmlString(body, '  ')}\n}`);
}

/** The first of `base`, `base 2`, `base 3`... that `taken` doesn't have. */
export function freeName(base: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  for (let i = 1; ; i++) {
    const name = i === 1 ? base : `${base}_${i}`;
    if (!used.has(name)) return name;
  }
}

/** A default as typed: a number, true, false or null as they are, a `backtick` expression, anything else a string; blank is none. */
export function parseDefault(text: string): Column['default'] {
  const t = text.trim();
  if (!t) return undefined;
  if (/^-?\d+(\.\d+)?$/.test(t)) return { kind: 'number', value: t };
  if (/^(true|false)$/i.test(t)) return { kind: 'boolean', value: t.toLowerCase() };
  if (/^null$/i.test(t)) return { kind: 'null', value: 'null' };
  if (/^`.*`$/.test(t)) return { kind: 'expression', value: t.slice(1, -1) };
  const quoted = /^'(.*)'$/.exec(t) ?? /^"(.*)"$/.exec(t);
  return { kind: 'string', value: quoted ? quoted[1]! : t };
}

/** "email varchar(255)": a new column's name and type as typed; the type is varchar when none is given. */
export function parseNewColumn(text: string): { name: string; type: string } | undefined {
  const m = /^\s*("[^"]+"|\S+)\s*(.*)$/.exec(text);
  if (!m || !m[1]) return undefined;
  const name = m[1].startsWith('"') ? m[1].slice(1, -1) : m[1];
  return { name, type: m[2]!.trim() || 'varchar' };
}

/** The default as it is typed back into the box: what parseDefault reads. */
export const defaultText = (d: Column['default']) => (!d ? '' : d.kind === 'expression' ? `\`${d.value}\`` : d.value);
