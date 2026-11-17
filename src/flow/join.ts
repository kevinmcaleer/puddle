// Whether a Join multiplies rows: counted in the background once the join is ok, cached by its upstream key.
import { compileJoinCheck, compileJoinTidyCheck, KEY_TIDIES, upstreamKey, type KeyTidy } from '../compiler';
import { tableRows, type EngineClient } from '../engine';
import type { JoinKind, Project } from '../model';
import { fullCount } from '../ui/format';
import { schemaCacheFor } from './status';

export interface JoinCounts {
  leftRows: number;
  rightRows: number;
  rows: number;
  pairs: number;
  matchedLeft: number;
  matchedRight: number;
}

export function parseJoinCounts(row: Record<string, unknown>): JoinCounts {
  const n = (k: string) => Number(row[k] ?? 0);
  return { leftRows: n('left_rows'), rightRows: n('right_rows'), rows: n('rows'), pairs: n('pairs'), matchedLeft: n('matched_left'), matchedRight: n('matched_right') };
}

/**
 * When some row on the kept side matched more than one row on the other, the join has more rows than that
 * side had: `side` is the side whose rows multiplied, `before` its rows and `after` the join's. Anti and semi
 * joins keep each left row at most once, so they never multiply.
 */
export type Multiplied = { side: 'left' | 'right'; before: number; after: number };

export function multiplied(kind: JoinKind, c: JoinCounts): Multiplied | undefined {
  if (kind === 'anti' || kind === 'semi') return undefined;
  if (kind === 'right') return c.pairs > c.matchedRight ? { side: 'right', before: c.rightRows, after: c.rows } : undefined;
  return c.pairs > c.matchedLeft ? { side: 'left', before: c.leftRows, after: c.rows } : undefined;
}

const checks = new Map<string, Promise<JoinCounts>>();

/** Count a Join's inputs, output and matches at background priority. Cached until its upstream changes. */
export function checkJoin(engine: EngineClient, project: Project, nodeId: string): Promise<JoinCounts> {
  const key = upstreamKey(project, { nodeId });
  let hit = checks.get(key);
  if (!hit) {
    const cache = schemaCacheFor(engine);
    hit = cache
      .prepare(project, { nodeId })
      .then(() => engine.query(compileJoinCheck(project, nodeId, { schemas: cache.book }), { priority: 'background' }))
      .then((r) => parseJoinCounts(tableRows(r.table)[0]!));
    checks.set(key, hit);
    hit.catch(() => checks.delete(key));
    if (checks.size > 200) checks.delete(checks.keys().next().value!);
  }
  return hit;
}

type Side = 'left' | 'right';

/** The side whose rows a join is about: the right for a right join, else the left. */
export const keptSide = (kind: JoinKind): Side => (kind === 'right' ? 'right' : 'left');

/** How one side of a join matched: its rows, and how many of them have a match on the other side. */
export function sideMatch(c: JoinCounts, side: Side): { rows: number; matched: number; unmatched: number } {
  const [rows, matched] = side === 'left' ? [c.leftRows, c.matchedLeft] : [c.rightRows, c.matchedRight];
  return { rows, matched, unmatched: rows - matched };
}

/** "52 of 60 left rows matched (87%)" */
export function joinMatchRate(c: JoinCounts, side: Side): string {
  const { rows, matched } = sideMatch(c, side);
  const pct = rows ? Math.round((100 * matched) / rows) : 0;
  return `${fullCount(matched)} of ${fullCount(rows)} ${side} ${rows === 1 ? 'row' : 'rows'} matched (${pct}%)`;
}

/** What becomes of the rows on the kept side that found no match, by join type. */
export function unmatchedFate(kind: JoinKind): string {
  switch (kind) {
    case 'inner':
    case 'semi':
      return 'They are left out of this join.';
    case 'anti':
      return 'They are the rows this join keeps.';
    case 'right':
      return 'Their left columns are empty.';
    default:
      return 'Their right columns are empty.';
  }
}

/** Rows with a match on each side once the text keys are tidied in each way. */
export type TidyCounts = Record<keyof typeof KEY_TIDIES, { left: number; right: number }>;

export function parseTidyCounts(row: Record<string, unknown>): TidyCounts {
  const n = (k: string) => Number(row[k] ?? 0);
  return { trim: { left: n('trim_left'), right: n('trim_right') }, upper: { left: n('upper_left'), right: n('upper_right') }, both: { left: n('both_left'), right: n('both_right') } };
}

/** A tidy of the keys that would match more rows: what to do, and how many more rows of the kept side would match. */
export type Cure = { tidy: KeyTidy; gained: number };

/**
 * The least change to the text keys that matches the most rows of the kept side: trimming alone or one case alone
 * when either does as well as both. Undefined when no tidy matches more rows than the join does now.
 */
export function joinCure(kind: JoinKind, c: JoinCounts, t: TidyCounts): Cure | undefined {
  const side = keptSide(kind);
  const now = sideMatch(c, side).matched;
  const best = Math.max(t.trim[side], t.upper[side], t.both[side]);
  if (best <= now) return undefined;
  const name = (['trim', 'upper', 'both'] as const).find((k) => t[k][side] === best)!;
  return { tidy: KEY_TIDIES[name], gained: best - now };
}

/** "Trim the spaces", "Use one case", "Trim the spaces and use one case": a cure in words. */
export const cureWords = (tidy: KeyTidy) => (tidy.trim && tidy.upper ? 'Trimming the spaces and using capitals' : tidy.trim ? 'Trimming the spaces' : 'Using capitals');

const tidies = new Map<string, Promise<TidyCounts | undefined>>();

/** Count what tidying a Join's text keys would match, at background priority. Undefined when it has no text keys. */
export function checkJoinTidy(engine: EngineClient, project: Project, nodeId: string): Promise<TidyCounts | undefined> {
  const key = upstreamKey(project, { nodeId });
  let hit = tidies.get(key);
  if (!hit) {
    const cache = schemaCacheFor(engine);
    hit = cache.prepare(project, { nodeId }).then(async () => {
      const sql = compileJoinTidyCheck(project, nodeId, { schemas: cache.book });
      return sql ? parseTidyCounts(tableRows((await engine.query(sql, { priority: 'background' })).table)[0]!) : undefined;
    });
    tidies.set(key, hit);
    hit.catch(() => tidies.delete(key));
    if (tidies.size > 200) tidies.delete(tidies.keys().next().value!);
  }
  return hit;
}
