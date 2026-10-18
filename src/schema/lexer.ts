// Tokens of DBML. Newlines are tokens because DBML is line-based inside blocks (one column, index or row per line);
// comments are dropped. Every token keeps its offsets so errors and two-way edits can point at the text.

export type TokenKind =
  | 'ident' // a bare word: users, varchar, not, 123abc
  | 'quoted' // a double-quoted name: "column name"
  | 'string' // a single-quoted string: 'text'
  | 'triple' // a triple-quoted, multi-line string: '''text'''
  | 'expr' // a backtick expression: `now()`
  | 'number' // 42, 3.14, 1.5e10 (a leading minus is its own token)
  | 'color' // #fff, #3498DB
  | 'op' // < > <> -
  | 'punct' // { } [ ] ( ) , : . ~ ? *
  | 'newline'
  | 'eof';

export interface Token {
  kind: TokenKind;
  /** The value: unquoted and unescaped for strings and names, the text otherwise. */
  value: string;
  start: number;
  end: number;
}

export interface LexError {
  message: string;
  start: number;
  end: number;
}

const WORD = /[\p{L}\p{N}_$]/u;
const NUMBER = /^\d+(\.\d+)?([eE][+-]?\d+)?/;

/**
 * A triple-quoted string's text: the indent its lines share removed, then escapes (`\\`, `\'`) and line continuations
 * (a backslash at the end of a line) applied.
 */
export function blockString(raw: string): string {
  let lines = raw.replace(/\r\n/g, '\n').split('\n');
  if (lines.length > 1 && lines[0]!.trim() === '') lines = lines.slice(1);
  if (lines.length > 1 && lines[lines.length - 1]!.trim() === '') lines = lines.slice(0, -1);
  const indents = lines.filter((l) => l.trim() !== '').map((l) => /^[ \t]*/.exec(l)![0].length);
  const cut = indents.length ? Math.min(...indents) : 0;
  const dedented = lines.map((l) => l.slice(cut).trimEnd()).join('\n');
  let text = '';
  for (let i = 0; i < dedented.length; i++) {
    const c = dedented[i]!;
    const n = dedented[i + 1];
    if (c === '\\' && n === '\n') i++;
    else if (c === '\\' && (n === '\\' || n === "'")) {
      text += n;
      i++;
    } else text += c;
  }
  return text;
}

export function lex(text: string): { tokens: Token[]; errors: LexError[] } {
  const tokens: Token[] = [];
  const errors: LexError[] = [];
  let i = 0;
  const push = (kind: TokenKind, value: string, start: number, end: number) => tokens.push({ kind, value, start, end });

  while (i < text.length) {
    const c = text[i]!;
    const start = i;
    if (c === '\n') {
      push('newline', '\n', i, i + 1);
      i++;
    } else if (c === ' ' || c === '\t' || c === '\r' || c === '\f' || c === '\v' || c === '﻿') {
      i++;
    } else if (c === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i++;
    } else if (c === '/' && text[i + 1] === '*') {
      const close = text.indexOf('*/', i + 2);
      if (close < 0) {
        errors.push({ message: 'This comment is never closed with */', start, end: i + 2 });
        i = text.length;
      } else {
        // Keep the newlines a block comment spans, so the lines around it stay separate.
        for (let k = i; k < close; k++) if (text[k] === '\n') push('newline', '\n', k, k + 1);
        i = close + 2;
      }
    } else if (c === "'" && text.startsWith("'''", i)) {
      let k = i + 3;
      while (k < text.length && !(text.startsWith("'''", k) && text[k - 1] !== '\\')) k++;
      if (k >= text.length) {
        errors.push({ message: "This multi-line string is never closed with '''", start, end: i + 3 });
        push('triple', blockString(text.slice(i + 3)), start, text.length);
        i = text.length;
      } else {
        push('triple', blockString(text.slice(i + 3, k)), start, k + 3);
        i = k + 3;
      }
    } else if (c === "'" || c === '"') {
      let value = '';
      let k = i + 1;
      let closed = false;
      while (k < text.length) {
        const d = text[k]!;
        if (d === '\n') break;
        if (d === '\\' && k + 1 < text.length && text[k + 1] !== '\n') {
          const n = text[k + 1]!;
          value += n === c || n === '\\' ? n : n === 'n' && c === "'" ? '\n' : n === 't' && c === "'" ? '\t' : '\\' + n;
          k += 2;
          continue;
        }
        if (d === c) {
          closed = true;
          k++;
          break;
        }
        value += d;
        k++;
      }
      if (!closed) errors.push({ message: `This ${c === "'" ? 'string' : 'quoted name'} is never closed with ${c}`, start, end: k });
      push(c === "'" ? 'string' : 'quoted', value, start, k);
      i = k;
    } else if (c === '`') {
      const close = text.indexOf('`', i + 1);
      if (close < 0) {
        errors.push({ message: 'This expression is never closed with `', start, end: i + 1 });
        push('expr', text.slice(i + 1), start, text.length);
        i = text.length;
      } else {
        push('expr', text.slice(i + 1, close), start, close + 1);
        i = close + 1;
      }
    } else if (c === '#') {
      let k = i + 1;
      while (k < text.length && WORD.test(text[k]!)) k++;
      push('color', text.slice(i, k), start, k);
      i = k;
    } else if (c === '<' && text[i + 1] === '>') {
      push('op', '<>', i, i + 2);
      i += 2;
    } else if (c === '<' || c === '>' || c === '-') {
      push('op', c, i, i + 1);
      i++;
    } else if ('{}[](),:.~?*'.includes(c)) {
      push('punct', c, i, i + 1);
      i++;
    } else if (WORD.test(c)) {
      const number = /\d/.test(c) ? NUMBER.exec(text.slice(i)) : null;
      if (number && !WORD.test(text[i + number[0].length] ?? '')) {
        push('number', number[0], i, i + number[0].length);
        i += number[0].length;
      } else {
        let k = i;
        while (k < text.length && WORD.test(text[k]!)) k++;
        push('ident', text.slice(i, k), start, k);
        i = k;
      }
    } else {
      errors.push({ message: `Unexpected character ${JSON.stringify(c)}`, start, end: i + 1 });
      i++;
    }
  }
  push('eof', '', text.length, text.length);
  return { tokens, errors };
}
