// Whether a Join multiplies rows: counted in the background once the join is ok, cached by its upstream key.
import { compileJoinCheck, upstreamKey } from '../compiler';
import { tableRows, type EngineClient } from '../engine';
import type { JoinKind, Project } from '../model';
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
