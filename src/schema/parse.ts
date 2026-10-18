// DBML text to the schema model (dbml.dbdiagram.io/docs). The parser recovers after a mistake: a bad line is reported
// and skipped, and an element that can't be read is skipped to the next one, so the rest of the text still gives
// tables. Names are resolved after the whole text is read (aliases, partials, inline refs, records), so elements can
// refer to ones written later.
import { lex, type Token } from './lexer';
import {
  DEFAULT_SCHEMA,
  REF_ACTIONS,
  emptySchema,
  qualified,
  tableKey,
  type Check,
  type Column,
  type DbmlSchema,
  type Default,
  type DiagramView,
  type Endpoint,
  type Index,
  type IndexPart,
  type Range,
  type RecordValue,
  type Records,
  type Ref,
  type RefAction,
  type RefOp,
  type Table,
  type TablePartial,
} from './model';

export interface SchemaError {
  message: string;
  start: number;
  end: number;
  /** 1-based. */
  line: number;
  /** 1-based. */
  column: number;
}

export interface ParseResult {
  schema: DbmlSchema;
  errors: SchemaError[];
}

class Failure extends Error {
  constructor(
    message: string,
    readonly start: number,
    readonly end: number,
  ) {
    super(message);
  }
}

interface Setting {
  key: string;
  value: Token[];
  start: number;
  end: number;
}

interface RawEndpoint {
  parts: string[];
  columns: string[];
  start: number;
  end: number;
}

interface PendingRef {
  name?: string;
  from: RawEndpoint;
  to: RawEndpoint;
  op: RefOp;
  fromOptional: boolean;
  toOptional: boolean;
  settings: Partial<Pick<Ref, 'delete' | 'update' | 'color' | 'inactive'>>;
  inline?: { table: Table; column: string };
  range: Range;
}

interface PendingRecords {
  parts: string[];
  table?: Table;
  columns?: string[];
  example: boolean;
  rows: { values: RecordValue[]; start: number; end: number }[];
  range: Range;
}

interface PendingTable {
  table: Table;
  /** Own columns and injections in source order. */
  items: ({ column: Column } | { partial: string; start: number; end: number })[];
  ownIndexes: Index[];
  ownChecks: Check[];
  own: { headerColor?: string; note?: string; properties: Record<string, string> };
}

interface PendingGroupEntry {
  parts: string[];
  start: number;
  end: number;
}

interface Metadata {
  kind: string;
  target: string[];
  values: { key: string; value: string }[];
  start: number;
  end: number;
}

/** Top-level keywords, lower case. */
const TOP = new Set(['project', 'table', 'tablepartial', 'ref', 'enum', 'tablegroup', 'note', 'records', 'diagramview', 'metadata', 'use']);
const ACTIONS = new Set<string>(REF_ACTIONS);

/** Line and column (1-based) of an offset. */
export function position(text: string, offset: number): { line: number; column: number } {
  let line = 1;
  let lineStart = 0;
  for (let i = 0; i < offset && i < text.length; i++) {
    if (text[i] === '\n') {
      line++;
      lineStart = i + 1;
    }
  }
  return { line, column: offset - lineStart + 1 };
}

class Parser {
  i = 0;
  readonly errors: { message: string; start: number; end: number }[] = [];

  constructor(
    readonly tokens: Token[],
    readonly text: string,
  ) {}

  peek(k = 0): Token {
    return this.tokens[Math.min(this.i + k, this.tokens.length - 1)]!;
  }

  next(): Token {
    const t = this.peek();
    if (t.kind !== 'eof') this.i++;
    return t;
  }

  prev(): Token {
    return this.tokens[Math.max(0, this.i - 1)]!;
  }

  is(t: Token, kind: Token['kind'], value?: string): boolean {
    return t.kind === kind && (value === undefined || t.value === value);
  }

  isPunct(value: string, k = 0): boolean {
    return this.is(this.peek(k), 'punct', value);
  }

  isWord(word: string, k = 0): boolean {
    const t = this.peek(k);
    return t.kind === 'ident' && t.value.toLowerCase() === word;
  }

  skipNewlines(): void {
    while (this.peek().kind === 'newline') this.i++;
  }

  fail(message: string, t: Token = this.peek()): never {
    throw new Failure(message, t.start, Math.max(t.end, t.start + 1));
  }

  describe(t: Token): string {
    if (t.kind === 'eof') return 'the end of the text';
    if (t.kind === 'newline') return 'the end of the line';
    if (t.kind === 'string' || t.kind === 'triple') return 'a string';
    if (t.kind === 'expr') return 'an expression';
    return `"${t.value}"`;
  }

  expectPunct(value: string, what?: string): Token {
    if (!this.isPunct(value)) this.fail(`Expected ${what ?? `"${value}"`} but found ${this.describe(this.peek())}`);
    return this.next();
  }

  /** A name: a bare word or a double-quoted name. */
  name(what = 'a name'): Token {
    const t = this.peek();
    if (t.kind === 'ident' || t.kind === 'quoted') return this.next();
    this.fail(`Expected ${what} but found ${this.describe(t)}`);
  }

  /** `a.b.c` as its parts. */
  dotted(what = 'a name'): { parts: string[]; start: number; end: number } {
    const first = this.name(what);
    const parts = [first.value];
    let end = first.end;
    while (this.isPunct('.') && (this.peek(1).kind === 'ident' || this.peek(1).kind === 'quoted')) {
      this.next();
      const t = this.next();
      parts.push(t.value);
      end = t.end;
    }
    return { parts, start: first.start, end };
  }

  /** The end of an item: a newline, or a closing brace or the end of the text, which the caller reads. */
  endOfItem(): void {
    const t = this.peek();
    if (t.kind === 'newline') this.next();
    else if (!(t.kind === 'eof' || this.is(t, 'punct', '}') || this.prev().kind === 'newline')) this.fail(`Expected the end of the line but found ${this.describe(t)}`);
  }

