// Reading the inside of a CREATE TABLE (and what ALTER TABLE adds) into the schema model: column definitions with
// their types and settings, and table constraints (keys, foreign keys, checks, indexes). Anything it doesn't know on a
// column or a table line is left out with a warning naming the table and column, so the rest of the table still reads.
import type { Column, Default, Index, IndexPart, RefAction, Table } from '../model';
import { Cursor, splitTop, unwrap } from './cursor';
import type { SqlDialect } from './dialect';
import type { Token } from './lexer';

/** A foreign key as read: resolved against the tables (and its op worked out) once the whole script is read. */
export interface PendingRef {
  name?: string;
  from: { schema: string; table: string; columns: string[] };
  /** No columns: the referenced table's primary key. */
  to: { schema: string; table: string; columns: string[] };
  delete?: RefAction;
  update?: RefAction;
  line: number;
}

/** What the table reader needs from the statement reader. */
export interface TableContext {
  dialect: SqlDialect;
  refs: PendingRef[];
  warn(message: string, line: number): void;
  /** A dotted name as a schema and name, the dialect's default schema read as DBML's `public`. */
  resolve(parts: string[]): { schema: string; name: string };
}

const words = (list: string) => new Set(list.split(' '));

/** Words that start a column setting; a type ends at the first of them. */
const COLUMN_SETTINGS = words(
  'CONSTRAINT NOT NULL PRIMARY UNIQUE DEFAULT CHECK REFERENCES IDENTITY AUTO_INCREMENT AUTOINCREMENT GENERATED AS COLLATE CHARSET COMMENT ON ' +
    'ROWGUIDCOL SPARSE FILESTREAM VISIBLE INVISIBLE MASKED ENCODE',
);
/** Settings that change nothing DBML holds. */
const IGNORED = words('ASC DESC ROWGUIDCOL SPARSE FILESTREAM VISIBLE INVISIBLE PERSISTED STORED VIRTUAL');
/** Words that end a DEFAULT value. */
const DEFAULT_ENDS = words('NOT NULL PRIMARY UNIQUE CHECK REFERENCES CONSTRAINT COLLATE COMMENT ON GENERATED IDENTITY AUTO_INCREMENT AUTOINCREMENT FOR WITH');

/** Words that continue a multi-word type (`double precision`, `timestamp with time zone`, `int unsigned`); others end it. */
const TYPE_WORDS = words(
  'VARYING PRECISION WITH WITHOUT TIME ZONE LOCAL UNSIGNED SIGNED ZEROFILL CHARACTER CHAR VARCHAR BIG INT INTEGER YEAR MONTH DAY HOUR MINUTE SECOND TO LARGE OBJECT BINARY VARBINARY TEXT NATIONAL NATIVE',
);

const SERIALS: Record<string, string> = { serial: 'integer', serial4: 'integer', bigserial: 'bigint', serial8: 'bigint', smallserial: 'smallint', serial2: 'smallint' };

/** Whether the cursor is at a word in the set (CHARACTER only as CHARACTER SET). */
function atSetting(c: Cursor, set: Set<string>): boolean {
  const t = c.peek();
  if (!t || t.kind !== 'word') return false;
  const w = t.value.toUpperCase();
  return set.has(w) || (w === 'CHARACTER' && c.isWord('SET', 1));
}

/** Tokens up to the first word of `ends` outside parentheses (never the first token). */
function until(c: Cursor, ends: Set<string>): Token[] {
  const out: Token[] = [];
  let depth = 0;
  while (!c.done) {
    const t = c.peek()!;
    if (depth === 0 && out.length && t.kind === 'word' && ends.has(t.value.toUpperCase())) break;
    if (t.kind === 'punct' && t.value === '(') depth++;
    if (t.kind === 'punct' && t.value === ')') depth--;
    out.push(c.next()!);
  }
  return out;
}

