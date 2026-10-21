// One run of a project: place its sources, check the quality gate, write every Output node's file, and leave a run
// log and a quality report beside the outputs. The same compiler the browser uses; DuckDB's native build runs it.
// Only pure modules are imported here (model, compiler, the gate, the XML, Access, spreadsheet, archive and Arrow readers), so the bundle never touches the browser engine.
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { columnsToCsv } from '../access/csv';
import { readEntry } from '../archive';
import { arrowColumns, readArrowFile } from '../arrow/read';
import { openDatabase, readTable } from '../access/read';
import { parseWorkbook, readSheet } from '../excel/read';
import { compileAccessLoad, compileCount, compileExport, compileLoadCheck, compileRules, describeFailure, exportFileName, fullData, readsCompressed, SchemaCache, sourceFileName, sourceTableName, str } from '../compiler';
import { buildSchema } from '../schemaTables/build';
import { describeBlock, exportGate, type BlockingRule } from '../flow/gate';
import type { RuleResult } from '../flow/ruleResult';
import { nodeById, topoSort, upstreamIds, type OutputNode, type Project } from '../model';
import { reportFiles, runReport } from './report';
import type { QualityReport, ReportSource } from '../report/build';
import { readFeed } from '../sources/odata';
import { placeSources, type SourcePlace } from './sources';
import type { RunnerDb } from './db';
import { tableToCsv, xmlToTable } from '../xml';
import { loadPdfPages } from '../pdf/node';
import { decodeText, isRewrittenText, readPdf, readText, readWord, rewrittenCsv } from '../sources/text';

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
  /** How OData feeds are fetched, page by page; the global fetch when not given. */
  fetchImpl?: typeof fetch;
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

/** A file at an address as bytes (a spreadsheet, read whole). */
async function fetchBytes(fetchImpl: RunOptions['fetchImpl'], address: string): Promise<Uint8Array> {
  const response = await (fetchImpl ?? globalThis.fetch)(address);
  if (!response.ok) throw new Error(`${address} answered ${response.status}`);
  return new Uint8Array(await response.arrayBuffer());
}

/**
 * Put each source where the compiled SQL reads it: a link to the file, the pasted text, or the fetched address. An
 * Access table or a sheet is written as CSV, and the statement that loads it as the typed table the SQL reads goes
 * in `loads`.
 */
