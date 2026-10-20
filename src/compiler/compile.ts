import { freePort, hashValue, inputEdge, inputEdges, inputPorts, nodeById, topoSort, upstreamIds, type ColumnSchema, type GraphNode, type Port, type Project, type Rule } from '../model';
import { appendProblems, compileAppend } from './append';
import { CompileError, PendingSchemaError, UnwiredError } from './errors';
import { compileJoin, joinCondition, joinProblems } from './join';
import { compileLookup, firstMatches, lookupCondition, lookupProblems } from './lookup';
import { keptTable, knownKept, type KeptBook } from './keptBook';
import { dateText, readDateFormat } from './dateRead';
import { compileQuery, queryProblems } from './query';
import { compileQuerySql, querySqlProblem } from './querySql';
import { compileSqlNode, sqlNodeProblem } from './sqlNode';
import { compileSchemaTable, failingRows, failureCounts, heldTableRows, LOAD_FAILURES, loadChecks, projectSchema, tableFor, type LoadCheck, type TableInput } from './schemaTable';
import { foreignKey, schemaDdl } from './ddl/duckdb';
import { knownSchemas, type SchemaBook } from './schemaBook';
import { sourceRelation } from './sources';
import { isPlaceholder, looksLikeDate, looksLikeNumber } from './patterns';
import { cteName, ident, num, str } from './sql';
import { rulePredicate, ruleRefs, ruleScope, type RuleContext } from './rules';
import { MAX_TRANSPOSE_ROWS, pivotValuesQuery, stepParams, type Condition } from './steps';

export const PAGE_SIZE = 500;

export interface Target {
  nodeId: string;
  /** Preview step k inside a transform node: only steps 0..k are compiled. Omit for the whole node. */
  stepIndex?: number;
  /** Only the rows of the node's output that fail this rule of the node. */
  failingRuleId?: string;
}

export interface Compiled {
  /** A complete SELECT statement for the target's rows. */
  sql: string;
  /** The CTE the target reads from, so callers can wrap it (COUNT, rules, COPY TO). */
  output: string;
  /** Nodes the statement depends on, in topological order. */
  nodeIds: string[];
}

export interface CompileOptions {
  /** Where Join, Append, Lookup and Query nodes read their inputs' columns. The app's shared book by default. */
  schemas?: SchemaBook;
  /** Kept results the compiler may read from. The app's shared book by default. */
  kept?: KeptBook;
  /** Compile the target itself even if it is kept: for building its table, or looking inside it. */
  rebuild?: boolean;
}

/** Node kinds that compile from their inputs' columns, so those must be described first (see SchemaCache.prepare). */
export const needsInputSchemas = (node: GraphNode) => node.type === 'join' || node.type === 'append' || node.type === 'lookup' || node.type === 'query' || node.type === 'table';

/** One wired input of a node: its port, the node feeding it, and that node's CTE. */
interface WiredInput {
  port: Port;
  label: string;
  fromId: string;
  cte: string;
}

/** The wired inputs of a node, in port order. Throws UnwiredError for an empty input that isn't optional. */
function wiredInputs(project: Project, node: GraphNode, out: Map<string, string>): WiredInput[] {
  const ports = inputPorts(project, node);
  const wired: WiredInput[] = [];
  for (const port of ports) {
    const edge = inputEdge(project, node.id, port.id);
    if (!edge) {
      if (port.optional) continue;
      const input = ports.length === 1 ? 'input' : `${port.label.toLowerCase()} input`;
      throw new UnwiredError(`${node.name} has no ${input}. Connect a wire into it.`, node.id, port.id);
    }
    const cte = out.get(edge.from.nodeId);
    if (!cte) throw new CompileError(`${node.name} is connected to a node that no longer exists.`, node.id);
    wired.push({ port: port.id, label: port.label, fromId: edge.from.nodeId, cte });
  }
  return wired;
}

const inputCte = (project: Project, node: GraphNode, out: Map<string, string>) => wiredInputs(project, node, out)[0]!.cte;

/** The columns arriving at one input, from the book; throws while they're still unknown. */
function inputColumns(project: Project, node: GraphNode, input: WiredInput, book: SchemaBook): ColumnSchema[] {
  const columns = book.get(upstreamKey(project, { nodeId: input.fromId }));
  if (!columns) throw new PendingSchemaError(`${node.name} is still reading the columns of its ${input.label.toLowerCase()} input.`, node.id);
  return columns;
}

interface Built {
  node: GraphNode;
  ctes: string[];
  /** The CTE holding each compiled node's output. */
  out: Map<string, string>;
  order: string[];
}