  /** After a bad item: skip to the end of its line, or to the brace that closes the block it's in. */
  skipLine(): void {
    let depth = 0;
    for (;;) {
      const t = this.peek();
      if (t.kind === 'eof') return;
      if (depth === 0 && t.kind === 'newline') {
        this.next();
        return;
      }
      if (depth === 0 && this.is(t, 'punct', '}')) return;
      if (t.kind === 'punct' && '{[('.includes(t.value)) depth++;
      if (t.kind === 'punct' && '}])'.includes(t.value)) depth--;
      this.next();
    }
  }

  /** After a bad element: skip to the next line that starts with a top-level keyword outside any braces. */
  skipElement(): void {
    let depth = 0;
    let lineStart = false;
    for (;;) {
      const t = this.peek();
      if (t.kind === 'eof') return;
      if (depth <= 0 && lineStart && t.kind === 'ident' && TOP.has(t.value.toLowerCase())) return;
      lineStart = t.kind === 'newline';
      if (this.is(t, 'punct', '{')) depth++;
      if (this.is(t, 'punct', '}')) depth--;
      this.next();
    }
  }

  /**
   * Whether the line starting here opens a top-level element (`Table x {`, `Ref: ...`): in a block, that means the
   * block was never closed.
   */
  looksTopLevel(): boolean {
    const t = this.peek();
    if (t.kind !== 'ident') return false;
    const word = t.value.toLowerCase();
    if (!['table', 'tablepartial', 'ref', 'enum', 'tablegroup', 'project', 'diagramview', 'metadata'].includes(word)) return false;
    for (let k = 1; ; k++) {
      const u = this.peek(k);
      if (u.kind === 'newline' || u.kind === 'eof') return false;
      if (this.is(u, 'punct', '{')) return true;
      if (word === 'ref' && this.is(u, 'punct', ':') && k <= 2) return true;
      if (this.is(u, 'punct', '[')) return false;
    }
  }

  /** `{ item \n item \n }`: each item read by `item`, a bad one reported and skipped. */
  block(what: string, open: Token, item: () => void): number {
    this.expectPunct('{');
    for (;;) {
      this.skipNewlines();
      const t = this.peek();
      if (this.is(t, 'punct', '}')) return this.next().end;
      if (t.kind === 'eof' || this.looksTopLevel()) {
        this.errors.push({ message: `${what} is never closed with }`, start: open.start, end: open.end });
        return this.prev().end;
      }
      try {
        item();
        this.endOfItem();
      } catch (e) {
        if (!(e instanceof Failure)) throw e;
        this.errors.push({ message: e.message, start: e.start, end: e.end });
        this.skipLine();
      }
    }
  }

  /** `[a, b: c, not null]`, the bracket being next. */
  settings(): Setting[] {
    const open = this.expectPunct('[');
    const out: Setting[] = [];
    for (;;) {
      this.skipNewlines();
      if (this.isPunct(']')) {
        this.next();
        return out;
      }
      if (this.peek().kind === 'eof' || this.isPunct('{') || this.isPunct('}')) throw new Failure('These settings are never closed with ]', open.start, open.end);
      const keyStart = this.peek();
      const words: string[] = [];
      while (this.peek().kind === 'ident' || this.peek().kind === 'quoted') words.push(this.next().value.toLowerCase());
      if (!words.length) this.fail(`Expected a setting but found ${this.describe(this.peek())}`);
      const value: Token[] = [];
      if (this.isPunct(':')) {
        this.next();
        let depth = 0;
        for (;;) {
          const t = this.peek();
          if (t.kind === 'eof' || this.is(t, 'punct', '{') || this.is(t, 'punct', '}')) throw new Failure('These settings are never closed with ]', open.start, open.end);
          if (t.kind === 'newline') {
            this.next();
            continue;
          }
          if (depth === 0 && t.kind === 'punct' && (t.value === ',' || t.value === ']')) break;
          if (t.kind === 'punct' && (t.value === '(' || t.value === '[')) depth++;
          if (t.kind === 'punct' && (t.value === ')' || t.value === ']')) depth--;
          value.push(this.next());
        }
        if (!value.length) this.fail(`The setting "${words.join(' ')}" has no value`);
      }
      out.push({ key: words.join(' '), value, start: keyStart.start, end: this.prev().end });
      this.skipNewlines();
      if (this.isPunct(',')) this.next();
      else if (!this.isPunct(']')) this.fail(`Expected "," or "]" but found ${this.describe(this.peek())}`);
    }
  }

  // ---- values of settings ----

  string(s: Setting): string {
    const [t, extra] = s.value;
    if (!t || extra || !(t.kind === 'string' || t.kind === 'triple' || t.kind === 'quoted'))
      throw new Failure(`The setting "${s.key}" takes a quoted string`, s.start, s.end);
    return t.value;
  }

  /** A string or colour, as custom properties take. */
  property(s: Setting): string {
    const [t, extra] = s.value;
    if (t && !extra && t.kind === 'color') return t.value;
    if (t && !extra && (t.kind === 'ident' || t.kind === 'number')) return t.value;
    if (!s.value.length) throw new Failure(`The property "${s.key}" has no value`, s.start, s.end);
    return this.string(s);
  }

  color(s: Setting, allowNone = false): string {
    const [t, extra] = s.value;
    if (t && !extra && t.kind === 'color' && /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(t.value)) return t.value;
    if (t && !extra && allowNone && t.kind === 'ident' && t.value.toLowerCase() === 'none') return 'none';
    throw new Failure(`The setting "${s.key}" takes a colour such as #3498DB`, s.start, s.end);
  }

  words(s: Setting): string {
    if (!s.value.every((t) => t.kind === 'ident')) throw new Failure(`The setting "${s.key}" takes a word`, s.start, s.end);
    return s.value.map((t) => t.value.toLowerCase()).join(' ');
  }

