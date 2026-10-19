// How the DBML editor colours its text: each token's kind, worked out from where it sits (a keyword starts a line,
// the word after a column name is its type, words in brackets are settings).
import { lex, type Token } from '../lexer';

export type SpanKind = 'keyword' | 'name' | 'type' | 'setting' | 'string' | 'expr' | 'number' | 'color' | 'op' | 'punct' | 'comment';

export interface Span {
  start: number;
  end: number;
  kind: SpanKind;
}

const KEYWORDS = new Set(['project', 'table', 'tablepartial', 'ref', 'enum', 'tablegroup', 'note', 'records', 'diagramview', 'metadata', 'indexes', 'checks', 'as', 'tables', 'notes', 'tablegroups', 'schemas', 'use']);
const VALUES = new Set(['true', 'false', 'null']);

export function highlightDbml(text: string): Span[] {
  const { tokens } = lex(text, { comments: true });
  const spans: Span[] = [];
  let bracket = 0;
  /** Which word of the line this is, outside brackets: 0 starts it. */
  let word = 0;
  let lineStartsWithKeyword = false;
  let afterColon = false;
  const push = (t: Token, kind: SpanKind) => spans.push({ start: t.start, end: t.end, kind });
  for (const t of tokens) {
    switch (t.kind) {
      case 'newline':
        word = 0;
        lineStartsWithKeyword = false;
        afterColon = false;
        break;
      case 'comment':
        push(t, 'comment');
        break;
      case 'string':
      case 'triple':
        push(t, 'string');
        break;
      case 'expr':
        push(t, 'expr');
        break;
      case 'number':
        push(t, 'number');
        break;
      case 'color':
        push(t, 'color');
        break;
      case 'op':
        push(t, 'op');
        break;
      case 'punct':
        if (t.value === '[') {
          bracket++;
          afterColon = false;
        }
        if (t.value === ']') bracket = Math.max(0, bracket - 1);
        if (t.value === ':') afterColon = true;
        if (t.value === ',' && bracket) afterColon = false;
        if (t.value !== '.' && t.value !== ':' && t.value !== ',') push(t, 'punct');
        break;
      case 'ident':
      case 'quoted': {
        const lower = t.value.toLowerCase();
        if (bracket) push(t, afterColon ? (VALUES.has(lower) ? 'number' : 'name') : 'setting');
        else if (t.kind === 'ident' && word === 0 && KEYWORDS.has(lower)) {
          push(t, 'keyword');
          lineStartsWithKeyword = true;
        } else if (t.kind === 'ident' && lower === 'as' && lineStartsWithKeyword) push(t, 'keyword');
        else if (t.kind === 'ident' && VALUES.has(lower)) push(t, 'number');
        else if (word === 1 && !lineStartsWithKeyword && !afterColon) push(t, 'type');
        else push(t, 'name');
        // Dotted names (schema.table, table.column) are one word of the line.
        if (!bracket) word++;
        break;
      }
    }
    if (t.kind === 'punct' && t.value === '.' && !bracket) word--;
  }
  return spans;
}

/** The bracket matching the one at or just before `caret`, if there is one: both offsets. */
export function matchingBracket(text: string, caret: number): [number, number] | undefined {
  const pairs: Record<string, string> = { '{': '}', '[': ']', '(': ')' };
  const closers: Record<string, string> = { '}': '{', ']': '[', ')': '(' };
  const { tokens } = lex(text);
  const brackets = tokens.filter((t) => t.kind === 'punct' && (t.value in pairs || t.value in closers));
  const at = brackets.find((t) => t.start === caret) ?? brackets.find((t) => t.end === caret);
  if (!at) return undefined;
  const i = brackets.indexOf(at);
  if (at.value in pairs) {
    let depth = 0;
    for (let k = i + 1; k < brackets.length; k++) {
      const b = brackets[k]!;
      if (b.value === at.value) depth++;
      else if (b.value === pairs[at.value]) {
        if (depth === 0) return [at.start, b.start];
        depth--;
      }
    }
  } else {
    let depth = 0;
    for (let k = i - 1; k >= 0; k--) {
      const b = brackets[k]!;
      if (b.value === at.value) depth++;
      else if (b.value === closers[at.value]) {
        if (depth === 0) return [b.start, at.start];
        depth--;
      }
    }
  }
  return undefined;
}
