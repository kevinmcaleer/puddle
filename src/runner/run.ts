// One run of a project: place its sources, check the quality gate, write every Output node's file, and leave a run
// log and a quality report beside the outputs. The same compiler the browser uses; DuckDB's native build runs it.
// Only pure modules are imported here (model, compiler, the gate), so the bundle never touches the browser engine.
import { existsSync, mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { compileExport, compileRules, exportFileName, fullData, SchemaCache, sourceFileName, str } from '../compiler';
import { describeBlock, exportGate, type BlockingRule } from '../flow/gate';
import type { RuleResult } from '../flow/ruleResult';
import { nodeById, topoSort, upstreamIds, type OutputNode, type Project } from '../model';
import { qualityMarkdown } from './report';
import { placeSources, type SourcePlace } from './sources';
import type { RunnerDb } from './db';

export const RUN_LOG_SCHEMA = 'puddle-run/1';

export type OutputStatus = 'written' | 'blocked' | 'skipped' | 'failed';

export interface OutputRun {
  nodeId: string;
  nodeName: string;
  status: OutputStatus;
  /** The file written, relative to the output folder. */
  file?: string;
  rows?: number;
  /** Why it was blocked, one line per failing rule. */
  blocking?: string[];
  /** Why it was skipped or failed. */
  reason?: string;
}

export interface RunLog {
  schema: typeof RUN_LOG_SCHEMA;
  project: { id: string; name: string };
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  sources: { id: string; name: string; path?: string; problem?: string }[];
  outputs: OutputRun[];
  /** Every enabled rule's result, by node and rule id. */
  rules: Record<string, Record<string, RuleResult>>;
}

export interface RunOptions {
  /** The folder the project file came from; source files are looked for here. */
  folder: string;
  /** Where outputs, the run log and the quality report go. */
  outDir: string;
  db: RunnerDb;
  now?: () => Date;
  fetchText?: (href: string) => Promise<string>;
  log?: (line: string) => void;
}

/** "Orders clean-up" to "orders-clean-up", for the run log and report file names. */
export const projectSlug = (name: string) =>
  name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/[\s_-]+/g, '-') || 'project';