/** Whether a node is read from its kept table: kept, built for its current upstream, and not being rebuilt. */
function readsKept(project: Project, nodeId: string, target: Target, options: CompileOptions): boolean {
  const n = nodeById(project, nodeId);
  if (!n?.pinnedResult) return false;
  if (nodeId === target.nodeId && (options.rebuild || target.stepIndex != null)) return false;
  const kept = (options.kept ?? knownKept).get(nodeId);
  return !!kept && kept.key === upstreamKey(project, { nodeId });
}

/** The nodes a target needs compiled: everything upstream, stopping at kept nodes read from their tables. */
function neededIds(project: Project, target: Target, options: CompileOptions): Set<string> {
  const ids = new Set<string>();
  const visit = (id: string) => {
    if (ids.has(id)) return;
    ids.add(id);
    if (readsKept(project, id, target, options)) return;
    for (const e of inputEdges(project, id)) visit(e.from.nodeId);
  };
  visit(target.nodeId);
  return ids;
}

function build(project: Project, target: Target, book: SchemaBook, options: CompileOptions = {}): Built {
  const node = nodeById(project, target.nodeId);
  if (!node) throw new CompileError('That node no longer exists.', target.nodeId);
  const order = topoSort(project, neededIds(project, target, options));
  const ctes: string[] = [];
  const out = new Map<string, string>();

  for (const id of order) {
    const n = nodeById(project, id)!;
    if (readsKept(project, id, target, options)) {
      out.set(id, keptTable(id));
      continue;
    }
    switch (n.type) {
      case 'source': {
        const source = project.sources.find((s) => s.id === n.sourceId);
        if (!source) throw new CompileError(`${n.name} has lost its source. Add the file again.`, n.id);
        const name = cteName(n.id);
        const sample = source.sampleRows != null ? ` LIMIT ${num(source.sampleRows)}` : '';
        ctes.push(`${name} AS (SELECT * FROM ${sourceRelation(source)}${sample})`);
        out.set(n.id, name);
        break;
      }
      case 'transform': {
        let cur = inputCte(project, n, out);
        const last = id === target.nodeId && target.stepIndex != null ? target.stepIndex : n.steps.length - 1;
        if (last >= n.steps.length) throw new CompileError(`${n.name} has no step ${last + 1}.`, n.id);
        n.steps.slice(0, last + 1).forEach((step, k) => {
          if (!step.enabled) return;
          const { def, params } = stepParams(step, n.id);
          const name = cteName(n.id, k);
          ctes.push(`${name} AS (${def.compile(params, { input: cur })})`);
          cur = name;
        });
        out.set(n.id, cur);
        break;
      }
      case 'join': {
        const [l, r] = wiredInputs(project, n, out);
        const fail = (p: ReturnType<typeof joinProblems>[number] | undefined) => {
          if (p) throw new CompileError(p.message, n.id, undefined, p.side ? [p.side] : undefined);
        };
        fail(joinProblems(n.joinSpec)[0]);
        const [left, right] = [inputColumns(project, n, l!, book), inputColumns(project, n, r!, book)];
        fail(joinProblems(n.joinSpec, left, right)[0]);
        const name = cteName(n.id);
        ctes.push(`${name} AS (${compileJoin(n.joinSpec, { left: l!.cte, right: r!.cte }, left, right)})`);
        out.set(n.id, name);
        break;
      }
      case 'append': {
        const wired = wiredInputs(project, n, out);
        if (wired.length < 2) throw new UnwiredError(`${n.name} needs at least two inputs. Connect another wire into it.`, n.id, freePort(project, n.id));
        const inputs = wired.map((w) => ({ cte: w.cte, label: nodeById(project, w.fromId)!.name, columns: inputColumns(project, n, w, book) }));
        const problem = appendProblems(n.appendSpec, inputs)[0];
        if (problem) throw new CompileError(problem.message, n.id, undefined, problem.input == null ? undefined : [wired[problem.input]!.port]);
        const name = cteName(n.id);
        ctes.push(`${name} AS (${compileAppend(n.appendSpec, inputs)})`);
        out.set(n.id, name);
        break;
      }
      case 'lookup': {
        const [m, l] = wiredInputs(project, n, out);
        const fail = (p: ReturnType<typeof lookupProblems>[number] | undefined) => {
          if (p) throw new CompileError(p.message, n.id, undefined, p.side ? [p.side] : undefined);
        };
        fail(lookupProblems(n.lookupSpec)[0]);
        const [main, lookup] = [inputColumns(project, n, m!, book), inputColumns(project, n, l!, book)];
        fail(lookupProblems(n.lookupSpec, main, lookup)[0]);
        const name = cteName(n.id);
        ctes.push(`${name} AS (${compileLookup(n.lookupSpec, { main: m!.cte, lookup: l!.cte }, main, lookup)})`);
        out.set(n.id, name);
        break;
      }
      case 'query': {
        const wired = wiredInputs(project, n, out);
        if (!wired.length) throw new UnwiredError(`${n.name} has no tables. Connect a wire into it, or add a table in the query designer.`, n.id, 0);
        const name = cteName(n.id);
        const kept = n.querySpec.sql;
        if (kept != null) {
          // SQL from the SQL view that the grid can't show runs as written.
          const inputs = wired.map((w) => ({ port: w.port as number, cte: w.cte, label: nodeById(project, w.fromId)!.name }));
          const problem = querySqlProblem(kept, inputs);
          if (problem) throw new CompileError(`This query can’t run: ${problem}.`, n.id);
          ctes.push(`${name} AS (${compileQuerySql(kept, inputs)})`);
          out.set(n.id, name);
          break;
        }
        const tables = wired.map((w) => ({ port: w.port as number, cte: w.cte, label: nodeById(project, w.fromId)!.name, columns: inputColumns(project, n, w, book) }));
        const problem = queryProblems(n.querySpec, tables)[0];
        if (problem) throw new CompileError(problem.message, n.id, undefined, problem.port == null ? undefined : [problem.port]);
        ctes.push(`${name} AS (${compileQuery(n.querySpec, tables)})`);
        out.set(n.id, name);
        break;
      }
      case 'sql': {
        const wired = wiredInputs(project, n, out);
        if (!wired.length) throw new UnwiredError(`${n.name} has no inputs. Connect a wire into it.`, n.id, 0);
        const inputs = wired.map((w) => ({ port: w.port as number, cte: w.cte, label: nodeById(project, w.fromId)!.name }));
        const problem = sqlNodeProblem(n.sqlSpec, inputs);
        if (problem) throw new CompileError(`This query can’t run: ${problem}.`, n.id);
        const name = cteName(n.id);
        ctes.push(`${name} AS (${compileSqlNode(n.sqlSpec, inputs)})`);
        out.set(n.id, name);
        break;
      }
      case 'table': {
        const { table, schema, input } = schemaTableParts(project, n, out, book);
        const name = cteName(n.id);
        ctes.push(`${name} AS (${compileSchemaTable(schema, table, n.tableSpec, input)})`);
        out.set(n.id, name);
        break;
      }
      case 'output':
        out.set(n.id, inputCte(project, n, out));
        break;
    }
  }
  return { node, ctes, out, order };
}