/** A column's type as written: words, a dotted name, `(…)` arguments and `[]`, with quoting removed. */
function readType(c: Cursor): string | undefined {
  const pieces: string[] = [];
  let joinNext = false;
  while (!c.done) {
    const t = c.peek()!;
    if (t.kind === 'word' && atSetting(c, COLUMN_SETTINGS)) break;
    const starts = pieces.length === 0 || joinNext;
    if ((t.kind === 'word' && (starts || TYPE_WORDS.has(t.value.toUpperCase()))) || (t.kind === 'ident' && starts)) {
      if (joinNext) pieces[pieces.length - 1] += t.value;
      else pieces.push(t.value);
      joinNext = false;
      c.next();
    } else if (t.kind === 'punct' && t.value === '.' && pieces.length) {
      pieces[pieces.length - 1] += '.';
      joinNext = true;
      c.next();
    } else if (t.kind === 'punct' && t.value === '(' && pieces.length) {
      const open = c.pos;
      c.group();
      pieces[pieces.length - 1] += c.text(c.tokens.slice(open, c.pos)).replace(/^\( /, '(').replace(/ \)$/, ')');
    } else if (t.kind === 'punct' && t.value === '[' && pieces.length) {
      let k = c.pos;
      while (k < c.tokens.length && c.tokens[k]!.value !== ']') k++;
      pieces[pieces.length - 1] += c.tokens.slice(c.pos, k + 1).map((x) => x.value).join('');
      c.pos = k + 1;
    } else break;
  }
  return pieces.length ? pieces.join(' ') : undefined;
}