  defaultValue(s: Setting): Default {
    const v = s.value;
    if (v.length === 2 && this.is(v[0]!, 'op', '-') && v[1]!.kind === 'number') return { kind: 'number', value: `-${v[1]!.value}` };
    const [t, extra] = v;
    if (t && !extra) {
      if (t.kind === 'number') return { kind: 'number', value: t.value };
      if (t.kind === 'string' || t.kind === 'triple') return { kind: 'string', value: t.value };
      if (t.kind === 'expr') return { kind: 'expression', value: t.value };
      if (t.kind === 'ident' && ['true', 'false'].includes(t.value.toLowerCase())) return { kind: 'boolean', value: t.value.toLowerCase() };
      if (t.kind === 'ident' && t.value.toLowerCase() === 'null') return { kind: 'null', value: 'null' };
    }
    throw new Failure('A default is a number, a quoted string, a `backtick expression`, true, false or null', s.start, s.end);
  }

  expression(s: Setting): string {
    const [t, extra] = s.value;
    if (!t || extra || t.kind !== 'expr') throw new Failure(`The setting "${s.key}" takes a \`backtick expression\``, s.start, s.end);
    return t.value;
  }

  flag(s: Setting): void {
    if (s.value.length) throw new Failure(`The setting "${s.key}" takes no value`, s.start, s.end);
  }

  /** Custom properties: any other key with a value. A key without one, or given twice, is a mistake. */
  custom(s: Setting, properties: Record<string, string>, what: string): void {
    if (!s.value.length) throw new Failure(`"${s.key}" isn't a ${what} setting`, s.start, s.end);
    if (s.key in properties) throw new Failure(`The property "${s.key}" is set twice`, s.start, s.end);
    properties[s.key] = this.property(s);
  }

  /** Read settings one by one, a bad one reported without losing the rest. */
  each(settings: Setting[], read: (s: Setting) => void): void {
    for (const s of settings) {
      try {
        read(s);
      } catch (e) {
        if (!(e instanceof Failure)) throw e;
        this.errors.push({ message: e.message, start: e.start, end: e.end });
      }
    }
  }

  // ---- refs ----

  endpoint(): RawEndpoint {
    const first = this.name('a table and column, such as users.id');
    const parts = [first.value];
    let end = first.end;
    let columns: string[] | undefined;
    while (this.isPunct('.')) {
      this.next();
      if (this.isPunct('(')) {
        this.next();
        columns = [];
        for (;;) {
          columns.push(this.name('a column').value);
          if (this.isPunct(',')) this.next();
          else break;
        }
        end = this.expectPunct(')').end;
        break;
      }
      const t = this.name('a column');
      parts.push(t.value);
      end = t.end;
    }
    if (!columns) {
      if (parts.length < 2) throw new Failure(`"${parts[0]}" needs its table and column, such as users.id`, first.start, end);
      columns = [parts.pop()!];
    }
    if (parts.length > 2) throw new Failure(`"${parts.join('.')}" has too many parts: write schema.table.column`, first.start, end);
    return { parts, columns, start: first.start, end };
  }

  refOp(): { op: RefOp; fromOptional: boolean; toOptional: boolean } {
    let fromOptional = false;
    let toOptional = false;
    if (this.isPunct('?')) {
      this.next();
      fromOptional = true;
    }
    const t = this.peek();
    if (t.kind !== 'op') this.fail(`Expected a relationship: <, >, - or <> but found ${this.describe(t)}`);
    this.next();
    if (this.isPunct('?')) {
      this.next();
      toOptional = true;
    }
    return { op: t.value as RefOp, fromOptional, toOptional };
  }

  refSettings(settings: Setting[]): PendingRef['settings'] {
    const out: PendingRef['settings'] = {};
    this.each(settings, (s) => {
      if (s.key === 'delete' || s.key === 'update') {
        const action = this.words(s);
        if (!ACTIONS.has(action)) throw new Failure(`"${action}" isn't an action: use cascade, restrict, set null, set default or no action`, s.start, s.end);
        out[s.key] = action as RefAction;
      } else if (s.key === 'color') out.color = this.color(s);
      else if (s.key === 'inactive') {
        this.flag(s);
        out.inactive = true;
      } else throw new Failure(`"${s.key}" isn't a relationship setting`, s.start, s.end);
    });
    return out;
  }

  /** `a.b > c.d [settings]`. */
  refLine(name: string | undefined, start: number): PendingRef {
    const from = this.endpoint();
    const op = this.refOp();
    const to = this.endpoint();
    const settings = this.isPunct('[') ? this.refSettings(this.settings()) : {};
    return { name, from, to, ...op, settings, range: { start, end: this.prev().end } };
  }
}