/** A Schema table node's table, the schema it is in, and the load wired into it, if any. */
function schemaTableParts(project: Project, n: Extract<GraphNode, { type: 'table' }>, out: Map<string, string>, book: SchemaBook) {
  const schema = projectSchema(project.schema.dbml);
  let table;
  try {
    table = tableFor(schema, n.tableSpec, n.name);
  } catch (e) {
    throw new CompileError((e as Error).message, n.id);
  }
  const wired = wiredInputs(project, n, out)[0];
  const input: TableInput | undefined = wired && { cte: wired.cte, columns: inputColumns(project, n, wired, book) };
  return { schema, table, input };
}

/** Parent tables being read for a foreign key check, so a loop of refs between table nodes stops. */
const readingParents = new Set<string>();

/**
 * The checks a Schema table node's load must pass, as one statement counting the loaded rows that fail each
 * (`f<i>` for `checks[i]`), or, with `failing`, listing them. Undefined when nothing is wired in.
 */
export function compileLoadCheck(project: Project, nodeId: string, options: CompileOptions & { failing?: boolean } = {}): { sql: string; checks: LoadCheck[] } | undefined {
  const { node, ctes, out } = build(project, { nodeId }, options.schemas ?? knownSchemas, options);
  if (node.type !== 'table') throw new CompileError(`${node.name} isn’t a schema table.`, node.id);
  const { schema, table, input } = schemaTableParts(project, node, out, options.schemas ?? knownSchemas);
  if (!input) return undefined;
  const parentRows = (parent: Parameters<typeof heldTableRows>[1]) => {
    const nodes = project.nodes.filter((x) => x.id !== node.id && x.type === 'table' && x.tableSpec.schema === parent.schema && x.tableSpec.table === parent.name);
    if (!nodes.length || readingParents.has(node.id)) return `(${heldTableRows(schema, parent, true)})`;
    readingParents.add(node.id);
    try {
      return `(${nodes.map((x) => compile(project, { nodeId: x.id }, options).sql).map((q) => `SELECT * FROM (${q})`).join(' UNION ALL ')})`;
    } catch (e) {
      throw new CompileError(`${table.name} refers to ${parent.name}, whose node can’t run, so the load can’t be checked. ${e instanceof Error ? e.message : String(e)}`, node.id);
    } finally {
      readingParents.delete(node.id);
    }
  };
  const load = loadChecks(schema, table, node.tableSpec, input, parentRows);
  const body = options.failing ? failingRows(load.checks) : failureCounts(load.checks);
  return { sql: `WITH ${[...ctes, ...load.ctes].join(',\n  ')}\n${body}`, checks: load.checks };
}