/** A DEFAULT value: number, string, boolean, null or an expression; `nextval(…)` means the column increments. */
export function readDefault(tokens: Token[], source: string): { value?: Default; increment?: boolean } {
  let t = unwrap(tokens);
  const cast = t.findIndex((x) => x.kind === 'punct' && x.value === '::');
  const head = cast > 0 ? unwrap(t.slice(0, cast)) : t;
  const simple = (x: Token[]) => x.length === 1 && (x[0]!.kind === 'string' || x[0]!.kind === 'number' || /^null$/i.test(x[0]!.value));
  if (cast > 0 && simple(head)) t = head;
  if (t.length === 2 && t[0]!.kind === 'punct' && (t[0]!.value === '-' || t[0]!.value === '+') && t[1]!.kind === 'number') {
    return { value: { kind: 'number', value: (t[0]!.value === '-' ? '-' : '') + t[1]!.value } };
  }
  if (t.length === 1) {
    const x = t[0]!;
    const raw = source.slice(x.start, x.end);
    if (x.kind === 'number' && !/^0x/i.test(x.value)) return { value: { kind: 'number', value: x.value } };
    if (x.kind === 'string' && /^[NnEe]?'/.test(raw)) return { value: { kind: 'string', value: x.value } };
    if (x.kind === 'word' && /^(true|false)$/i.test(x.value)) return { value: { kind: 'boolean', value: x.value.toLowerCase() } };
    if (x.kind === 'word' && /^null$/i.test(x.value)) return { value: { kind: 'null', value: 'null' } };
  }
  if (t[0]?.kind === 'word' && /^nextval$/i.test(t[0].value)) return { increment: true };
  return { value: { kind: 'expression', value: new Cursor(t, source).text(t) } };
}

/** A referential action: CASCADE, RESTRICT, SET NULL, SET DEFAULT or NO ACTION. */
function readAction(c: Cursor): RefAction | undefined {
  if (c.eat('CASCADE')) return 'cascade';
  if (c.eat('RESTRICT')) return 'restrict';
  if (c.eat('SET', 'NULL')) return 'set null';
  if (c.eat('SET', 'DEFAULT')) return 'set default';
  if (c.eat('NO', 'ACTION')) return 'no action';
  c.next();
  return undefined;
}

/** `REFERENCES table [(columns)]` and its ON DELETE, ON UPDATE, MATCH and DEFERRABLE clauses. */
function readReferences(c: Cursor, ctx: TableContext, table: Table, from: string[], name: string | undefined, line: number): void {
  const target = c.qualifiedName();
  const cols = c.group();
  if (!target) {
    ctx.warn(`Skipped a foreign key on table "${table.name}" that names no table`, line);
    return;
  }
  const to = ctx.resolve(target);
  const ref: PendingRef = { from: { schema: table.schema, table: table.name, columns: from }, to: { schema: to.schema, table: to.name, columns: cols ? splitTop(cols).map((x) => x[0]!.value) : [] }, line };
  if (name !== undefined) ref.name = name;
  for (;;) {
    if (c.eat('ON', 'DELETE')) {
      const a = readAction(c);
      if (a) ref.delete = a;
    } else if (c.eat('ON', 'UPDATE')) {
      const a = readAction(c);
      if (a) ref.update = a;
    } else if (c.eat('MATCH') || c.eat('INITIALLY')) c.next();
    else if (!(c.eat('DEFERRABLE') || c.eat('NOT', 'DEFERRABLE') || c.eat('NOT', 'FOR', 'REPLICATION') || c.eat('ENFORCED') || c.eat('NOT', 'ENFORCED'))) break;
  }
  ctx.refs.push(ref);
}

/** The first `max` characters of a clause, for a warning. */
function clip(s: string, max = 60): string {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

/** One column definition: name, type and settings. Undefined (with a warning) for a computed column, which has no type. */
export function readColumn(c: Cursor, table: Table, ctx: TableContext): Column | undefined {
  const name = c.name()!;
  const line = c.line;
  let type = readType(c);
  if (type === undefined && c.isWord('AS')) {
    ctx.warn(`Left out column "${name}" of table "${table.name}": it is computed, and DBML has no computed columns`, line);
    return undefined;
  }
  const col: Column = { name, type: type ?? 'blob', pk: false, unique: false, increment: false, checks: [], properties: {} };
  if (type === undefined) {
    if (ctx.dialect !== 'sqlite') ctx.warn(`Column "${name}" of table "${table.name}" has no type; read as blob`, line);
  } else {
    const dot = type.indexOf('.');
    if (dot > 0 && !type.slice(0, dot).includes('(') && ctx.resolve([type.slice(0, dot), 'x']).schema === 'public') type = type.slice(dot + 1);
    const serial = SERIALS[type.toLowerCase()];
    if (serial) {
      type = serial;
      col.increment = true;
    }
    col.type = type;
  }

  let constraint: string | undefined;
  while (!c.done) {
    const at = c.line;
    const named = constraint;
    constraint = undefined;
    if (c.eat('CONSTRAINT')) constraint = c.name();
    else if (c.eat('NOT', 'FOR', 'REPLICATION')) continue;
    else if (c.eat('NOT', 'NULL')) col.notNull = true;
    else if (c.eat('NULL')) col.notNull ??= false;
    else if (c.eat('PRIMARY', 'KEY')) {
      col.pk = true;
      while (c.eat('ASC') || c.eat('DESC') || c.eat('CLUSTERED') || c.eat('NONCLUSTERED'));
      if (c.eat('AUTOINCREMENT')) col.increment = true;
    } else if (c.eat('UNIQUE')) {
      c.eat('KEY');
      col.unique = true;
      while (c.eat('CLUSTERED') || c.eat('NONCLUSTERED'));
    } else if (c.eat('DEFAULT')) {
      const d = readDefault(until(c, DEFAULT_ENDS), c.source);
      if (d.increment) col.increment = true;
      if (d.value) col.default = d.value;
    } else if (c.eat('CHECK')) {
      c.eat('NOT', 'FOR', 'REPLICATION');
      const g = c.group();
      if (g) col.checks.push(c.text(unwrap(g)));
    } else if (c.eat('REFERENCES')) readReferences(c, ctx, table, [name], named, at);
    else if (c.eat('IDENTITY')) {
      c.group();
      col.increment = true;
    } else if (c.eat('AUTO_INCREMENT') || c.eat('AUTOINCREMENT')) col.increment = true;
    else if (c.eat('GENERATED')) {
      if (!c.eat('ALWAYS')) c.eat('BY', 'DEFAULT');
      c.eat('ON', 'NULL');
      if (c.eat('AS', 'IDENTITY')) {
        c.group();
        col.increment = true;
      } else if (c.eat('AS')) {
        c.group();
        ctx.warn(`Left out the generated expression of column "${name}" of table "${table.name}"`, at);
      }
    } else if (c.eat('AS')) {
      c.group();
      ctx.warn(`Left out the generated expression of column "${name}" of table "${table.name}"`, at);
    } else if (c.eat('COLLATE') || c.eat('CHARACTER', 'SET') || c.eat('CHARSET') || c.eat('ON', 'CONFLICT') || c.eat('ENCODE')) c.name();
    else if (c.eat('COMMENT')) {
      const t = c.next();
      if (t?.kind === 'string') col.note = t.value;
    } else if (c.eat('ON', 'UPDATE')) until(c, DEFAULT_ENDS);
    else if (c.peek()?.kind === 'word' && IGNORED.has(c.peek()!.value.toUpperCase())) c.next();
    else {
      const start = c.pos;
      let depth = 0;
      while (!c.done && (depth > 0 || c.pos === start || !atSetting(c, COLUMN_SETTINGS))) {
        const t = c.next()!;
        if (t.kind === 'punct' && t.value === '(') depth++;
        if (t.kind === 'punct' && t.value === ')') depth--;
      }
      ctx.warn(`Skipped an unrecognised clause on column "${name}" of table "${table.name}": ${clip(c.text(c.tokens.slice(start, c.pos)))}`, at);
    }
  }
  return col;
}

/** The columns and expressions of a key or index: `(a, b)`, `(lower(email))`, `([id] ASC)`, `(name(10))`. */
export function indexParts(c: Cursor, tokens: Token[]): IndexPart[] {
  return splitTop(tokens).map((item) => {
    const [first, second, third, fourth] = item;
    const prefix = second?.value === '(' && third?.kind === 'number' && fourth?.value === ')';
    const rest = item.slice(prefix ? 4 : 1);
    const column = (first!.kind === 'word' || first!.kind === 'ident') && rest.every((x) => x.kind === 'word' || x.kind === 'ident');
    return column ? { kind: 'column', value: first!.value } : { kind: 'expression', value: c.text(unwrap(item)) };
  });
}

/** The table's column with this name, any case. */
export const columnOf = (table: Table, name: string) => table.columns.find((x) => x.name === name) ?? table.columns.find((x) => x.name.toLowerCase() === name.toLowerCase());

/** A key or index on the table: one column's flag for a one-column primary or unique key, an index otherwise. */
export function addKey(
  table: Table,
  ctx: TableContext,
  key: { kind: 'pk' | 'unique' | 'index'; parts: IndexPart[]; name?: string; type?: string; note?: string; index?: boolean },
  line: number,
): void {
  const parts: IndexPart[] = [];
  for (const p of key.parts) {
    if (p.kind === 'expression') parts.push(p);
    else {
      const col = columnOf(table, p.value);
      if (!col) {
        ctx.warn(`Skipped a key on table "${table.name}": it has no column "${p.value}"`, line);
        return;
      }
      parts.push({ kind: 'column', value: col.name });
    }
  }
  if (!parts.length) return;
  if (key.kind !== 'index' && !key.index && parts.length === 1 && parts[0]!.kind === 'column') {
    const col = columnOf(table, parts[0]!.value)!;
    if (key.kind === 'pk') col.pk = true;
    else col.unique = true;
    return;
  }
  const ix: Index = { parts, unique: key.kind === 'unique', pk: key.kind === 'pk' };
  if (key.name !== undefined) ix.name = key.name;
  if (key.type !== undefined) ix.type = key.type.toLowerCase();
  if (key.note !== undefined) ix.note = key.note;
  table.indexes.push(ix);
}

/** Whether the cursor is at a table constraint rather than a column (whose name could be KEY, INDEX or UNIQUE). */
export function atConstraint(c: Cursor): boolean {
  if (c.isWord('CONSTRAINT') || c.isWord('PRIMARY') || c.isWord('FOREIGN')) return c.peek(1)?.kind === 'word' || c.peek(1)?.kind === 'ident';
  if (c.isWord('CHECK') || c.isWord('EXCLUDE')) return c.isPunct('(', 1) || c.isWord('USING', 1) || c.isWord('NOT', 1);
  if (c.isWord('UNIQUE') || c.isWord('KEY') || c.isWord('INDEX') || c.isWord('FULLTEXT') || c.isWord('SPATIAL')) {
    if (c.isPunct('(', 1) || c.isWord('USING', 1) || c.isWord('KEY', 1) || c.isWord('INDEX', 1) || c.isWord('CLUSTERED', 1) || c.isWord('NONCLUSTERED', 1)) return true;
    const named = c.peek(1)?.kind === 'word' || c.peek(1)?.kind === 'ident';
    return named && (c.isPunct('(', 2) || c.isWord('USING', 2));
  }
  return false;
}

/** The index method and comment that follow an index's columns in MySQL (`USING BTREE COMMENT '…'`). */
function indexOptions(c: Cursor, key: { type?: string; note?: string }): void {
  while (!c.done) {
    if (c.eat('USING', 'INDEX')) continue;
    if (c.eat('USING')) key.type = c.name();
    else if (c.eat('COMMENT')) {
      const t = c.next();
      if (t?.kind === 'string') key.note = t.value;
    } else c.next();
  }
}

/** A table constraint or index line, from a CREATE TABLE body or an ALTER TABLE ADD; false when it is a column instead. */
export function readConstraint(c: Cursor, table: Table, ctx: TableContext): boolean {
  if (!atConstraint(c) && !c.isWord('DEFAULT')) return false;
  const line = c.line;
  let name: string | undefined;
  if (c.eat('CONSTRAINT')) name = c.name();
  const skipKind = () => {
    while (c.eat('CLUSTERED') || c.eat('NONCLUSTERED') || c.eat('KEY') || c.eat('INDEX'));
  };

  if (c.eat('PRIMARY', 'KEY')) {
    skipKind();
    if (!c.isPunct('(') && !c.isWord('USING')) c.name();
    const key: { kind: 'pk'; parts: IndexPart[]; type?: string; name?: string } = { kind: 'pk', parts: [] };
    if (c.eat('USING')) key.type = c.name();
    key.parts = indexParts(c, c.group() ?? []);
    if (name !== undefined) key.name = name;
    addKey(table, ctx, key, line);
    return true;
  }
  if (c.eat('UNIQUE')) {
    skipKind();
    const key: { kind: 'unique'; parts: IndexPart[]; name?: string; type?: string; note?: string } = { kind: 'unique', parts: [] };
    const indexName = !c.isPunct('(') && !c.isWord('USING') ? c.name() : undefined;
    if (indexName ?? name) key.name = (indexName ?? name)!;
    if (c.eat('USING')) key.type = c.name();
    key.parts = indexParts(c, c.group() ?? []);
    indexOptions(c, key);
    addKey(table, ctx, key, line);
    return true;
  }
  if (c.eat('FOREIGN', 'KEY')) {
    if (!c.isPunct('(')) c.name();
    const cols = splitTop(c.group() ?? []).map((x) => x[0]!.value);
    if (!c.eat('REFERENCES')) {
      ctx.warn(`Skipped a foreign key on table "${table.name}" with no REFERENCES`, line);
      return true;
    }
    readReferences(c, ctx, table, cols, name, line);
    return true;
  }
  if (c.eat('CHECK')) {
    c.eat('NOT', 'FOR', 'REPLICATION');
    const g = c.group();
    if (g) table.checks.push(name !== undefined ? { expression: c.text(unwrap(g)), name } : { expression: c.text(unwrap(g)) });
    return true;
  }
  if (c.isWord('KEY') || c.isWord('INDEX') || c.isWord('FULLTEXT') || c.isWord('SPATIAL')) {
    const kind = c.next()!.value.toLowerCase();
    skipKind();
    const key: { kind: 'index'; parts: IndexPart[]; name?: string; type?: string; note?: string } = { kind: 'index', parts: [] };
    if (kind === 'fulltext' || kind === 'spatial') key.type = kind;
    const indexName = !c.isPunct('(') && !c.isWord('USING') ? c.name() : undefined;
    if (indexName !== undefined) key.name = indexName;
    if (c.eat('USING')) key.type = c.name();
    key.parts = indexParts(c, c.group() ?? []);
    indexOptions(c, key);
    addKey(table, ctx, key, line);
    return true;
  }
  if (c.eat('DEFAULT')) {
    const d = readDefault(until(c, new Set(['FOR'])), c.source);
    if (!c.eat('FOR')) {
      ctx.warn(`Skipped a default on table "${table.name}" that names no column`, line);
      return true;
    }
    const colName = c.name() ?? '';
    const col = columnOf(table, colName);
    if (!col) ctx.warn(`Skipped a default on table "${table.name}": it has no column "${colName}"`, line);
    else {
      if (d.increment) col.increment = true;
      if (d.value) col.default = d.value;
    }
    return true;
  }
  ctx.warn(`Skipped an unrecognised line in table "${table.name}": ${clip(c.text(c.rest()))}`, line);
  return true;
}