async function stage(places: SourcePlace[], stageDir: string, { fetchText, fetchImpl }: Pick<RunOptions, 'fetchText' | 'fetchImpl'>, loads: Map<string, string>): Promise<Map<string, string>> {
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
      // A file inside a .gz or .zip is unpacked first, as in the browser; a gzipped text file DuckDB reads as it is
      // (sourceFileName keeps its .gz) is linked whole and unpacked as it is read.
      const bytes = async () => (source.archive && !readsCompressed(source) ? await readEntry(new Uint8Array(readFileSync(p.path!)), source.archive.kind, source.archive.entry) : new Uint8Array(readFileSync(p.path!)));
      if (source.format === 'arrow') {
        // Read as in the browser: the Arrow library, then each column given its type by DuckDB.
        const table = sourceTableName(source);
        const columns = arrowColumns(readArrowFile(await bytes()));
        writeFileSync(join(stageDir, `${table}.csv`), columnsToCsv(columns));
        loads.set(source.id, compileAccessLoad(table, columns, { csv: `${table}.csv` }));
      } else if (source.format === 'access') {
        // Read as in the browser: mdb-reader, then each column given its Access type by DuckDB.
        const table = sourceTableName(source);
        let db = databases.get(p.path);
        if (!db) databases.set(p.path, (db = openDatabase(await bytes())));
        const data = readTable(db, source.parseOptions.table);
        writeFileSync(join(stageDir, `${table}.csv`), columnsToCsv(data.columns));
        loads.set(source.id, compileAccessLoad(table, data.columns, { csv: `${table}.csv` }));
      } else if (source.format === 'xlsx') {
        // Read as in the browser: SheetJS with the project's sheet options, then each column given its type by DuckDB.
        const table = sourceTableName(source);
        const o = source.parseOptions;
        const data = readSheet(parseWorkbook(source.kind === 'url' ? await fetchBytes(fetchImpl, p.path) : await bytes()), { sheet: o.sheet, headerRow: o.headerRow, range: o.range, headerRows: o.headerRows, fillMerges: o.fillMerges });
        writeFileSync(join(stageDir, `${table}.csv`), columnsToCsv(data.columns));
        loads.set(source.id, compileAccessLoad(table, data.columns.map((c) => ({ name: c.name, sqlType: c.type })), { csv: `${table}.csv` }));
      } else if (source.format === 'xml') {
        // DuckDB reads the CSV Puddle writes from the XML's records, as in the browser.
        const xml = source.kind === 'clipboard' ? source.clipboard!.text : source.kind === 'url' ? await fetchOrThrow(fetchText, p.path) : await bytes();
        const o = source.parseOptions;
        writeFileSync(target, tableToCsv(await xmlToTable(xml, { record: o.record, expand: o.expand })));
      } else if (source.format === 'pdf') {
        // The table of the PDF the project reads, as in the browser (pdf.js, a runtime dependency of puddle-run).
        writeFileSync(target, rewrittenCsv(readPdf(await loadPdfPages(source.kind === 'url' ? await fetchBytes(fetchImpl, p.path) : await bytes()), source.parseOptions)));
      } else if (source.format === 'word') {
        // The table of the document the project reads, as in the browser, then DuckDB reads the CSV.
        writeFileSync(target, rewrittenCsv(await readWord(source.kind === 'url' ? await fetchBytes(fetchImpl, p.path) : await bytes(), source.parseOptions)));
      } else if (isRewrittenText(source)) {
        // Fixed-width text, pipe tables and structured text: read into rows as in the browser, then DuckDB reads the CSV.
        const text = source.kind === 'clipboard' ? source.clipboard!.text : source.kind === 'url' ? await fetchOrThrow(fetchText, p.path) : decodeText(await bytes(), source.parseOptions.encoding);
        writeFileSync(target, rewrittenCsv(readText(source.format, text, source.parseOptions)));
      } else if (source.kind === 'clipboard') writeFileSync(target, source.clipboard!.text);
      else if (source.url?.odata) writeFileSync(target, (await readFeed(new URL(p.path), source.url.odata, { fetchImpl })).csv);
      else if (source.kind === 'url') writeFileSync(target, await fetchOrThrow(fetchText, p.path));
      else if (source.archive && !readsCompressed(source)) writeFileSync(target, await bytes());
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

export interface Staged {
  places: SourcePlace[];
  /** Why a source couldn't be placed or read, by source id. */
  problems: Map<string, string>;
  /** Take the staged files away. */
  done(): void;
}

/**
 * Put the project's sources where its compiled SQL reads them and point DuckDB there, so any node of the project can
 * be queried on `opts.db` until `done()`.
 */
export async function stageProject(full: Project, opts: Pick<RunOptions, 'folder' | 'db' | 'fetchText' | 'fetchImpl'>): Promise<Staged> {
  const stageDir = mkdtempSync(join(tmpdir(), 'puddle-run-'));
  const places = placeSources(full, opts.folder, existsSync);
  const loads = new Map<string, string>();
  const problems = await stage(places, stageDir, opts, loads);
  // The compiled SQL reads `src_<id>.csv` by bare name; DuckDB looks for it here.
  await opts.db.query(`SET file_search_path = ${str(stageDir)}`);
  for (const [id, sql] of loads) await opts.db.query(sql).catch((e: unknown) => problems.set(id, `couldn’t be read: ${e instanceof Error ? e.message : String(e)}`));
  return { places, problems, done: () => rmSync(stageDir, { recursive: true, force: true }) };
}

/** The sources as the report lists them: each one's row count (none when it couldn't be read) and head hash. */
async function reportSources(db: RunnerDb, full: Project, staged: Staged): Promise<ReportSource[]> {
  return Promise.all(
    staged.places.map(async ({ source }): Promise<ReportSource> => {
      const node = full.nodes.find((n) => n.type === 'source' && n.sourceId === source.id);
      const rows = node && !staged.problems.has(source.id) ? await db.query(compileCount(full, { nodeId: node.id })).then((r) => Number(Object.values(r[0] ?? {})[0] ?? 0)).catch(() => null) : null;
      return { id: source.id, name: source.name, kind: source.kind, format: source.format, rows, headHash: source.file?.headHash || source.url?.headHash || null };
    }),
  );
}

/** Run every Output node of the project once. Never throws for one output's sake: each gets its own status. */
export async function runProject(project: Project, opts: RunOptions): Promise<{ log: RunLog; report: string; quality: QualityReport }> {
  const now = opts.now ?? (() => new Date());
  const say = opts.log ?? (() => undefined);
  const started = now();
  const full = fullData(project);
  mkdirSync(opts.outDir, { recursive: true });
  const outputs: OutputRun[] = [];
  let rules: RunLog['rules'] = {};
  const staged = await stageProject(full, opts);
  const { places, problems } = staged;
  let sources: ReportSource[] = [];
  try {
    for (const [id, why] of problems) say(`Source ${full.sources.find((s) => s.id === id)?.name ?? id} ${why}.`);
    sources = await reportSources(opts.db, full, staged);

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
    staged.done();
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
  const quality = runReport(full, rules, sources, finished.toISOString());
  const slug = projectSlug(project.name);
  writeFileSync(join(opts.outDir, `${slug}.run.json`), JSON.stringify(log, null, 2) + '\n');
  const files = reportFiles(quality, slug);
  for (const [name, text] of Object.entries(files)) writeFileSync(join(opts.outDir, name), text);
  return { log, report: files[`${slug}.quality.md`]!, quality };
}

/** True when every Output node was written. */
export const runSucceeded = (log: RunLog) => log.outputs.length > 0 && log.outputs.every((o) => o.status === 'written');