const keyingParents = new Set<string>();

/** The keys of the Schema table nodes a table node's foreign keys point at (not itself, and stopping at a loop). */
function parentKeys(project: Project, node: Extract<GraphNode, { type: 'table' }>): string[] {
  if (keyingParents.has(node.id)) return [];
  const schema = projectSchema(project.schema.dbml);
  const parents = new Set<string>();
  for (const ref of schema.refs) {
    const fk = foreignKey(ref);
    if (fk && fk.child.schema === node.tableSpec.schema && fk.child.table === node.tableSpec.table) parents.add(`${fk.parent.schema}.${fk.parent.table}`);
  }
  const ids = project.nodes.filter((x) => x.id !== node.id && x.type === 'table' && parents.has(`${x.tableSpec.schema}.${x.tableSpec.table}`)).map((x) => x.id);
  keyingParents.add(node.id);
  try {
    return ids.map((id) => upstreamKey(project, { nodeId: id }));
  } finally {
    keyingParents.delete(node.id);
  }
}

/** The DDL of a project's schema, once per version of its DBML: what Schema table nodes' rows are built from. */
let ddlKey: { dbml: string; key: string } | undefined;
export function schemaDdlKey(dbml: string): string {
  if (ddlKey?.dbml !== dbml) ddlKey = { dbml, key: hashValue(schemaDdl(projectSchema(dbml)).statements) };
  return ddlKey.key;
}

/**
 * Compile the flow upstream of a node into one WITH chain: one CTE per source, one per enabled step, one per
 * join over its two inputs' CTEs, and a final SELECT of the target. Pure: the same project, target and known
 * input schemas always give the same SQL.
 */
export function compile(project: Project, target: Target, options: CompileOptions = {}): Compiled {
  const { node, ctes, out, order } = build(project, target, options.schemas ?? knownSchemas, options);
  let output = out.get(target.nodeId)!;
  if (target.failingRuleId === LOAD_FAILURES) {
    const check = compileLoadCheck(project, target.nodeId, { ...options, failing: true });
    if (!check) throw new CompileError(`Nothing is loaded into ${node.name}, so no rows fail.`, node.id);
    return { sql: check.sql, output: ident(`n_${node.id}_failing`), nodeIds: order };
  }
  if (target.failingRuleId) {
    const rule = node.rules.find((r) => r.id === target.failingRuleId);
    if (!rule) throw new CompileError(`${node.name} has no such rule.`, node.id);
    if (ruleScope(rule) === 'table') throw new CompileError(`“${rule.label}” is about the whole table, so there are no failing rows to show.`, node.id);
    const pass = ident('__puddle_pass');
    const name = ident(`n_${node.id}_failing`);
    ctes.push(`${name} AS (SELECT * EXCLUDE (${pass}) FROM (SELECT *, (${rulePredicate(rule, ruleContext(project))}) AS ${pass} FROM ${output}) WHERE NOT coalesce(${pass}, false))`);
    output = name;
  }
  const sql = ctes.length ? `WITH ${ctes.join(',\n  ')}\nSELECT * FROM ${output}` : `SELECT * FROM ${output}`;
  return { sql, output, nodeIds: order };
}

/** The target's rows for one page of the results table. */
export function compilePreview(project: Project, target: Target, page = 0, pageSize = PAGE_SIZE): string {
  if (!Number.isInteger(page) || page < 0) throw new RangeError(`Bad page: ${page}`);
  return `${compile(project, target).sql}\nLIMIT ${num(pageSize)} OFFSET ${num(page * pageSize)}`;
}

/**
 * One page of the results table with every column cast to text, so the grid shows exactly what DuckDB
 * would print (dates, decimals, nested values) instead of Arrow's raw encodings. Nulls stay null.
 */