/** Put each source where the compiled SQL reads it: a link to the file, the pasted text, or the fetched address. */
async function stage(places: SourcePlace[], stageDir: string, fetchText: RunOptions['fetchText']): Promise<Map<string, string>> {
  const problems = new Map<string, string>();
  for (const p of places) {
    const { source } = p;
    if (p.path === undefined) {
      problems.set(source.id, p.reason);
      continue;
    }
    const target = join(stageDir, sourceFileName(source));
    try {
      if (source.kind === 'clipboard') writeFileSync(target, source.clipboard!.text);
      else if (source.kind === 'url') {
        if (!fetchText) throw new Error('no way to fetch it');
        writeFileSync(target, await fetchText(p.path));
      } else symlinkSync(p.path, target);
    } catch (e) {
      problems.set(source.id, `couldn’t be read: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return problems;
}

/** The ids of the sources a node reads, through every wire above it. */
function sourcesAbove(project: Project, nodeId: string): string[] {
  return topoSort(project, upstreamIds(project, nodeId)).flatMap((id) => {
    const n = nodeById(project, id);
    return n?.type === 'source' ? [n.sourceId] : [];
  });
}

/** Check every enabled rule of every node, so the gate and the report have them all. One query per node. */
async function checkAllRules(db: RunnerDb, project: Project, log: (line: string) => void): Promise<RunLog['rules']> {
  const results: RunLog['rules'] = {};
  for (const node of project.nodes) {
    const rules = node.rules.filter((r) => r.enabled);
    if (!rules.length) continue;
    results[node.id] = {};
    try {
      const row = (await db.query(compileRules(project, node.id, rules)))[0]!;
      rules.forEach((r, i) => (results[node.id]![r.id] = { state: 'ok', failures: Number(row[`f${i}`]), total: Number(row.total) }));
    } catch {
      // One bad rule fails the batch: check them one by one to say which.
      for (const r of rules) {
        try {
          const row = (await db.query(compileRules(project, node.id, [r])))[0]!;
          results[node.id]![r.id] = { state: 'ok', failures: Number(row.f0), total: Number(row.total) };
        } catch (err) {
          const message = (err instanceof Error ? err.message : String(err)).split('\n')[0]!;
          results[node.id]![r.id] = { state: 'error', message };
          log(`Rule “${r.label}” in ${node.name} can’t run: ${message}`);
        }
      }
    }
  }
  return results;
}

/** Run every Output node of the project once. Never throws for one output's sake: each gets its own status. */
export async function runProject(project: Project, opts: RunOptions): Promise<{ log: RunLog; report: string }> {
  const now = opts.now ?? (() => new Date());
  const say = opts.log ?? (() => undefined);
  const started = now();
  const full = fullData(project);
  const stageDir = mkdtempSync(join(tmpdir(), 'puddle-run-'));
  mkdirSync(opts.outDir, { recursive: true });
  const outputs: OutputRun[] = [];
  let rules: RunLog['rules'] = {};
  const places = placeSources(full, opts.folder, existsSync);
  try {
    const problems = await stage(places, stageDir, opts.fetchText);
    // The compiled SQL reads `src_<id>.csv` by bare name; DuckDB looks for it here.
    await opts.db.query(`SET file_search_path = ${str(stageDir)}`);
    for (const [id, why] of problems) say(`Source ${full.sources.find((s) => s.id === id)?.name ?? id} ${why}.`);

    // Joins and appends compile from their inputs' columns, which the cache describes into the shared schema book.
    const schemas = new SchemaCache((sql) => opts.db.describe(sql));
    const outputNodes = full.nodes.filter((n): n is OutputNode => n.type === 'output');
    for (const node of outputNodes) await schemas.prepare(full, { nodeId: node.id }).catch(() => undefined);
    rules = await checkAllRules(opts.db, full, say);

    for (const node of outputNodes) {
      const missing = sourcesAbove(full, node.id).filter((id) => problems.has(id));
      if (missing.length) {
        outputs.push({ nodeId: node.id, nodeName: node.name, status: 'skipped', reason: `source ${missing.map((id) => full.sources.find((s) => s.id === id)?.name ?? id).join(', ')} ${problems.get(missing[0]!)}` });
        continue;
      }
      const gate = exportGate(full, node.id, Object.fromEntries(Object.entries(rules).map(([id, r]) => [id, { results: r }])));
      if (gate.state === 'blocked') {
        outputs.push({ nodeId: node.id, nodeName: node.name, status: 'blocked', blocking: gate.blocking.map((b: BlockingRule) => describeBlock(b)) });
        say(`${node.name} not written: ${gate.blocking.map(describeBlock).join(' ')}`);
        continue;
      }
      const format = node.outputSpec.format;
      if (format === 'xlsx' || format === 'clipboard') {
        outputs.push({ nodeId: node.id, nodeName: node.name, status: 'skipped', reason: format === 'xlsx' ? 'Excel workbooks are written by the browser only, for now' : 'a clipboard output has nowhere to go on the runner' });
        continue;
      }
      const file = exportFileName(node.name, node.outputSpec);
      try {
        const row = (await opts.db.query(compileExport(full, node.id, join(opts.outDir, file))))[0];
        const rows = Number(row?.Count ?? row?.count ?? 0);
        outputs.push({ nodeId: node.id, nodeName: node.name, status: 'written', file, rows });
        say(`${node.name}: wrote ${rows} rows to ${file}`);
      } catch (e) {
        outputs.push({ nodeId: node.id, nodeName: node.name, status: 'failed', reason: e instanceof Error ? e.message.split('\n')[0]! : String(e) });
        say(`${node.name} failed: ${e instanceof Error ? e.message.split('\n')[0] : String(e)}`);
      }
    }
  } finally {
    rmSync(stageDir, { recursive: true, force: true });
  }
  const finished = now();
  const log: RunLog = {
    schema: RUN_LOG_SCHEMA,
    project: { id: project.id, name: project.name },
    startedAt: started.toISOString(),
    finishedAt: finished.toISOString(),
    durationMs: finished.getTime() - started.getTime(),
    sources: places.map((p) => ({ id: p.source.id, name: p.source.name, ...(p.path !== undefined ? { path: p.path || undefined } : { problem: p.reason }) })),
    outputs,
    rules,
  };
  const report = qualityMarkdown(full, rules, finished.toISOString());
  const slug = projectSlug(project.name);
  writeFileSync(join(opts.outDir, `${slug}.run.json`), JSON.stringify(log, null, 2) + '\n');
  writeFileSync(join(opts.outDir, `${slug}.quality.md`), report);
  return { log, report };
}

/** True when every Output node was written. */
export const runSucceeded = (log: RunLog) => log.outputs.length > 0 && log.outputs.every((o) => o.status === 'written');
