// Whether a node's key columns have repeated values, for the relationships view's "one" and "many" ends: checked in
// the background, cached by the node's upstream key and the columns asked about.
import { compileKeyCheck, upstreamKey } from '../compiler';
import { tableRows, type EngineClient } from '../engine';
import type { Project } from '../model';
import { schemaCacheFor } from './status';

const checks = new Map<string, Promise<Record<string, boolean>>>();

/** column → true when no value of it appears twice. */
export function checkKeys(engine: EngineClient, project: Project, nodeId: string, columns: string[]): Promise<Record<string, boolean>> {
  const key = `${upstreamKey(project, { nodeId })}\u0000${columns.join('\u0000')}`;
  let hit = checks.get(key);
  if (!hit) {
    const cache = schemaCacheFor(engine);
    hit = cache
      .prepare(project, { nodeId })
      .then(() => engine.query(compileKeyCheck(project, nodeId, columns, { schemas: cache.book }), { priority: 'background', label: 'Checking keys' }))
      .then((r) => {
        const row = tableRows(r.table)[0]!;
        return Object.fromEntries(columns.map((c, i) => [c, row[`u${i}`] === true]));
      });
    checks.set(key, hit);
    hit.catch(() => checks.delete(key));
    if (checks.size > 200) checks.delete(checks.keys().next().value!);
  }
  return hit;
}