export function compileDisplayPage(project: Project, target: Target, columns: string[], page = 0, pageSize = PAGE_SIZE): string {
  if (!Number.isInteger(page) || page < 0) throw new RangeError(`Bad page: ${page}`);
  const select = columns.length ? columns.map((c) => `CAST(${ident(c)} AS VARCHAR) AS ${ident(c)}`).join(', ') : '*';
  return `SELECT ${select} FROM (${compile(project, target).sql})\nLIMIT ${num(pageSize)} OFFSET ${num(page * pageSize)}`;
}

/** Per-column profile from SUMMARIZE: the share of empty values (the quality bars), about how many distinct values, and the smallest and largest. */
export function compileProfile(project: Project, target: Target): string {
  return `SELECT column_name, CAST(null_percentage AS DOUBLE) AS null_pct, approx_unique, CAST(min AS VARCHAR) AS min, CAST(max AS VARCHAR) AS max FROM (SUMMARIZE SELECT * FROM (${compile(project, target).sql}))`;
}

/**
 * What text columns look like: per column i, `n<i>` non-empty values (placeholders for empty and the column's own name aside) and how many of
 * them read as a number (`num<i>`) or a date (`date<i>`), allowing for currency symbols, thousands separators,
 * brackets and day-first dates, so a column of numbers stored as text can say so.
 */
export function compileTypeSniff(project: Project, target: Target, columns: string[], limit?: number): string {
  if (!columns.length) throw new RangeError('No columns to look at.');
  const parts = columns.flatMap((c, i) => {
    // Placeholders for empty (n/a, -) and the column's own name (a header pasted in again) are neither numbers nor words: they don't count against a column.
    const v = `nullif(trim(CAST(${ident(c)} AS VARCHAR)), '')`;
    const real = `${v} IS NOT NULL AND NOT ${isPlaceholder(v)} AND lower(${v}) <> ${str(c.trim().toLowerCase())}`;
    return [`count(*) FILTER (WHERE ${real}) AS ${ident(`n${i}`)}`, `count(*) FILTER (WHERE ${real} AND ${looksLikeNumber(v)}) AS ${ident(`num${i}`)}`, `count(*) FILTER (WHERE ${real} AND ${looksLikeDate(v)}) AS ${ident(`date${i}`)}`];
  });
  const source = limit ? `SELECT * FROM (${compile(project, target).sql}) LIMIT ${num(limit)}` : compile(project, target).sql;
  return `SELECT ${parts.join(', ')} FROM (${source})`;
}

/**
 * Whether each of a node's columns has no repeated values, in one row: `u<i>` is true when column i has no value
 * twice. Empty values don't count, so a key with gaps can still be the "one" end of a relationship.
 */
export function compileKeyCheck(project: Project, nodeId: string, columns: string[], options: CompileOptions = {}): string {
  if (!columns.length) throw new RangeError('No columns to check.');
  const parts = columns.map((c, i) => `count(${ident(c)}) = count(DISTINCT ${ident(c)}) AS ${ident(`u${i}`)}`);
  return `SELECT ${parts.join(', ')} FROM (${compile(project, { nodeId }, options).sql})`;
}

/** The target's full row count. */
export function compileCount(project: Project, target: Target): string {
  return `SELECT COUNT(*) AS n FROM (${compile(project, target).sql})`;
}

/**
 * A key that changes exactly when the target's output could change: node types, wiring (which input each wire
 * goes into), steps up to the target step, join, append and lookup settings, and source formats, options and file identity, on
 * every branch upstream. Names, notes and positions are ignored.
 */