/** Parse DBML: the schema it describes, and every mistake found, with where it is. */
export function parseDbml(text: string): ParseResult {
  const { tokens, errors: lexErrors } = lex(text);
  const p = new Parser(tokens, text);
  p.errors.push(...lexErrors);
  const schema = emptySchema();
  const tables: PendingTable[] = [];
  const partials: TablePartial[] = [];
  const refs: PendingRef[] = [];
  const records: PendingRecords[] = [];
  const groupEntries = new Map<number, PendingGroupEntry[]>();
  const metadata: Metadata[] = [];

  // ---- columns, indexes and checks, shared by tables and partials ----

  function column(target: { table?: Table }, inlineRefs: PendingRef[]): Column {
    const name = p.name('a column name');
    const typeStart = p.peek();
    if (typeStart.kind !== 'ident' && typeStart.kind !== 'quoted') p.fail(`The column "${name.value}" needs a type, such as varchar or integer`);
    const typeParts = p.dotted('a type').parts;
    let type = typeParts.join('.');
    if (p.isPunct('(')) {
      const open = p.next();
      let depth = 1;
      while (depth > 0) {
        const t = p.next();
        if (t.kind === 'eof' || t.kind === 'newline') throw new Failure(`The type of "${name.value}" is never closed with )`, open.start, open.end);
        if (p.is(t, 'punct', '(')) depth++;
        if (p.is(t, 'punct', ')')) depth--;
      }
      type += text.slice(open.start, p.prev().end);
    }
    while (p.isPunct('[') && p.is(p.peek(1), 'punct', ']') && p.peek().start === p.prev().end) {
      p.next();
      p.next();
      type += '[]';
    }
    const col: Column = { name: name.value, type, pk: false, unique: false, increment: false, checks: [], properties: {}, nameRange: { start: name.start, end: name.end }, range: { start: name.start, end: 0 } };
    if (p.isPunct('[')) {
      p.each(p.settings(), (s) => {
        switch (s.key) {
          case 'pk':
          case 'primary key':
            p.flag(s);
            col.pk = true;
            break;
          case 'unique':
            p.flag(s);
            col.unique = true;
            break;
          case 'increment':
            p.flag(s);
            col.increment = true;
            break;
          case 'not null':
            p.flag(s);
            col.notNull = true;
            break;
          case 'null':
            p.flag(s);
            col.notNull = false;
            break;
          case 'default':
            col.default = p.defaultValue(s);
            break;
          case 'check':
            col.checks.push(p.expression(s));
            break;
          case 'note':
            col.note = p.string(s);
            break;
          case 'ref': {
            if (!target.table) throw new Failure('A partial column can’t have a ref; write it on the table', s.start, s.end);
            const sub = new Parser([...s.value, { kind: 'eof', value: '', start: s.end, end: s.end }], text);
            const op = sub.refOp();
            const to = sub.endpoint();
            if (sub.peek().kind !== 'eof') sub.fail(`Expected "," or "]" but found ${sub.describe(sub.peek())}`);
            if (to.columns.length > 1) throw new Failure('An inline ref takes one column; write a composite ref as Ref: a.(x, y) > b.(x, y)', s.start, s.end);
            inlineRefs.push({
              from: { parts: [], columns: [name.value], start: name.start, end: name.end },
              to,
              ...op,
              settings: {},
              inline: { table: target.table, column: name.value },
              range: { start: s.start, end: s.end },
            });
            break;
          }
          default:
            p.custom(s, col.properties, 'column');
        }
      });
    }
    col.range!.end = p.prev().end;
    return col;
  }

  function indexes(into: Index[]): void {
    const open = p.next();
    p.block('This indexes block', open, () => {
      const start = p.peek().start;
      const parts: IndexPart[] = [];
      const part = () => {
        const t = p.peek();
        if (t.kind === 'expr') parts.push({ kind: 'expression', value: p.next().value });
        else parts.push({ kind: 'column', value: p.name('a column or `expression`').value });
      };
      if (p.isPunct('(')) {
        p.next();
        for (;;) {
          part();
          if (p.isPunct(',')) p.next();
          else break;
        }
        p.expectPunct(')');
      } else part();
      const index: Index = { parts, unique: false, pk: false, range: { start, end: 0 } };
      if (p.isPunct('['))
        p.each(p.settings(), (s) => {
          if (s.key === 'pk' || s.key === 'unique') {
            p.flag(s);
            index[s.key] = true;
          }
          else if (s.key === 'name') index.name = p.string(s);
          else if (s.key === 'note') index.note = p.string(s);
          else if (s.key === 'type') index.type = p.words(s);
          else throw new Failure(`"${s.key}" isn't an index setting: use pk, unique, name, type or note`, s.start, s.end);
        });
      index.range!.end = p.prev().end;
      into.push(index);
    });
  }

  function checks(into: Check[]): void {
    const open = p.next();
    p.block('This checks block', open, () => {
      const t = p.peek();
      if (t.kind !== 'expr') p.fail(`Expected a \`backtick expression\` but found ${p.describe(t)}`);
      p.next();
      const check: Check = { expression: t.value, range: { start: t.start, end: 0 } };
      if (p.isPunct('['))
        p.each(p.settings(), (s) => {
          if (s.key === 'name') check.name = p.string(s);
          else throw new Failure(`"${s.key}" isn't a check setting: use name`, s.start, s.end);
        });
      check.range!.end = p.prev().end;
      into.push(check);
    });
  }

  /** `Note: 'text'` or `Note { 'text' }`, the Note keyword being next. */
  function noteValue(): string {
    const kw = p.next();
    if (p.isPunct(':')) {
      p.next();
      const t = p.peek();
      if (t.kind !== 'string' && t.kind !== 'triple') p.fail(`Expected a 'quoted' note but found ${p.describe(t)}`);
      return p.next().value;
    }
    let text = '';
    p.block('This note', kw, () => {
      const t = p.peek();
      if (t.kind !== 'string' && t.kind !== 'triple') p.fail(`Expected a 'quoted' note but found ${p.describe(t)}`);
      text = p.next().value;
    });
    return text;
  }

  const isNoteItem = () => p.isWord('note') && (p.isPunct(':', 1) || p.isPunct('{', 1));

  function tableSettings(settings: Setting[], own: PendingTable['own']): void {
    p.each(settings, (s) => {
      if (s.key === 'headercolor') own.headerColor = p.color(s);
      else if (s.key === 'note') own.note = p.string(s);
      else p.custom(s, own.properties, 'table');
    });
  }

  function recordRows(into: PendingRecords, open: Token): number {
    return p.block('These records', open, () => {
      const start = p.peek().start;
      const values: RecordValue[] = [];
      for (;;) {
        const t = p.peek();
        if (p.is(t, 'punct', ',') || t.kind === 'newline' || t.kind === 'eof' || p.is(t, 'punct', '}')) values.push({ kind: 'empty', value: '' });
        else if (p.is(t, 'op', '-') && p.peek(1).kind === 'number') {
          p.next();
          values.push({ kind: 'number', value: `-${p.next().value}` });
        } else if (t.kind === 'number') values.push({ kind: 'number', value: p.next().value });
        else if (t.kind === 'string' || t.kind === 'triple') values.push({ kind: 'string', value: p.next().value });
        else if (t.kind === 'expr') values.push({ kind: 'expression', value: p.next().value });
        else if (t.kind === 'ident' || t.kind === 'quoted') {
          const word = t.value.toLowerCase();
          if (t.kind === 'ident' && (word === 'true' || word === 'false') && !p.isPunct('.', 1)) values.push({ kind: 'boolean', value: (p.next(), word) });
          else if (t.kind === 'ident' && word === 'null' && !p.isPunct('.', 1)) values.push({ kind: 'null', value: (p.next(), 'null') });
          else values.push({ kind: 'enum', value: p.dotted('a value').parts.join('.') });
        } else p.fail(`Expected a value but found ${p.describe(t)}`);
        if (p.isPunct(',')) p.next();
        else break;
      }
      into.rows.push({ values, start, end: p.prev().end });
    });
  }

  /** `records [(cols)] [settings] { rows }` inside a table, or `records table(cols) ...` outside one. */
  function recordsBlock(inTable?: Table): void {
    const kw = p.next();
    const pending: PendingRecords = { parts: [], example: false, rows: [], range: { start: kw.start, end: 0 } };
    if (inTable) pending.table = inTable;
    else pending.parts = p.dotted('the table the records are for').parts;
    if (p.isPunct('(')) {
      p.next();
      pending.columns = [];
      for (;;) {
        pending.columns.push(p.name('a column').value);
        if (p.isPunct(',')) p.next();
        else break;
      }
      p.expectPunct(')');
    } else if (!inTable) p.fail('Records outside a table list their columns: records users(id, name) { ... }');
    if (p.isPunct('['))
      p.each(p.settings(), (s) => {
        if (s.key === 'example') {
          p.flag(s);
          pending.example = true;
        } else throw new Failure(`"${s.key}" isn't a records setting: use example`, s.start, s.end);
      });
    pending.range.end = recordRows(pending, kw);
    records.push(pending);
  }

  /** A table's or partial's body. */
  function tableBody(open: Token, pending: PendingTable | undefined, partial: TablePartial | undefined, inlineRefs: PendingRef[]): number {
    const own = pending?.own ?? (partial as TablePartial);
    let ownColumns = 0;
    return p.block(pending ? `The table "${pending.table.name}"` : `The partial "${partial!.name}"`, open, () => {
      if (isNoteItem()) {
        own.note = noteValue();
      } else if (p.isWord('indexes') && p.isPunct('{', 1)) {
        indexes(pending ? pending.ownIndexes : partial!.indexes);
      } else if (p.isWord('checks') && p.isPunct('{', 1)) {
        checks(pending ? pending.ownChecks : partial!.checks);
      } else if (p.isWord('records') && (p.isPunct('(', 1) || p.isPunct('[', 1) || p.isPunct('{', 1))) {
        if (!pending) throw new Failure('A partial can’t have records; write them on the table', p.peek().start, p.peek().end);
        recordsBlock(pending.table);
      } else if (p.isPunct('~')) {
        const tilde = p.next();
        const name = p.name('the name of a TablePartial');
        if (!pending) throw new Failure('A partial can’t inject another partial', tilde.start, name.end);
        pending.items.push({ partial: name.value, start: tilde.start, end: name.end });
        pending.table.partials.push({ name: name.value, at: ownColumns });
      } else {
        const col = column({ table: pending?.table }, inlineRefs);
        if (pending) pending.items.push({ column: col });
        else partial!.columns.push(col);
        ownColumns++;
      }
    });
  }

  // ---- top-level elements ----

  function table(kw: Token): void {
    const name = p.dotted('a table name');
    if (name.parts.length > 2) throw new Failure(`"${name.parts.join('.')}" has too many parts: write schema.table`, name.start, name.end);
    const [schemaName, tableName] = name.parts.length === 2 ? name.parts : [DEFAULT_SCHEMA, name.parts[0]!];
    const t: Table = { schema: schemaName!, name: tableName!, properties: {}, columns: [], indexes: [], checks: [], partials: [], range: { start: kw.start, end: 0 }, nameRange: { start: name.start, end: name.end } };
    if (p.isWord('as')) {
      p.next();
      t.alias = p.name('an alias').value;
    }
    const pending: PendingTable = { table: t, items: [], ownIndexes: [], ownChecks: [], own: { properties: {} } };
    if (p.isPunct('[')) tableSettings(p.settings(), pending.own);
    if (!p.isPunct('{')) p.fail(`Expected "{" to start the table "${t.name}" but found ${p.describe(p.peek())}`);
    const inline: PendingRef[] = [];
    t.range!.end = tableBody(p.peek(), pending, undefined, inline);
    tables.push(pending);
    refs.push(...inline);
  }

  function tablePartial(kw: Token): void {
    const name = p.name('a partial name');
    const partial: TablePartial = { name: name.value, properties: {}, columns: [], indexes: [], checks: [], range: { start: kw.start, end: 0 } };
    if (p.isPunct('[')) {
      const own = { properties: partial.properties } as PendingTable['own'];
      tableSettings(p.settings(), own);
      if (own.headerColor) partial.headerColor = own.headerColor;
      if (own.note) partial.note = own.note;
    }
    if (!p.isPunct('{')) p.fail(`Expected "{" to start the partial "${partial.name}" but found ${p.describe(p.peek())}`);
    partial.range!.end = tableBody(p.peek(), undefined, partial, []);
    partials.push(partial);
  }

  function ref(kw: Token): void {
    let name: string | undefined;
    if (!p.isPunct(':') && !p.isPunct('{')) name = p.name('a ref name, ":" or "{"').value;
    if (p.isPunct(':')) {
      p.next();
      refs.push(p.refLine(name, kw.start));
    } else {
      const lines: PendingRef[] = [];
      const end = p.block(name ? `The ref "${name}"` : 'This ref', p.peek(), () => lines.push(p.refLine(name, p.peek().start)));
      if (!lines.length) throw new Failure('This ref has no relationship in it', kw.start, end);
      for (const r of lines) r.range = lines.length === 1 ? { start: kw.start, end } : r.range;
      refs.push(...lines);
    }
  }

  function enumBlock(kw: Token): void {
    const name = p.dotted('an enum name');
    if (name.parts.length > 2) throw new Failure(`"${name.parts.join('.')}" has too many parts: write schema.enum`, name.start, name.end);
    const [s, n] = name.parts.length === 2 ? name.parts : [DEFAULT_SCHEMA, name.parts[0]!];
    const e = { schema: s!, name: n!, values: [] as { name: string; note?: string }[], range: { start: kw.start, end: 0 } };
    if (!p.isPunct('{')) p.fail(`Expected "{" to start the enum "${n}" but found ${p.describe(p.peek())}`);
    e.range.end = p.block(`The enum "${n}"`, p.peek(), () => {
      const v = p.name('an enum value');
      const value: { name: string; note?: string } = { name: v.value };
      if (e.values.some((x) => x.name === v.value)) throw new Failure(`"${v.value}" is in the enum "${n}" twice`, v.start, v.end);
      if (p.isPunct('['))
        p.each(p.settings(), (st) => {
          if (st.key === 'note') value.note = p.string(st);
          else throw new Failure(`"${st.key}" isn't an enum value setting: use note`, st.start, st.end);
        });
      e.values.push(value);
    });
    schema.enums.push(e);
  }

  function tableGroup(kw: Token): void {
    const name = p.name('a group name');
    const group = { name: name.value, tables: [] as { schema: string; name: string }[], properties: {} as Record<string, string>, range: { start: kw.start, end: 0 } } as DbmlSchema['groups'][number];
    if (p.isPunct('['))
      p.each(p.settings(), (s) => {
        if (s.key === 'color') group.color = p.color(s);
        else if (s.key === 'note') group.note = p.string(s);
        else p.custom(s, group.properties, 'table group');
      });
    if (!p.isPunct('{')) p.fail(`Expected "{" to start the group "${group.name}" but found ${p.describe(p.peek())}`);
    const entries: PendingGroupEntry[] = [];
    group.range!.end = p.block(`The group "${group.name}"`, p.peek(), () => {
      if (isNoteItem()) group.note = noteValue();
      else entries.push(p.dotted('a table name'));
    });
    groupEntries.set(schema.groups.length, entries);
    schema.groups.push(group);
  }

  function stickyNote(kw: Token): void {
    const name = p.name('a note name');
    const note = { name: name.value, text: '', properties: {} as Record<string, string>, range: { start: kw.start, end: 0 } } as DbmlSchema['notes'][number];
    if (p.isPunct('['))
      p.each(p.settings(), (s) => {
        if (s.key === 'color' || s.key === 'headercolor') note.color = p.color(s, true);
        else p.custom(s, note.properties, 'note');
      });
    if (!p.isPunct('{')) p.fail(`Expected "{" to start the note "${note.name}" but found ${p.describe(p.peek())}`);
    note.range!.end = p.block(`The note "${note.name}"`, p.peek(), () => {
      const t = p.peek();
      if (t.kind !== 'string' && t.kind !== 'triple') p.fail(`Expected the note's 'quoted' text but found ${p.describe(t)}`);
      note.text = p.next().value;
    });
    schema.notes.push(note);
  }

  function project(kw: Token): void {
    const proj: NonNullable<DbmlSchema['project']> = { properties: {} };
    if (p.peek().kind === 'ident' || p.peek().kind === 'quoted') proj.name = p.next().value;
    if (p.isPunct('['))
      p.each(p.settings(), (s) => {
        if (s.key === 'note') proj.note = p.string(s);
        else if (s.key === 'database_type') proj.databaseType = p.string(s);
        else p.custom(s, proj.properties, 'project');
      });
    if (!p.isPunct('{')) p.fail(`Expected "{" to start the project but found ${p.describe(p.peek())}`);
    p.block('The project', p.peek(), () => {
      if (isNoteItem()) {
        proj.note = noteValue();
        return;
      }
      const key = p.name('a project setting such as database_type');
      p.expectPunct(':');
      const t = p.next();
      if (t.kind !== 'string' && t.kind !== 'triple' && t.kind !== 'quoted' && t.kind !== 'ident' && t.kind !== 'number' && t.kind !== 'color')
        throw new Failure(`Expected a value for "${key.value}" but found ${p.describe(t)}`, t.start, t.end);
      if (key.value.toLowerCase() === 'database_type') proj.databaseType = t.value;
      else proj.properties[key.value] = t.value;
    });
    if (schema.project) p.errors.push({ message: 'There is more than one Project; the last one is used', start: kw.start, end: kw.end });
    schema.project = proj;
  }

  function diagramView(kw: Token): void {
    const name = p.name('a view name');
    const view: DiagramView = { name: name.value, range: { start: kw.start, end: 0 } };
    const categories: Record<string, 'tables' | 'notes' | 'groups' | 'schemas'> = { tables: 'tables', notes: 'notes', tablegroups: 'groups', schemas: 'schemas' };
    if (!p.isPunct('{')) p.fail(`Expected "{" to start the view "${view.name}" but found ${p.describe(p.peek())}`);
    view.range!.end = p.block(`The view "${view.name}"`, p.peek(), () => {
      const cat = p.name('Tables, Notes, TableGroups or Schemas');
      const key = categories[cat.value.toLowerCase()];
      if (!key) throw new Failure(`"${cat.value}" isn't a view category: use Tables, Notes, TableGroups or Schemas`, cat.start, cat.end);
      const names: string[] = [];
      let all = false;
      p.block(`${cat.value} in the view "${view.name}"`, p.peek(), () => {
        if (p.isPunct('*')) {
          p.next();
          all = true;
        } else names.push(p.dotted('a name').parts.join('.'));
      });
      view[key] = all ? '*' : names;
    });
    schema.views.push(view);
  }

  function metadataBlock(kw: Token): void {
    const kind = p.name('Table, Column, TableGroup or Note');
    const target = p.dotted('the element the metadata is for');
    const values: Metadata['values'] = [];
    if (!p.isPunct('{')) p.fail(`Expected "{" but found ${p.describe(p.peek())}`);
    const end = p.block('This metadata', p.peek(), () => {
      const key = p.name('a property name');
      p.expectPunct(':');
      const t = p.next();
      if (!['string', 'triple', 'quoted', 'color', 'ident', 'number'].includes(t.kind)) throw new Failure(`Expected a value for "${key.value}" but found ${p.describe(t)}`, t.start, t.end);
      values.push({ key: key.value.toLowerCase(), value: t.value });
    });
    metadata.push({ kind: kind.value.toLowerCase(), target: target.parts, values, start: kw.start, end });
  }

  // ---- the top level ----

  for (;;) {
    p.skipNewlines();
    const kw = p.peek();
    if (kw.kind === 'eof') break;
    try {
      if (kw.kind !== 'ident' || !TOP.has(kw.value.toLowerCase())) p.fail(`Expected Table, Ref, Enum, TableGroup, Note, TablePartial, records or Project but found ${p.describe(kw)}`);
      p.next();
      switch (kw.value.toLowerCase()) {
        case 'table':
          table(kw);
          break;
        case 'tablepartial':
          tablePartial(kw);
          break;
        case 'ref':
          ref(kw);
          break;
        case 'enum':
          enumBlock(kw);
          break;
        case 'tablegroup':
          tableGroup(kw);
          break;
        case 'note':
          stickyNote(kw);
          break;
        case 'project':
          project(kw);
          break;
        case 'records':
          p.i--;
          recordsBlock();
          break;
        case 'diagramview':
          diagramView(kw);
          break;
        case 'metadata':
          metadataBlock(kw);
          break;
        case 'use':
          throw new Failure('Puddle reads one DBML document: paste the other file’s DBML here instead of importing it', kw.start, kw.end);
      }
      p.endOfItem();
    } catch (e) {
      if (!(e instanceof Failure)) throw e;
      p.errors.push({ message: e.message, start: e.start, end: e.end });
      p.skipElement();
    }
  }

  // ---- resolve names ----

  const err = (message: string, start: number, end: number) => p.errors.push({ message, start, end });

  // Partials, then tables: each table's columns, indexes and checks with its partials injected.
  const partialByName = new Map<string, TablePartial>();
  for (const part of partials) {
    if (partialByName.has(part.name)) err(`There are two partials called "${part.name}"`, part.range!.start, part.range!.end);
    else partialByName.set(part.name, part);
  }
  for (const pending of tables) resolvePartials(pending, partialByName, err);

  const byKey = new Map<string, Table>();
  const byAlias = new Map<string, Table>();
  for (const { table: t } of tables) {
    const key = tableKey(t.schema, t.name);
    if (byKey.has(key)) {
      err(`There are two tables called "${qualified(t.schema, t.name)}"`, t.nameRange!.start, t.nameRange!.end);
      continue;
    }
    byKey.set(key, t);
    if (t.alias) {
      if (byAlias.has(t.alias)) err(`Two tables use the alias "${t.alias}"`, t.nameRange!.start, t.nameRange!.end);
      else byAlias.set(t.alias, t);
    }
    schema.tables.push(t);
  }
  const seenColumns = (t: Table) => {
    const seen = new Set<string>();
    for (const c of t.columns) {
      if (seen.has(c.name) && !c.partial) err(`The table "${t.name}" has two columns called "${c.name}"`, c.nameRange?.start ?? 0, c.nameRange?.end ?? 0);
      seen.add(c.name);
    }
  };
  schema.tables.forEach(seenColumns);

  const lookup = (parts: string[]): Table | undefined => {
    if (parts.length === 1) return byAlias.get(parts[0]!) ?? byKey.get(tableKey(DEFAULT_SCHEMA, parts[0]!));
    return byKey.get(tableKey(parts[0]!, parts[1]!));
  };
  const resolveEndpoint = (e: RawEndpoint, t?: Table): Endpoint | undefined => {
    const table = t ?? lookup(e.parts);
    if (!table) {
      err(`There is no table called "${e.parts.join('.')}"`, e.start, e.end);
      return undefined;
    }
    const missing = e.columns.find((c) => !table.columns.some((col) => col.name === c));
    if (missing) {
      err(`The table "${qualified(table.schema, table.name)}" has no column "${missing}"`, e.start, e.end);
      return undefined;
    }
    return { schema: table.schema, table: table.name, columns: e.columns };
  };

  for (const r of refs) {
    const from = resolveEndpoint(r.from, r.inline?.table);
    const to = resolveEndpoint(r.to);
    if (!from || !to) continue;
    if (from.columns.length !== to.columns.length) {
      err(`This ref matches ${from.columns.length} columns to ${to.columns.length}`, r.range.start, r.range.end);
      continue;
    }
    const ref: Ref = { from, to, op: r.op, fromOptional: r.fromOptional, toOptional: r.toOptional, inactive: r.settings.inactive ?? false, inline: !!r.inline, range: r.range };
    if (r.name) ref.name = r.name;
    if (r.settings.delete) ref.delete = r.settings.delete;
    if (r.settings.update) ref.update = r.settings.update;
    if (r.settings.color) ref.color = r.settings.color;
    schema.refs.push(ref);
  }

  const enumKeys = new Set<string>();
  schema.enums = schema.enums.filter((e) => {
    const key = tableKey(e.schema, e.name);
    if (enumKeys.has(key)) {
      err(`There are two enums called "${qualified(e.schema, e.name)}"`, e.range!.start, e.range!.end);
      return false;
    }
    enumKeys.add(key);
    return true;
  });

  schema.groups.forEach((g, gi) => {
    for (const entry of groupEntries.get(gi) ?? []) {
      const t = entry.parts.length <= 2 ? lookup(entry.parts) : undefined;
      if (!t) err(`There is no table called "${entry.parts.join('.')}"`, entry.start, entry.end);
      else if (g.tables.some((x) => x.schema === t.schema && x.name === t.name)) err(`"${t.name}" is in the group "${g.name}" twice`, entry.start, entry.end);
      else g.tables.push({ schema: t.schema, name: t.name });
    }
  });
  const groupNames = new Set<string>();
  for (const g of schema.groups) {
    if (groupNames.has(g.name)) err(`There are two groups called "${g.name}"`, g.range!.start, g.range!.end);
    groupNames.add(g.name);
  }
  const noteNames = new Set<string>();
  for (const n of schema.notes) {
    if (noteNames.has(n.name)) err(`There are two notes called "${n.name}"`, n.range!.start, n.range!.end);
    noteNames.add(n.name);
  }

  const withRecords = new Set<Table>();
  for (const r of records) {
    const t = r.table ?? lookup(r.parts);
    if (!t) {
      err(`There is no table called "${r.parts.join('.')}"`, r.range.start, r.range.end);
      continue;
    }
    if (withRecords.has(t)) {
      err(`The table "${t.name}" already has records: a table takes one records block`, r.range.start, r.range.end);
      continue;
    }
    withRecords.add(t);
    const columns = r.columns ?? t.columns.map((c) => c.name);
    const missing = columns.find((c) => !t.columns.some((col) => col.name === c));
    if (missing) {
      err(`The table "${t.name}" has no column "${missing}"`, r.range.start, r.range.end);
      continue;
    }
    const rows: RecordValue[][] = [];
    for (const row of r.rows) {
      if (row.values.length !== columns.length) err(`This row has ${row.values.length} values for ${columns.length} columns`, row.start, row.end);
      else rows.push(row.values);
    }
    schema.records.push({ schema: t.schema, table: t.name, columns, implicit: !r.columns, inline: !!r.table, example: r.example, rows, range: r.range } satisfies Records);
  }

  // Records in table order, wherever they were written, so the model doesn't depend on where a block sits.
  const tableOrder = new Map(schema.tables.map((t, i) => [tableKey(t.schema, t.name), i]));
  schema.records.sort((a, b) => tableOrder.get(tableKey(a.schema, a.table))! - tableOrder.get(tableKey(b.schema, b.table))!);

  for (const m of metadata) applyMetadata(schema, m, lookup, err);

  schema.partials = partials;
  const errors = p.errors
    .sort((a, b) => a.start - b.start)
    .map((e) => ({ ...e, ...position(text, e.start) }));
  return { schema, errors };
}

