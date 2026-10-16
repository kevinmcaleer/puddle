// Lookup nodes: bring columns across from the lookup input by key, taking the first match in file order so the
// main input's rows are never multiplied. Settings mistakes are found here before anything runs.
import type { ColumnSchema, LookupSpec } from '../model';
import { ident, str } from './sql';
import { describeType, typeFamily } from './types';

export interface LookupProblem {
  message: string;
  /** Which key pair it's about, when it's about one. */
  key?: number;
  /** The input it's about, so the canvas can mark that wire. */
  side?: 'main' | 'lookup';
  field?: 'keys' | 'columns' | 'suffix' | 'defaultValue';
}

/** What text a default value must look like to be written into a column of each type family. */
const DEFAULT_FITS: Record<string, RegExp> = {
  number: /^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/,
  date: /^\d{4}-\d{2}-\d{2}([ T]\d{2}:\d{2}(:\d{2}(\.\d+)?)?)?$/,
  time: /^\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/,
  boolean: /^(true|false)$/i,
};

/** Whether a default value can be written into a column of this type. Text takes anything. */
function defaultFits(type: string, value: string): boolean {
  const family = typeFamily(type);
  if (family === 'text' || family === 'null') return true;
  return DEFAULT_FITS[family]?.test(value.trim()) ?? false;
}

/**
 * What's wrong with a lookup's settings given its inputs' columns (left out while unknown): no keys, a key column
 * missing from its side, keys that can't be compared, nothing to bring across, a brought column that's gone, an
 * empty suffix where one is needed, and a default value a brought column can't hold. Empty when it's ready to run.
 */
export function lookupProblems(spec: LookupSpec, main?: ColumnSchema[], lookup?: ColumnSchema[]): LookupProblem[] {
  const problems: LookupProblem[] = [];
  if (!spec.keys.length) problems.push({ field: 'keys', message: 'Pick the columns to match on: one from the main input, one from the lookup.' });
  spec.keys.forEach((k, i) => {
    const m = main?.find((c) => c.name === k.main);
    const l = lookup?.find((c) => c.name === k.lookup);
    if (!k.main) problems.push({ key: i, side: 'main', message: `Pick a main column for key ${i + 1}.` });
    else if (main && !m) problems.push({ key: i, side: 'main', message: `${k.main} isn’t in the main input any more.` });
    if (!k.lookup) problems.push({ key: i, side: 'lookup', message: `Pick a lookup column for key ${i + 1}.` });
    else if (lookup && !l) problems.push({ key: i, side: 'lookup', message: `${k.lookup} isn’t in the lookup input any more.` });
    if (m && l && typeFamily(m.type) !== typeFamily(l.type)) {
      const which = k.main === k.lookup ? `${k.main} is ${describeType(m.type)} in the main input and ${describeType(l.type)} in the lookup` : `${k.main} in the main input is ${describeType(m.type)} and ${k.lookup} in the lookup is ${describeType(l.type)}`;
      problems.push({ key: i, message: `${which}; change one with Change type.` });
    }
  });
  if (!spec.columns.length) problems.push({ field: 'columns', message: 'Pick at least one column to bring across.' });
  for (const name of spec.columns) {
    const c = lookup?.find((x) => x.name === name);
    if (lookup && !c) problems.push({ field: 'columns', side: 'lookup', message: `${name} isn’t in the lookup input any more.` });
    else if (c && spec.useDefault && !defaultFits(c.type, spec.defaultValue))
      problems.push({ field: 'defaultValue', message: `${name} is ${describeType(c.type)}, so it can’t be filled with “${spec.defaultValue}”. Change the default, or leave ${name} out.` });
  }
  if (main && !spec.suffix.trim() && spec.columns.some((name) => main.some((c) => c.name === name)))
    problems.push({ field: 'suffix', message: 'Give clashing columns a suffix, such as _lookup.' });
  return problems;
}

/** Columns to start a lookup with: the lookup's columns the main input doesn't have, or failing that every one but the key. */
export function suggestLookupColumns(main: ColumnSchema[], lookup: ColumnSchema[], key: string): string[] {
  const others = lookup.filter((c) => c.name !== key).map((c) => c.name);
  const fresh = others.filter((name) => !main.some((c) => c.name === name));
  return fresh.length ? fresh : others;
}

export interface LookupColumn {
  /** Its name in the output. */
  name: string;
  /** The lookup column it comes from. */
  from: string;
}

/** The columns a lookup adds after the main input's: each brought column, given the suffix (numbered if that's taken too) where the main input has its name. */
export function lookupColumns(spec: LookupSpec, main: ColumnSchema[]): LookupColumn[] {
  const taken = new Set([...main.map((c) => c.name), ...spec.columns]);
  return spec.columns.map((from) => {
    if (!main.some((c) => c.name === from)) return { name: from, from };
    let name = `${from}${spec.suffix}`;
    for (let n = 2; taken.has(name); n++) name = `${from}${spec.suffix}${n}`;
    taken.add(name);
    return { name, from };
  });
}

const M = ident('m');
const R = ident('r');
const ROW = ident('__puddle_row');
const ORDER = ident('__puddle_order');
const HIT = ident('__puddle_hit');

/** The ON condition: every key pair equal. */
export const lookupCondition = (spec: LookupSpec, m = M, r = R) => spec.keys.map((k) => `${m}.${ident(k.main)} = ${r}.${ident(k.lookup)}`).join(' AND ');

/** The lookup input cut down to its first row (in file order) for each key, so every main row matches at most once. */
export function firstMatches(spec: LookupSpec, lookup: string): string {
  const keys = spec.keys.map((k) => ident(k.lookup)).join(', ');
  return `SELECT * EXCLUDE (${ORDER}), true AS ${HIT} FROM (SELECT *, row_number() OVER () AS ${ORDER} FROM ${lookup}) QUALIFY row_number() OVER (PARTITION BY ${keys} ORDER BY ${ORDER}) = 1`;
}

/**
 * One lookup as a SELECT over its two input relations: every main row once, in its own order, with the brought
 * columns from its first match, or empty (or the default) where its key has none. Assumes lookupProblems found nothing.
 */
export function compileLookup(spec: LookupSpec, inputs: { main: string; lookup: string }, main: ColumnSchema[], lookup: ColumnSchema[]): string {
  const kept = main.map((c) => `${M}.${ident(c.name)}`);
  const brought = lookupColumns(spec, main).map(({ name, from }) => {
    const col = `${R}.${ident(from)}`;
    // DuckDB reads a string literal as the column's own type, so the default needs no cast here.
    const text = typeFamily(lookup.find((c) => c.name === from)?.type ?? 'VARCHAR') === 'text';
    const value = spec.useDefault ? `CASE WHEN ${R}.${HIT} THEN ${col} ELSE ${str(text ? spec.defaultValue : spec.defaultValue.trim())} END` : col;
    return value === col && name === from ? col : `${value} AS ${ident(name)}`;
  });
  return (
    `SELECT ${[...kept, ...brought].join(', ')} FROM (SELECT *, row_number() OVER () AS ${ROW} FROM ${inputs.main}) AS ${M} ` +
    `LEFT JOIN (${firstMatches(spec, inputs.lookup)}) AS ${R} ON ${lookupCondition(spec)} ORDER BY ${M}.${ROW}`
  );
}