export function upstreamKey(project: Project, target: Target): string {
  const ids = upstreamIds(project, target.nodeId);
  const nodes = project.nodes
    .filter((n) => ids.has(n.id))
    .map((n) => {
      const inputs = inputEdges(project, n.id).map((e) => [e.from.nodeId, e.to.port]);
      if (n.type === 'source') {
        const s = project.sources.find((x) => x.id === n.sourceId);
        return { id: n.id, type: n.type, inputs, source: s && { id: s.id, format: s.format, parseOptions: s.parseOptions, file: s.file?.headHash, size: s.file?.size, clip: s.clipboard?.text, url: s.url && (s.url.odata ? [s.url.href, s.url.headHash, s.url.odata] : [s.url.href, s.url.headHash]), sample: s.sampleRows } };
      }
      if (n.type === 'transform') {
        const steps = n.id === target.nodeId && target.stepIndex != null ? n.steps.slice(0, target.stepIndex + 1) : n.steps;
        return { id: n.id, type: n.type, inputs, steps: steps.map((s) => ({ type: s.type, enabled: s.enabled, params: s.params })) };
      }
      if (n.type === 'join') return { id: n.id, type: n.type, inputs, join: n.joinSpec };
      if (n.type === 'lookup') return { id: n.id, type: n.type, inputs, lookup: n.lookupSpec };
      // The source column holds each input's node name, so names matter only when it's on.
      if (n.type === 'append') return { id: n.id, type: n.type, inputs, append: n.appendSpec, ...(n.appendSpec.tagRows ? { labels: inputEdges(project, n.id).map((e) => nodeById(project, e.from.nodeId)?.name) } : {}) };
      // Where tables sit in the designer doesn't change the rows.
      // SQL kept from the SQL view reads the tables by their node names, so those matter then.
      if (n.type === 'query') return { id: n.id, type: n.type, inputs, query: { ...n.querySpec, tables: undefined }, ...(n.querySpec.sql != null ? { labels: inputEdges(project, n.id).map((e) => nodeById(project, e.from.nodeId)?.name) } : {}) };
      // The query reads its inputs by their node names, so those matter here.
      if (n.type === 'sql') return { id: n.id, type: n.type, inputs, sql: n.sqlSpec, labels: inputEdges(project, n.id).map((e) => nodeById(project, e.from.nodeId)?.name) };
      // A schema table's rows follow the DBML (its DuckDB table is rebuilt from it); a load is checked against the
      // nodes of the tables its foreign keys point at, so those count too.
      if (n.type === 'table') return { id: n.id, type: n.type, inputs, table: n.tableSpec, ddl: schemaDdlKey(project.schema.dbml), parents: inputs.length ? parentKeys(project, n) : [] };
      return { id: n.id, type: n.type, inputs };
    })
    .sort((a, b) => (a.id < b.id ? -1 : 1));
  const failing = target.failingRuleId ? nodeById(project, target.nodeId)?.rules.find((r) => r.id === target.failingRuleId) : undefined;
  return hashValue({ target: [target.nodeId, target.stepIndex ?? null], nodes, ...(target.failingRuleId ? { failing: failing ? [failing.type, failing.params, refKeys(project, failing)] : target.failingRuleId } : {}) });
}

/** The project with every source read in full: exports, and the other nodes rules read, never use the sample. */
export function fullData(project: Project): Project {
  return project.sources.some((s) => s.sampleRows != null) ? { ...project, sources: project.sources.map((s) => (s.sampleRows == null ? s : { ...s, sampleRows: undefined })) } : project;
}

/** Keys of the nodes a rule reads, so its result is re-checked when one of them changes (or goes). */
export function refKeys(project: Project, rule: Pick<Rule, 'type' | 'params'>): Array<string | null> {
  return ruleRefs(rule).map((id) => (nodeById(project, id) ? upstreamKey(fullData(project), { nodeId: id }) : null));
}

/**
 * What rules read besides their own node: another node's rows, on the full data. A node that's gone or can't
 * compile makes the rule fail to run with the reason, rather than pass.
 */
export function ruleContext(project: Project, options: CompileOptions = {}): RuleContext {
  const full = fullData(project);
  return {
    relation: (nodeId) => {
      const other = nodeById(full, nodeId);
      if (!other) throw new CompileError('The node this rule reads is no longer in the project.');
      try {
        return `(${compile(full, { nodeId }, options).sql})`;
      } catch (e) {
        throw new CompileError(`${other.name} can’t run, so this rule can’t be checked. ${e instanceof Error ? e.message : String(e)}`);
      }
    },
  };
}

/**
 * Which formats read each of a sample of a column's non-empty values: one row per distinct value in the order they
 * first appear, with the value as written (`value`), how often it appears (`n`) and the indexes into `formats` of
 * those that read it, comma-separated (`reads`). For choosing date formats.
 */
export function compileDateDetection(project: Project, target: Target, column: string, formats: string[], sample = 1000, locale?: string): string {
  if (!formats.length) throw new RangeError('No formats to try.');
  const text = `trim(CAST(${ident(column)} AS VARCHAR))`;
  // The text is tidied as parse dates tidies it; the value shown stays as written.
  const values = `SELECT raw, ${dateText('raw', locale)} AS v, row_number() OVER () AS i FROM (SELECT ${text} AS raw FROM (${compile(project, target).sql}) WHERE coalesce(${text}, '') <> '' LIMIT ${num(sample)})`;
  const reads = formats.map((f, i) => `CASE WHEN ${readDateFormat('v', f)} IS NOT NULL THEN ${str(String(i))} END`);
  return `WITH s AS (${values})\nSELECT raw AS value, count(*) AS n, concat_ws(',', ${reads.join(', ')}) AS reads FROM s GROUP BY raw, v ORDER BY min(i)`;
}

