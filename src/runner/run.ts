// One run of a project: place its sources, check the quality gate, write every Output node's file, and leave a run
// log and a quality report beside the outputs. The same compiler the browser uses; DuckDB's native build runs it.
// Only pure modules are imported here (model, compiler, the gate, the XML and Access readers, the connectors as
// Node runs them), so the bundle never touches the browser engine.
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { columnsToCsv } from '../access/csv';
import { openDatabase, readTable } from '../access/read';
import { compileAccessLoad, compileConnectionLoad, compileExport, compileLoadCheck, compileRules, describeFailure, dropTable, exportFileName, fullData, SchemaCache, sourceFileName, sourceTableName, str } from '../compiler';
import { nodeConnectors } from '../connect/node';
import { readRequestOf } from '../connect/request';
import type { Connector } from '../connect/types';
import { buildSchema } from '../schemaTables/build';
import { describeBlock, exportGate, type BlockingRule } from '../flow/gate';
import type { RuleResult } from '../flow/ruleResult';
import { nodeById, topoSort, upstreamIds, type OutputNode, type Project } from '../model';
import { qualityMarkdown } from './report';
import { readFeed } from '../sources/odata';
import { describeConnectionSource, type PlaceOptions } from './connections';
import { placeSources, type SourcePlace } from './sources';
import type { RunnerDb } from './db';
import { tableToCsv, xmlToTable } from '../xml';

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
  sources: { id: string; name: string; path?: string; problem?: string; /** A connection source: what it read, and how many rows came. */ connection?: string; rows?: number }[];
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
  /** How OData feeds are fetched, page by page; the global fetch when not given. */
  fetchImpl?: typeof fetch;
  /** The secrets and drivers connection sources are read with; without it they are reported as unreadable. */
  connections?: PlaceOptions;
  /** The drivers, by id; the Node registry reading files inside the project's folder when not given. */
  connectors?: Partial<Record<string, Connector>>;
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

const fetchOrThrow = (fetchText: RunOptions['fetchText'], address: string) => {
  if (!fetchText) throw new Error('no way to fetch it');
  return fetchText(address);
};

/**
 * Put each source where the compiled SQL reads it: a link to the file, the pasted text, or the fetched address. An
 * Access table is written as CSV, and the statement that loads it as the typed table the SQL reads goes in `loads`;
 * a connection source's rows are read through its driver into a staging table in `db`, and its load goes there too.
 */
