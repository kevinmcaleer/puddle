// Join nodes: the SQL for each join type, the columns they produce, and settings mistakes found before anything runs.
import type { ColumnSchema, JoinKind, JoinSpec } from '../model';
import { ident } from './sql';
import { describeType as describe, typeFamily as family } from './types';

export const JOIN_TYPES: Record<JoinKind, { label: string; sql: string; hint: string }> = {
  inner: { label: 'Inner join', sql: 'INNER JOIN', hint: 'Only rows that match on both sides.' },
  left: { label: 'Left join', sql: 'LEFT JOIN', hint: 'Every left row, with the right columns filled in where a row matches.' },
  right: { label: 'Right join', sql: 'RIGHT JOIN', hint: 'Every right row, with the left columns filled in where a row matches.' },
  full: { label: 'Full join', sql: 'FULL JOIN', hint: 'Every row from both sides, matched up where they can be.' },
  anti: { label: 'Anti join', sql: 'ANTI JOIN', hint: 'Left rows with no match on the right. Only the left columns.' },
  semi: { label: 'Semi join', sql: 'SEMI JOIN', hint: 'Left rows with a match on the right, once each. Only the left columns.' },
};

/** Whether this join type brings the right side's columns into its result. */
export const keepsRightColumns = (kind: JoinKind) => kind !== 'anti' && kind !== 'semi';

export interface JoinProblem {
  message: string;
  /** Which key pair it's about, when it's about one. */
  key?: number;
  /** The input it's about, so the canvas can mark that wire. */
  side?: 'left' | 'right';
  field?: 'keys' | 'suffix';
}

/**
 * What's wrong with a join's settings given its inputs' columns (left out while unknown): no keys, a key
 * column missing from its side, keys that can't be compared, an empty suffix. Empty when it's ready to run.
 */
export function joinProblems(spec: JoinSpec, left?: ColumnSchema[], right?: ColumnSchema[]): JoinProblem[] {
  const problems: JoinProblem[] = [];
  if (!spec.keys.length) problems.push({ field: 'keys', message: 'Pick the columns to match on, one from each side.' });
  spec.keys.forEach((k, i) => {
    const l = left?.find((c) => c.name === k.left);
    const r = right?.find((c) => c.name === k.right);
    if (!k.left) problems.push({ key: i, side: 'left', message: `Pick a left column for key ${i + 1}.` });
    else if (left && !l) problems.push({ key: i, side: 'left', message: `${k.left} isn’t in the left input any more.` });
    if (!k.right) problems.push({ key: i, side: 'right', message: `Pick a right column for key ${i + 1}.` });
    else if (right && !r) problems.push({ key: i, side: 'right', message: `${k.right} isn’t in the right input any more.` });
    if (l && r && family(l.type) !== family(r.type)) {
      const which = k.left === k.right ? `${k.left} is ${describe(l.type)} on the left and ${describe(r.type)} on the right` : `${k.left} on the left is ${describe(l.type)} and ${k.right} on the right is ${describe(r.type)}`;
      problems.push({ key: i, message: `${which}; change one with Change type.` });
    }
  });
  if (keepsRightColumns(spec.kind) && !spec.suffix.trim()) problems.push({ field: 'suffix', message: 'Give clashing columns a suffix, such as _right.' });
  return problems;
}

/**
 * A key pair to start from: a column name both sides share, preferring one that looks like an id
 * (customer_id, id), and skipping left columns already used. Undefined when the sides share no name.
 */
export function suggestJoinKey(left: ColumnSchema[], right: ColumnSchema[], used: string[] = []): { left: string; right: string } | undefined {
  const shared = left.filter((c) => !used.includes(c.name) && right.some((r) => r.name === c.name && family(r.type) === family(c.type)));
  const pick = shared.find((c) => /(^|_)id$/i.test(c.name)) ?? shared[0];
  return pick && { left: pick.name, right: pick.name };
}

export interface JoinColumn {
  name: string;
  /** The select-list item that produces it. */
  sql: string;
}

const L = ident('l');
const R = ident('r');

/**
 * The join's output columns, in order: every left column, then the right ones. A right key with the same
 * name as its left key is dropped (in right and full joins the left one is filled from it where the left
 * row is missing). A right column whose name the left side uses gets the suffix, numbered if that's taken too.
 */
export function joinColumns(spec: JoinSpec, left: ColumnSchema[], right: ColumnSchema[]): JoinColumn[] {
  if (!keepsRightColumns(spec.kind)) return left.map((c) => ({ name: c.name, sql: `${L}.${ident(c.name)}` }));
  const sharedKeys = new Set(spec.keys.filter((k) => k.left === k.right).map((k) => k.left));
  const fill = spec.kind === 'right' || spec.kind === 'full';
  const out: JoinColumn[] = left.map((c) => {
    const col = ident(c.name);
    return { name: c.name, sql: fill && sharedKeys.has(c.name) ? `coalesce(${L}.${col}, ${R}.${col}) AS ${col}` : `${L}.${col}` };
  });
  const leftNames = new Set(left.map((c) => c.name));
  const kept = right.filter((c) => !sharedKeys.has(c.name));
  const taken = new Set([...leftNames, ...kept.map((c) => c.name)]);
  for (const c of kept) {
    let name = c.name;
    if (leftNames.has(c.name)) {
      name = `${c.name}${spec.suffix}`;
      for (let n = 2; taken.has(name); n++) name = `${c.name}${spec.suffix}${n}`;
      taken.add(name);
    }
    out.push({ name, sql: name === c.name ? `${R}.${ident(c.name)}` : `${R}.${ident(c.name)} AS ${ident(name)}` });
  }
  return out;
}

/** The ON condition: every key pair equal. */
export const joinCondition = (spec: JoinSpec, l = L, r = R) => spec.keys.map((k) => `${l}.${ident(k.left)} = ${r}.${ident(k.right)}`).join(' AND ');

/** One join as a SELECT over the two input relations. Assumes joinProblems found nothing. */
export function compileJoin(spec: JoinSpec, inputs: { left: string; right: string }, left: ColumnSchema[], right: ColumnSchema[]): string {
  const columns = joinColumns(spec, left, right).map((c) => c.sql);
  return `SELECT ${columns.join(', ')} FROM ${inputs.left} AS ${L} ${JOIN_TYPES[spec.kind].sql} ${inputs.right} AS ${R} ON ${joinCondition(spec)}`;
}
