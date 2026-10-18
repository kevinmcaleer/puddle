// The simple checks sample rows can follow, read from their SQL: `col > n`, `col >= n`, `col < n`, `col <= n`,
// `col = n`, `col between a and b`, `col in (...)` and `col is not null`, alone or joined with `and`. Anything else is
// left to the caller to report.
import type { RecordValue } from '../model';

/** What a check allows for one column. */
export interface Bound {
  min?: number;
  minExclusive?: boolean;
  max?: number;
  maxExclusive?: boolean;
  /** The only values allowed (`in (...)` or `= n`). */
  values?: RecordValue[];
  notNull?: boolean;
}

const NAME = String.raw`(?:"((?:[^"]|"")+)"|([A-Za-z_][A-Za-z0-9_]*))`;
const NUM = String.raw`([+-]?(?:\d+\.?\d*|\.\d+))`;
const nameOf = (m: RegExpExecArray, i: number) => m[i] !== undefined ? m[i]!.replace(/""/g, '"') : m[i + 1]!;

const BETWEEN = new RegExp(String.raw`^${NAME}\s+between\s+${NUM}\s+and\s+${NUM}$`, 'i');
const COMPARE = new RegExp(String.raw`^${NAME}\s*(>=|<=|>|<|=)\s*${NUM}$`);
const REVERSED = new RegExp(String.raw`^${NUM}\s*(>=|<=|>|<|=)\s*${NAME}$`);
const IN = new RegExp(String.raw`^${NAME}\s+in\s*\((.*)\)$`, 'is');
const NOT_NULL = new RegExp(String.raw`^${NAME}\s+is\s+not\s+null$`, 'i');
const FLIP: Record<string, string> = { '>': '<', '<': '>', '>=': '<=', '<=': '>=', '=': '=' };

/** Outer brackets around the whole expression, removed. */
function unwrap(text: string): string {
  let t = text.trim();
  while (t.startsWith('(') && t.endsWith(')')) {
    let depth = 0;
    let closesEarly = false;
    for (let i = 0; i < t.length - 1; i++) {
      if (t[i] === '(') depth++;
      else if (t[i] === ')') depth--;
      if (depth === 0) {
        closesEarly = true;
        break;
      }
    }
    if (closesEarly) break;
    t = t.slice(1, -1).trim();
  }
  return t;
}

/** The items of an `in` list as values, or undefined when one isn't a plain number or string. */
function listValues(text: string): RecordValue[] | undefined {
  const values: RecordValue[] = [];
  const item = /\s*(?:'((?:[^']|'')*)'|([+-]?(?:\d+\.?\d*|\.\d+)))\s*(,|$)/y;
  let at = 0;
  while (at < text.length) {
    item.lastIndex = at;
    const m = item.exec(text);
    if (!m) return undefined;
    values.push(m[1] !== undefined ? { kind: 'string', value: m[1].replace(/''/g, "'") } : { kind: 'number', value: m[2]! });
    at = item.lastIndex;
    if (!m[3]) break;
  }
  return values.length ? values : undefined;
}

function comparison(op: string, n: number): Bound {
  if (op === '>') return { min: n, minExclusive: true };
  if (op === '>=') return { min: n };
  if (op === '<') return { max: n, maxExclusive: true };
  if (op === '<=') return { max: n };
  return { values: [{ kind: 'number', value: String(n) }] };
}

/** One part of a check (no top-level `and`), or undefined when it isn't a simple one. */
function part(text: string): { column: string; bound: Bound } | undefined {
  const t = unwrap(text);
  let m = BETWEEN.exec(t);
  if (m) return { column: nameOf(m, 1), bound: { min: Number(m[3]), max: Number(m[4]) } };
  m = COMPARE.exec(t);
  if (m) return { column: nameOf(m, 1), bound: comparison(m[3]!, Number(m[4])) };
  m = REVERSED.exec(t);
  if (m) return { column: nameOf(m, 3), bound: comparison(FLIP[m[2]!]!, Number(m[1])) };
  m = IN.exec(t);
  if (m) {
    const values = listValues(m[3]!);
    return values ? { column: nameOf(m, 1), bound: { values } } : undefined;
  }
  m = NOT_NULL.exec(t);
  if (m) return { column: nameOf(m, 1), bound: { notNull: true } };
  return undefined;
}

/** The `and`s at the top level of an expression that aren't a `between`'s. */
function splitAnd(text: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let quoted = false;
  let start = 0;
  let between = false;
  const word = /[A-Za-z_]+/y;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (ch === "'") quoted = !quoted;
    if (quoted) continue;
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    else if (depth === 0 && /[A-Za-z_]/.test(ch) && (i === 0 || !/[A-Za-z0-9_"]/.test(text[i - 1]!))) {
      word.lastIndex = i;
      const w = word.exec(text)![0].toLowerCase();
      if (w === 'between') between = true;
      else if (w === 'and') {
        if (between) between = false;
        else {
          parts.push(text.slice(start, i));
          start = i + 3;
        }
      }
      i += w.length - 1;
    }
  }
  parts.push(text.slice(start));
  return parts;
}

/** What a check expression allows, by column, or undefined when any part of it isn't a simple check. */
export function readCheck(expression: string): { column: string; bound: Bound }[] | undefined {
  const parts = splitAnd(unwrap(expression)).map(part);
  return parts.every((p) => p !== undefined) ? (parts as { column: string; bound: Bound }[]) : undefined;
}

/** Two bounds on one column, both kept. */
export function mergeBounds(a: Bound, b: Bound): Bound {
  const out: Bound = { ...a };
  if (b.min !== undefined && (out.min === undefined || b.min > out.min || (b.min === out.min && b.minExclusive))) Object.assign(out, { min: b.min, minExclusive: b.minExclusive });
  if (b.max !== undefined && (out.max === undefined || b.max < out.max || (b.max === out.max && b.maxExclusive))) Object.assign(out, { max: b.max, maxExclusive: b.maxExclusive });
  if (b.values) out.values = out.values ? out.values.filter((v) => b.values!.some((w) => w.value === v.value)) : b.values;
  if (b.notNull) out.notNull = true;
  return out;
}