async function stage(places: SourcePlace[], stageDir: string, { fetchText, fetchImpl, db, connectors }: Pick<RunOptions, 'fetchText' | 'fetchImpl' | 'db' | 'connectors'>, loads: Map<string, string>, read: Map<string, number>): Promise<Map<string, string>> {
  const problems = new Map<string, string>();
  // Each Access database is opened once, however many of its tables the project reads.
  const databases = new Map<string, ReturnType<typeof openDatabase>>();
  for (const p of places) {
    const { source } = p;
    if (p.path === undefined) {
      problems.set(source.id, p.reason);
      continue;
    }
    const target = join(stageDir, sourceFileName(source));
    try {
      if (p.connection) {
        // Read as in the browser: the driver's Arrow stream into a staging table, then cast to the types it declared.
        const { connection, secret } = p.connection;
        const connector = connectors?.[connection.driver];
        if (!connector) throw new Error(`no ${connection.driver} driver in this runner`);
        const r = await connector.read({ connection, secret }, readRequestOf(source.connection!));
        if (!('ipc' in r)) throw new Error('its driver answered with a relation of the engine, which the runner can’t load');
        const table = sourceTableName(source);
        const staging = `${table}_arrow`;
        await db.insertArrow(staging, r.ipc);
        loads.set(source.id, compileConnectionLoad(table, r.columns, { staging }));
        read.set(source.id, r.rows);
      } else if (source.format === 'access') {
        // Read as in the browser: mdb-reader, then each column given its Access type by DuckDB.
        const table = sourceTableName(source);
        let db = databases.get(p.path);
        if (!db) databases.set(p.path, (db = openDatabase(new Uint8Array(readFileSync(p.path)))));
        const data = readTable(db, source.parseOptions.table);
        writeFileSync(join(stageDir, `${table}.csv`), columnsToCsv(data.columns));
        loads.set(source.id, compileAccessLoad(table, data.columns, { csv: `${table}.csv` }));
      } else if (source.format === 'xml') {
        // DuckDB reads the CSV Puddle writes from the XML's records, as in the browser.
        const xml = source.kind === 'clipboard' ? source.clipboard!.text : source.kind === 'url' ? await fetchOrThrow(fetchText, p.path) : new Uint8Array(readFileSync(p.path));
        const o = source.parseOptions;
        writeFileSync(target, tableToCsv(await xmlToTable(xml, { record: o.record, expand: o.expand })));
      } else if (source.kind === 'clipboard') writeFileSync(target, source.clipboard!.text);
      else if (source.url?.odata) writeFileSync(target, (await readFeed(new URL(p.path), source.url.odata, { fetchImpl })).csv);
      else if (source.kind === 'url') writeFileSync(target, await fetchOrThrow(fetchText, p.path));
      else symlinkSync(p.path, target);
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
  const places = placeSources(full, opts.folder, existsSync, opts.connections);
  const read = new Map<string, number>();
  try {
    const loads = new Map<string, string>();
    const connectors = opts.connectors ?? (places.some((p) => p.connection) ? nodeConnectors({ files: [opts.folder] }) : undefined);
    const problems = await stage(places, stageDir, { ...opts, connectors }, loads, read);
    // The compiled SQL reads `src_<id>.csv` by bare name; DuckDB looks for it here.
    await opts.db.query(`SET file_search_path = ${str(stageDir)}`);
    for (const [id, sql] of loads) await opts.db.query(sql).catch((e: unknown) => problems.set(id, `couldn’t be read: ${e instanceof Error ? e.message : String(e)}`));
    // The staging tables have been cast into their sources' tables.
    for (const p of places) if (p.connection) await opts.db.query(dropTable(`${sourceTableName(p.source)}_arrow`)).catch(() => undefined);
    for (const [id, why] of problems) say(`Source ${full.sources.find((s) => s.id === id)?.name ?? id} ${why.replace(/\.$/, '')}.`);
    for (const p of places) if (p.connection && read.has(p.source.id)) say(`Source ${p.source.name}: read ${read.get(p.source.id)} rows from ${describeConnectionSource(p.source, p.connection)}.`);

    // Schema table nodes read the project's DBML built as tables, as in the browser.
    const tableNodes = full.nodes.filter((n) => n.type === 'table');
    const builtTables = tableNodes.length ? await buildSchema(opts.db, full) : undefined;
    for (const [name, t] of Object.entries(builtTables?.tables ?? {})) if (t.state === 'failed') say(`Schema table ${name} not built: ${t.message}`);

    // Joins and appends compile from their inputs' columns, which the cache describes into the shared schema book.
    const schemas = new SchemaCache((sql) => opts.db.describe(sql));
    const outputNodes = full.nodes.filter((n): n is OutputNode => n.type === 'output');
    for (const node of [...tableNodes, ...outputNodes]) await schemas.prepare(full, { nodeId: node.id }).catch(() => undefined);
    // A load a schema table refuses stops every output below it, as the node does in the browser.
    const refused = new Map<string, string>();
    for (const node of tableNodes) {
      try {
        const check = compileLoadCheck(full, node.id, { schemas: schemas.book });
        if (!check?.checks.length) continue;
        const row = (await opts.db.query(check.sql))[0] ?? {};
        const failures = check.checks.flatMap((c, i) => (Number(row[`f${i}`] ?? 0) ? [describeFailure(c, Number(row[`f${i}`]))] : []));
        if (failures.length) refused.set(node.id, `${node.name} can’t take some of the rows loaded into it: ${failures.join('; ')}.`);
      } catch (e) {
        refused.set(node.id, `${node.name} can’t be checked: ${e instanceof Error ? e.message.split('\n')[0] : String(e)}`);
      }
    }
    rules = await checkAllRules(opts.db, full, say);

    for (const node of outputNodes) {
      const missing = sourcesAbove(full, node.id).filter((id) => problems.has(id));
      if (missing.length) {
        outputs.push({ nodeId: node.id, nodeName: node.name, status: 'skipped', reason: `source ${missing.map((id) => full.sources.find((s) => s.id === id)?.name ?? id).join(', ')} ${problems.get(missing[0]!)}` });
        continue;
      }
      const loads = [...upstreamIds(full, node.id)].flatMap((id) => (refused.has(id) ? [refused.get(id)!] : []));
      if (loads.length) {
        outputs.push({ nodeId: node.id, nodeName: node.name, status: 'blocked', blocking: loads });
        say(`${node.name} not written: ${loads.join(' ')}`);
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
    sources: places.map((p) => ({
      id: p.source.id,
      name: p.source.name,
      ...(p.path !== undefined ? { path: p.path || undefined } : { problem: p.reason }),
      ...(p.connection ? { connection: describeConnectionSource(p.source, p.connection), ...(read.has(p.source.id) ? { rows: read.get(p.source.id) } : {}) } : {}),
    })),
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
