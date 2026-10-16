import { hashValue, inputEdges, nodeById, topoSort, upstreamIds, type GraphNode, type Project, type Rule } from '../model';
import { CompileError } from './errors';
import { sourceRelation } from './sources';
import { cteName, ident, num, str } from './sql';
import { rulePredicate } from './rules';
import { stepParams } from './steps';

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

function inputCte(project: Project, node: GraphNode, out: Map<string, string>): string {
  const [edge] = inputEdges(project, node.id);
  if (!edge) throw new CompileError(`${node.name} has no input. Connect a wire into it.`, node.id);
  const cte = out.get(edge.from.nodeId);
  if (!cte) throw new CompileError(`${node.name} is connected to a node that no longer exists.`, node.id);
  return cte;
}

/**
 * Compile the flow upstream of a node into one WITH chain: one CTE per source, one per enabled step,
 * and a final SELECT of the target. Pure: the same project and target always give the same SQL.
 */
export function compile(project: Project, target: Target): Compiled {
  const node = nodeById(project, target.nodeId);
  if (!node) throw new CompileError('That node no longer exists.', target.nodeId);
  const order = topoSort(project, upstreamIds(project, target.nodeId));
  const ctes: string[] = [];
  const out = new Map<string, string>();

  for (const id of order) {
    const n = nodeById(project, id)!;
    switch (n.type) {
      case 'source': {
        const source = project.sources.find((s) => s.id === n.sourceId);
        if (!source) throw new CompileError(`${n.name} has lost its source. Add the file again.`, n.id);
        const name = cteName(n.id);
        ctes.push(`${name} AS (SELECT * FROM ${sourceRelation(source)})`);
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
      case 'output':
        out.set(n.id, inputCte(project, n, out));
        break;
    }
  }

  let output = out.get(target.nodeId)!;
  if (target.failingRuleId) {
    const rule = node.rules.find((r) => r.id === target.failingRuleId);
    if (!rule) throw new CompileError(`${node.name} has no such rule.`, node.id);
    const pass = ident('__puddle_pass');
    const name = ident(`n_${node.id}_failing`);
    ctes.push(`${name} AS (SELECT * EXCLUDE (${pass}) FROM (SELECT *, (${rulePredicate(rule)}) AS ${pass} FROM ${output}) WHERE NOT coalesce(${pass}, false))`);
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
 * What text columns look like: per column i, `n<i>` non-empty values and how many of them read as a number
 * (`num<i>`) or a date (`date<i>`), so a column of numbers stored as text can say so.
 */
export function compileTypeSniff(project: Project, target: Target, columns: string[]): string {
  if (!columns.length) throw new RangeError('No columns to look at.');
  const parts = columns.flatMap((c, i) => {
    const v = `nullif(trim(CAST(${ident(c)} AS VARCHAR)), '')`;
    return [`count(${v}) AS ${ident(`n${i}`)}`, `count(TRY_CAST(${v} AS DOUBLE)) AS ${ident(`num${i}`)}`, `count(TRY_CAST(${v} AS DATE)) AS ${ident(`date${i}`)}`];
  });
  return `SELECT ${parts.join(', ')} FROM (${compile(project, target).sql})`;
}

/** The target's full row count. */
export function compileCount(project: Project, target: Target): string {
  return `SELECT COUNT(*) AS n FROM (${compile(project, target).sql})`;
}

/**
 * A key that changes exactly when the target's output could change: node types, wiring, steps up to the
 * target step, and source formats, options and file identity. Names, notes and positions are ignored.
 */
export function upstreamKey(project: Project, target: Target): string {
  const ids = upstreamIds(project, target.nodeId);
  const nodes = project.nodes
    .filter((n) => ids.has(n.id))
    .map((n) => {
      const inputs = inputEdges(project, n.id).map((e) => [e.from.nodeId, e.to.port]);
      if (n.type === 'source') {
        const s = project.sources.find((x) => x.id === n.sourceId);
        return { id: n.id, type: n.type, inputs, source: s && { id: s.id, format: s.format, parseOptions: s.parseOptions, file: s.file?.headHash, size: s.file?.size, clip: s.clipboard?.text, url: s.url && [s.url.href, s.url.headHash] } };
      }
      if (n.type === 'transform') {
        const steps = n.id === target.nodeId && target.stepIndex != null ? n.steps.slice(0, target.stepIndex + 1) : n.steps;
        return { id: n.id, type: n.type, inputs, steps: steps.map((s) => ({ type: s.type, enabled: s.enabled, params: s.params })) };
      }
      return { id: n.id, type: n.type, inputs };
    })
    .sort((a, b) => (a.id < b.id ? -1 : 1));
  const failing = target.failingRuleId ? nodeById(project, target.nodeId)?.rules.find((r) => r.id === target.failingRuleId) : undefined;
  return hashValue({ target: [target.nodeId, target.stepIndex ?? null], nodes, ...(target.failingRuleId ? { failing: failing ? [failing.type, failing.params] : target.failingRuleId } : {}) });
}

/**
 * How many of a sample of a column's non-empty values each strptime format reads: one row per format with
 * `format`, `matched` and `total`, plus one `example` value it reads. For ranking date formats.
 */
export function compileDateDetection(project: Project, target: Target, column: string, formats: string[], sample = 1000): string {
  if (!formats.length) throw new RangeError('No formats to try.');
  const values = `SELECT trim(CAST(${ident(column)} AS VARCHAR)) AS v FROM (${compile(project, target).sql}) WHERE coalesce(trim(CAST(${ident(column)} AS VARCHAR)), '') <> '' LIMIT ${num(sample)}`;
  // strptime needs a constant format, so each format gets its own SELECT.
  const tried = formats.map((f, i) => {
    const reads = `try_strptime(v, ${str(f)}) IS NOT NULL`;
    return `SELECT ${num(i)} AS i, ${str(f)} AS format, count(*) FILTER (WHERE ${reads}) AS matched, count(*) AS total, any_value(v) FILTER (WHERE ${reads}) AS example FROM s`;
  });
  return `WITH s AS (${values})\nSELECT format, matched, total, example FROM (\n  ${tried.join('\n  UNION ALL ')}\n) ORDER BY i`;
}

/**
 * Every enabled rule of a node in one pass over its output: `total` rows, and `f<i>` failures for the i-th rule
 * given. Predicates may use window functions (unique), so they're computed per row first, then counted.
 */
export function compileRules(project: Project, nodeId: string, rules: Rule[]): string {
  if (!rules.length) throw new RangeError('No rules to check.');
  const { sql } = compile(project, { nodeId });
  const flags = rules.map((r, i) => `(${rulePredicate(r)}) AS ${ident(`r${i}`)}`);
  const counts = rules.map((_, i) => `count(*) FILTER (WHERE NOT coalesce(${ident(`r${i}`)}, false)) AS ${ident(`f${i}`)}`);
  return `SELECT count(*) AS total, ${counts.join(', ')} FROM (SELECT ${flags.join(', ')} FROM (${sql}))`;
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