/**
 * The values a pivot's Columns field would turn into columns, read from the data arriving at the step after its
 * filters: one row per value (`v`, as text), at most one more than can become columns.
 */
export function compilePivotValues(project: Project, target: Target, pivot: { column: string; filters: Condition[] }): string {
  return pivotValuesQuery(pivot, `(${compile(project, target).sql})`);
}

/**
 * What Transpose fixes when it's set up: a row per input row (at most one more than it takes), each with the
 * `header` column's value as text (`v`) and the input's row count (`n`).
 */
export function compileTransposeRows(project: Project, target: Target, header: string): string {
  return `SELECT CAST(${ident(header)} AS VARCHAR) AS v, count(*) OVER () AS n FROM (${compile(project, target).sql}) LIMIT ${num(MAX_TRANSPOSE_ROWS + 1)}`;
}

/**
 * Every enabled rule of a node in one pass over its output: `total` rows, and `f<i>` failures for the i-th rule
 * given. Predicates may use window functions (unique), so they're computed per row first, then counted.
 */
export function compileRules(project: Project, nodeId: string, rules: Rule[]): string {
  if (!rules.length) throw new RangeError('No rules to check.');
  const { sql } = compile(project, { nodeId });
  const ctx = ruleContext(project);
  const predicates = rules.map((r) => rulePredicate(r, ctx));
  const flags = rules.flatMap((r, i) => (ruleScope(r) === 'row' ? [`(${predicates[i]}) AS ${ident(`r${i}`)}`] : []));
  // A table rule (row count) is checked once over the whole output: 1 failure when it doesn't hold, else 0.
  const counts = rules.map((r, i) =>
    ruleScope(r) === 'row' ? `count(*) FILTER (WHERE NOT coalesce(${ident(`r${i}`)}, false)) AS ${ident(`f${i}`)}` : `CASE WHEN coalesce((${predicates[i]}), false) THEN 0 ELSE 1 END AS ${ident(`f${i}`)}`,
  );
  return `SELECT count(*) AS total, ${counts.join(', ')} FROM (SELECT ${flags.length ? flags.join(', ') : '1 AS "__puddle_row"'} FROM (${sql}))`;
}

/** What a suggested rule needs confirmed about one column before it is offered. */
export interface SuggestionCheck {
  column: string;
  /** Count values that are empty (null or blank text). */
  blank?: boolean;
  /** Count values with spaces at either end. */
  edges?: boolean;
  /** Count distinct values exactly (profiling's count is approximate). */
  distinct?: boolean;
  /** List the distinct values, as text and sorted. */
  values?: boolean;
}

/**
 * One row of exact facts behind suggested rules, at background priority: `rows`, and per check i `nn<i>`
 * (non-null values) plus `blank<i>`, `edges<i>`, `distinct<i>` and `values<i>` as asked for.
 */
export function compileSuggestionChecks(project: Project, target: Target, checks: SuggestionCheck[]): string {
  const parts = ['count(*) AS "rows"'];
  checks.forEach((c, i) => {
    const col = ident(c.column);
    const text = `CAST(${col} AS VARCHAR)`;
    parts.push(`count(${col}) AS ${ident(`nn${i}`)}`);
    if (c.blank) parts.push(`count(*) FILTER (WHERE coalesce(trim(${text}), '') = '') AS ${ident(`blank${i}`)}`);
    if (c.edges) parts.push(`count(*) FILTER (WHERE ${text} <> trim(${text})) AS ${ident(`edges${i}`)}`);
    if (c.distinct) parts.push(`count(DISTINCT ${col}) AS ${ident(`distinct${i}`)}`);
    if (c.values) parts.push(`list_sort(list(DISTINCT ${text}) FILTER (WHERE ${col} IS NOT NULL)) AS ${ident(`values${i}`)}`);
  });
  return `SELECT ${parts.join(', ')} FROM (${compile(project, target).sql})`;
}

/**
 * Whether a Join multiplies rows, in one row: `left_rows` and `right_rows` in its inputs, `rows` out of it,
 * `pairs` of matching left and right rows, and how many left (`matched_left`) and right (`matched_right`)
 * rows have a match. More pairs than matched left rows means some left row matched several right rows.
 */
