// How a Lookup matched: counted in the background once it's ok, cached by its upstream key.
import { compileLookupCheck, upstreamKey } from '../compiler';
import { tableRows, type EngineClient } from '../engine';
import type { Project } from '../model';
import { schemaCacheFor } from './status';

export interface LookupCounts {
  /** Rows in the main input, and so out of the lookup. */
  rows: number;
  /** Main rows whose key found a match. */
  matched: number;
  /** Distinct main keys that match more than one lookup row, and the main rows that have them. */
  dupKeys: number;
  dupRows: number;
  dupExample?: string;
  /** Distinct main keys with no match. */
  missingKeys: number;
  missingExample?: string;
}

export function parseLookupCounts(row: Record<string, unknown>): LookupCounts {
  const n = (k: string) => Number(row[k] ?? 0);
  const s = (k: string) => (row[k] == null ? undefined : String(row[k]));
  return { rows: n('rows'), matched: n('matched'), dupKeys: n('dup_keys'), dupRows: n('dup_rows'), dupExample: s('dup_example'), missingKeys: n('missing_keys'), missingExample: s('missing_example') };
}

/** "4 of 5 rows matched (80%)" */
export function matchRate(c: LookupCounts): string {
  const pct = c.rows ? Math.round((100 * c.matched) / c.rows) : 0;
  return `${c.matched.toLocaleString()} of ${c.rows.toLocaleString()} ${c.rows === 1 ? 'row' : 'rows'} matched (${pct}%)`;
}

const checks = new Map<string, Promise<LookupCounts>>();

/** Count a Lookup's matches, duplicate keys and missing keys at background priority. Cached until its upstream changes. */
export function checkLookup(engine: EngineClient, project: Project, nodeId: string): Promise<LookupCounts> {
  const key = upstreamKey(project, { nodeId });
  let hit = checks.get(key);
  if (!hit) {
    const cache = schemaCacheFor(engine);
    hit = cache
      .prepare(project, { nodeId })
      .then(() => engine.query(compileLookupCheck(project, nodeId, { schemas: cache.book }), { priority: 'background', label: 'Checking lookup matches' }))
      .then((r) => parseLookupCounts(tableRows(r.table)[0]!));
    checks.set(key, hit);
    hit.catch(() => checks.delete(key));
    if (checks.size > 200) checks.delete(checks.keys().next().value!);
  }
  return hit;
}
