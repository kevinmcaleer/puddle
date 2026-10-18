// Walking one statement's tokens for the DDL reader: keywords, qualified names, parenthesised groups, comma lists, and
// the text of an expression as DBML can hold it (between backticks, so backtick and bracket quoting become plain).
import type { Statement, Token } from './lexer';

/** A plain identifier DBML and most SQL dialects read without quotes. */
const PLAIN = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** The token after the `(` at `open` that closes it, or the end. */
export function closing(tokens: Token[], open: number): number {
  let depth = 0;
  for (let k = open; k < tokens.length; k++) {
    const v = tokens[k]!.kind === 'punct' ? tokens[k]!.value : '';
    if (v === '(') depth++;
    else if (v === ')' && --depth === 0) return k;
  }
  return tokens.length;
}

/** The tokens split at commas outside parentheses; empty items are dropped. */
export function splitTop(tokens: Token[]): Token[][] {
  const items: Token[][] = [];
  let item: Token[] = [];
  let depth = 0;
  for (const t of tokens) {
    if (t.kind === 'punct' && t.value === '(') depth++;
    if (t.kind === 'punct' && t.value === ')') depth--;
    if (depth === 0 && t.kind === 'punct' && t.value === ',') {
      if (item.length) items.push(item);
      item = [];
    } else item.push(t);
  }
  if (item.length) items.push(item);
  return items;
}

/** The tokens without parentheses that wrap all of them: `((0))` is `0`. */
export function unwrap(tokens: Token[]): Token[] {
  let t = tokens;
  while (t.length >= 2 && t[0]!.value === '(' && t[0]!.kind === 'punct' && closing(t, 0) === t.length - 1) t = t.slice(1, -1);
  return t;
}

/** An identifier as an expression writes it: bare when plain, double-quoted otherwise. */
const identText = (name: string) => (PLAIN.test(name) ? name : `"${name.replace(/"/g, '""')}"`);

/** The tokens' text as written, one space where the source had any gap, with backtick and bracket quoting made plain. */
export function text(tokens: Token[], source: string): string {
  let out = '';
  tokens.forEach((t, k) => {
    if (k > 0 && t.start > tokens[k - 1]!.end) out += ' ';
    const raw = source.slice(t.start, t.end);
    out += t.kind === 'ident' && raw[0] !== '"' ? identText(t.value) : raw.replace(/\s+/g, ' ');
  });
  return out;
}

export class Cursor {
  pos = 0;
  readonly tokens: Token[];
  readonly source: string;

  constructor(tokens: Token[], source: string) {
    this.tokens = tokens;
    this.source = source;
  }

  static of(statement: Statement): Cursor {
    return new Cursor(statement.tokens, statement.source);
  }

  get done(): boolean {
    return this.pos >= this.tokens.length;
  }

  peek(offset = 0): Token | undefined {
    return this.tokens[this.pos + offset];
  }

  next(): Token | undefined {
    return this.tokens[this.pos++];
  }

  /** The line of the current token, or of the last one at the end. */
  get line(): number {
    return (this.peek() ?? this.tokens[this.tokens.length - 1])?.line ?? 1;
  }

  /** Whether the token at `offset` is this keyword (a bare word, any case). */
  isWord(word: string, offset = 0): boolean {
    const t = this.peek(offset);
    return !!t && t.kind === 'word' && t.value.toUpperCase() === word;
  }

  isPunct(p: string, offset = 0): boolean {
    const t = this.peek(offset);
    return !!t && t.kind === 'punct' && t.value === p;
  }

  /** Consumes these keywords if they come next, in order. */
  eat(...words: string[]): boolean {
    if (!words.every((w, k) => this.isWord(w, k))) return false;
    this.pos += words.length;
    return true;
  }

  eatPunct(p: string): boolean {
    if (!this.isPunct(p)) return false;
    this.pos++;
    return true;
  }

  /** A name, quoted or not: one word or identifier. */
  name(): string | undefined {
    const t = this.peek();
    if (!t || (t.kind !== 'word' && t.kind !== 'ident')) return undefined;
    this.pos++;
    return t.value;
  }

  /** A dotted name (`db.schema.table`), as its parts. */
  qualifiedName(): string[] | undefined {
    const first = this.name();
    if (first === undefined) return undefined;
    const parts = [first];
    while (this.isPunct('.') && (this.peek(1)?.kind === 'word' || this.peek(1)?.kind === 'ident')) {
      this.pos++;
      parts.push(this.name()!);
    }
    return parts;
  }

  /** The tokens inside the parenthesised group that comes next, consuming it; undefined when no group comes next. */
  group(): Token[] | undefined {
    if (!this.isPunct('(')) return undefined;
    const close = closing(this.tokens, this.pos);
    const inner = this.tokens.slice(this.pos + 1, close);
    this.pos = close + 1;
    return inner;
  }

  /** The rest of the tokens, consuming them. */
  rest(): Token[] {
    const r = this.tokens.slice(this.pos);
    this.pos = this.tokens.length;
    return r;
  }

  text(tokens: Token[]): string {
    return text(tokens, this.source);
  }
}