/**
 * Inject a table's partials (dbml.dbdiagram.io/docs/#tablepartial): columns keep the place their name first appears,
 * and a column, index or setting defined on the table wins over a partial's; between partials, the later one wins.
 */
function resolvePartials(pending: PendingTable, partials: Map<string, TablePartial>, err: (m: string, s: number, e: number) => void): void {
  const t = pending.table;
  const order: string[] = [];
  const chosen = new Map<string, { column: Column; priority: number }>();
  const set = (column: Column, priority: number) => {
    const had = chosen.get(column.name);
    if (!had) order.push(column.name);
    if (!had || priority >= had.priority) chosen.set(column.name, { column, priority });
  };
  const injected: TablePartial[] = [];
  pending.items.forEach((item) => {
    if ('column' in item) {
      if (chosen.get(item.column.name)?.priority === Infinity) {
        err(`The table "${t.name}" has two columns called "${item.column.name}"`, item.column.nameRange!.start, item.column.nameRange!.end);
        return;
      }
      set(item.column, Infinity);
    } else {
      const part = partials.get(item.partial);
      if (!part) {
        err(`There is no TablePartial called "${item.partial}"`, item.start, item.end);
        return;
      }
      injected.push(part);
      for (const c of part.columns) set({ ...withoutPosition(c), partial: part.name }, injected.length);
    }
  });
  t.partials = t.partials.filter((x) => partials.has(x.name));
  t.columns = order.map((name) => chosen.get(name)!.column);

  // A partial's index or check is dropped when the table has its own on the same columns (or name); the table's own
  // are all kept, even two alike, as written.
  const indexKey = (ix: Index) => JSON.stringify(ix.parts);
  const fromPartials = new Map<string, Index>();
  for (const part of injected) for (const ix of part.indexes) fromPartials.set(indexKey(ix), { ...withoutPosition(ix), partial: part.name });
  for (const ix of pending.ownIndexes) fromPartials.delete(indexKey(ix));
  t.indexes = [...fromPartials.values(), ...pending.ownIndexes];

  const checkKey = (c: Check) => c.name ?? c.expression;
  const checksFromPartials = new Map<string, Check>();
  for (const part of injected) for (const c of part.checks) checksFromPartials.set(checkKey(c), { ...withoutPosition(c), partial: part.name });
  for (const c of pending.ownChecks) checksFromPartials.delete(checkKey(c));
  t.checks = [...checksFromPartials.values(), ...pending.ownChecks];

  for (const part of injected) {
    if (part.headerColor) t.headerColor = part.headerColor;
    if (part.note) t.note = part.note;
    Object.assign(t.properties, part.properties);
  }
  if (pending.own.headerColor) t.headerColor = pending.own.headerColor;
  if (pending.own.note) t.note = pending.own.note;
  Object.assign(t.properties, pending.own.properties);
}