export function compileJoinCheck(project: Project, nodeId: string, options: CompileOptions = {}): string {
  // The check looks inside the Join, so it is compiled even when kept; its inputs may still come from tables.
  const { node, ctes, out } = build(project, { nodeId }, options.schemas ?? knownSchemas, { ...options, rebuild: true });
  if (node.type !== 'join') throw new CompileError(`${node.name} isn’t a Join node.`, node.id);
  const input = (port: 'left' | 'right') => out.get(inputEdge(project, nodeId, port)!.from.nodeId)!;
  const [l, r, j] = [input('left'), input('right'), out.get(nodeId)!];
  const L = ident('l');
  const R = ident('r');
  const on = joinCondition(node.joinSpec, L, R);
  const parts = [
    `(SELECT count(*) FROM ${l}) AS left_rows`,
    `(SELECT count(*) FROM ${r}) AS right_rows`,
    `(SELECT count(*) FROM ${j}) AS "rows"`,
    `(SELECT count(*) FROM ${l} AS ${L} INNER JOIN ${r} AS ${R} ON ${on}) AS pairs`,
    `(SELECT count(*) FROM ${l} AS ${L} SEMI JOIN ${r} AS ${R} ON ${on}) AS matched_left`,
    `(SELECT count(*) FROM ${r} AS ${R} SEMI JOIN ${l} AS ${L} ON ${on}) AS matched_right`,
  ];
  return `WITH ${ctes.join(',\n  ')}\nSELECT ${parts.join(', ')}`;
}

/**
 * How a Lookup matched, in one row: `rows` in its main input (and so out of it), `matched` main rows with a
 * match, `dup_keys` distinct main keys that match more than one lookup row and the `dup_rows` main rows that
 * have them, `missing_keys` distinct main keys with no match, and one example of each (`dup_example`,
 * `missing_example`), the key values joined with commas.
 */
export function compileLookupCheck(project: Project, nodeId: string, options: CompileOptions = {}): string {
  const { node, ctes, out } = build(project, { nodeId }, options.schemas ?? knownSchemas);
  if (node.type !== 'lookup') throw new CompileError(`${node.name} isn’t a Lookup node.`, node.id);
  const spec = node.lookupSpec;
  const input = (port: 'main' | 'lookup') => out.get(inputEdge(project, nodeId, port)!.from.nodeId)!;
  const [main, lookup] = [input('main'), input('lookup')];
  const M = ident('m');
  const R = ident('r');
  const on = lookupCondition(spec, M, R);
  const mainKeys = spec.keys.map((k) => `${M}.${ident(k.main)}`);
  const example = `concat_ws(', ', ${mainKeys.map((k) => `coalesce(CAST(${k} AS VARCHAR), '(empty)')`).join(', ')})`;
  const dups = ident(`n_${nodeId}_dups`);
  const lookupKeys = spec.keys.map((k) => ident(k.lookup)).join(', ');
  const all = [...ctes, `${dups} AS (SELECT ${lookupKeys} FROM ${lookup} GROUP BY ALL HAVING count(*) > 1)`];
  // firstMatches keeps one lookup row per key, so these joins never multiply main rows.
  const first = `(${firstMatches(spec, lookup)})`;
  const parts = [
    `(SELECT count(*) FROM ${main}) AS "rows"`,
    `(SELECT count(*) FROM ${main} AS ${M} SEMI JOIN ${first} AS ${R} ON ${on}) AS matched`,
    `(SELECT count(*) FROM (SELECT DISTINCT ${mainKeys.join(', ')} FROM ${main} AS ${M} SEMI JOIN ${dups} AS ${R} ON ${on})) AS dup_keys`,
    `(SELECT count(*) FROM ${main} AS ${M} SEMI JOIN ${dups} AS ${R} ON ${on}) AS dup_rows`,
    `(SELECT ${example} FROM ${main} AS ${M} SEMI JOIN ${dups} AS ${R} ON ${on} LIMIT 1) AS dup_example`,
    `(SELECT count(*) FROM (SELECT DISTINCT ${mainKeys.join(', ')} FROM ${main} AS ${M} ANTI JOIN ${first} AS ${R} ON ${on})) AS missing_keys`,
    `(SELECT ${example} FROM ${main} AS ${M} ANTI JOIN ${first} AS ${R} ON ${on} LIMIT 1) AS missing_example`,
  ];
  return `WITH ${all.join(',\n  ')}\nSELECT ${parts.join(', ')}`;
}
