// What a report reads from the engine: each source's row count and head hash, and sample failing rows per rule.
import { compile, compileDisplayPage, fullData, ruleRefs, ruleScope } from '../compiler';
import { tableRows, toEngineError, type EngineClient } from '../engine';
import type { RuleResult } from '../flow/rules';
import { countRows, schemaCacheFor } from '../flow/status';
import { nodeById, type Project, type Source } from '../model';
import { headHash } from '../sources/hash';
import { reportSources, type ReportSample, type ReportSource } from './build';

const LABEL = 'Writing the quality report';

async function hashOf(source: Source): Promise<string | null> {
  if (source.file) return source.file.headHash;
  if (source.url) return source.url.headHash ?? null;
  if (source.clipboard) return headHash(new Blob([source.clipboard.text]));
  return null;
}

/**
 * The sources the report's nodes read, each with its full row count (the count the flow already keeps, so usually
 * no query runs) and head hash. A source that can't be read has no count.
 */
export async function collectSources(engine: EngineClient, project: Project, nodeIds: string[]): Promise<ReportSource[]> {
  return Promise.all(
    reportSources(project, nodeIds).map(async ({ source, nodeId }) => {
      const rows = await countRows(engine, project, nodeId).catch(() => null);
      return { id: source.id, name: source.name, kind: source.kind, format: source.format, rows, headHash: await hashOf(source) };
    }),
  );
}

/**
 * Up to `limit` failing rows of each failing row rule of a node, from the failing-rows view, read from `view` (the
 * project as the rules panel checked it: sampled in sample mode), so they agree with the counts. Values come back as
 * the results table shows them.
 */
export async function collectSamples(
  engine: EngineClient,
  view: Project,
  nodeId: string,
  results: Record<string, RuleResult> | undefined,
  limit: number,
): Promise<Record<string, ReportSample>> {
  const out: Record<string, ReportSample> = {};
  const node = nodeById(view, nodeId);
  if (!node || limit <= 0) return out;
  const failing = node.rules.filter((r) => {
    const res = results?.[r.id];
    return r.enabled && ruleScope(r) === 'row' && res?.state === 'ok' && res.failures > 0;
  });
  if (!failing.length) return out;
  const columns = (await engine.describe(compile(view, { nodeId }).sql, { priority: 'preview', label: LABEL })).map((c) => c.name);
  for (const rule of failing) {
    try {
      // A rule reading another node reads it on the full data, as the rules check does.
      for (const id of ruleRefs(rule)) await schemaCacheFor(engine).prepare(fullData(view), { nodeId: id });
      const result = await engine.query(compileDisplayPage(view, { nodeId, failingRuleId: rule.id }, columns, 0, limit), { priority: 'preview', label: LABEL });
      const rows = tableRows(result.table).map((r) => columns.map((c) => (r[c] == null ? null : String(r[c]))));
      out[rule.id] = { columns, rows };
    } catch (e) {
      const err = toEngineError(e);
      if (err.code === 'stopped' || err.code === 'cancelled') throw err;
      out[rule.id] = { columns, rows: [], error: err.message };
    }
  }
  return out;
}