/** A partial's element copied into a table: its ranges point into the partial, not the table. */
function withoutPosition<T extends { range?: Range; nameRange?: Range }>(x: T): T {
  const { range: _r, nameRange: _n, ...rest } = x;
  return rest as T;
}

function applyMetadata(schema: DbmlSchema, m: Metadata, lookup: (parts: string[]) => Table | undefined, err: (m: string, s: number, e: number) => void): void {
  const set = (target: { properties: Record<string, string>; note?: string }) => {
    for (const { key, value } of m.values) {
      if (key === 'note') target.note = value;
      else target.properties[key] = value;
    }
  };
  if (m.kind === 'table') {
    const t = lookup(m.target);
    if (!t) return void err(`There is no table called "${m.target.join('.')}"`, m.start, m.end);
    set(t);
  } else if (m.kind === 'column') {
    const t = lookup(m.target.slice(0, -1));
    const c = t?.columns.find((col) => col.name === m.target[m.target.length - 1]);
    if (!c) return void err(`There is no column "${m.target.join('.')}"`, m.start, m.end);
    set(c);
  } else if (m.kind === 'tablegroup') {
    const g = schema.groups.find((x) => x.name === m.target.join('.'));
    if (!g) return void err(`There is no group called "${m.target.join('.')}"`, m.start, m.end);
    set(g);
  } else if (m.kind === 'note') {
    const n = schema.notes.find((x) => x.name === m.target.join('.'));
    if (!n) return void err(`There is no note called "${m.target.join('.')}"`, m.start, m.end);
    for (const { key, value } of m.values) {
      if (key === 'color') n.color = value;
      else n.properties[key] = value;
    }
  } else err(`Metadata is for a Table, Column, TableGroup or Note, not "${m.kind}"`, m.start, m.end);
}
